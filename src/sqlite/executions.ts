import { resourceConflict } from "../errors/error.ts";
import {
  assertExecutionRevision,
  assertExecutionUpdate,
  type ExecutionStore,
  type RuleExecution,
  type RuleExecutionSummary,
} from "../persistence/executions.ts";
import type { SqliteDatabase } from "./gateway.ts";
import type { ScopeHandle } from "../kernel/model.ts";
import type { ActorRequest } from "../kernel/durable-rules.ts";

export class SqliteExecutionStore implements ExecutionStore {
  constructor(private readonly database: SqliteDatabase) {}

  async listPendingRequests(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly ActorRequest[]> {
    const rows = await this.database.all<{ request_json: string }>(
      `SELECT request.value AS request_json FROM rule_executions AS execution,
       json_each(execution.execution_json, '$.checkpoint.requests') AS request
       WHERE execution.workspace_id = ? AND execution.status = 'waiting'
         AND json_extract(request.value, '$.actorId') = ? AND json_extract(request.value, '$.status') = 'pending'
       ORDER BY json_extract(request.value, '$.createdAt') DESC, json_extract(request.value, '$.id') DESC LIMIT ? OFFSET ?`,
      [workspaceId, actorId, limit, offset],
    );
    return rows.map((row) => JSON.parse(row.request_json) as ActorRequest);
  }

  async hasActiveScope(workspaceId: string, scope: ScopeHandle): Promise<boolean> {
    return !!(await this.database.get(
      "SELECT id FROM rule_executions WHERE workspace_id = ? AND scope_kind = ? AND scope_id = ? AND status IN ('running', 'waiting') LIMIT 1",
      [workspaceId, scope.kind, scope.id],
    ));
  }

  async initialize(): Promise<void> {
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS rule_executions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        actor_id TEXT NOT NULL,
        scope_kind TEXT,
        scope_id TEXT,
        rule_id TEXT NOT NULL,
        rule_key TEXT NOT NULL,
        rule_label TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'waiting', 'completed', 'failed')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revision INTEGER NOT NULL,
        execution_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rule_executions_waiting ON rule_executions(workspace_id, status);
      CREATE INDEX IF NOT EXISTS rule_executions_history ON rule_executions(workspace_id, actor_id, created_at DESC, id DESC);
    `);
  }

  async create(execution: RuleExecution): Promise<void> {
    if (execution.revision !== 0)
      throw resourceConflict("A new execution must have revision zero.");
    await this.database.transaction(async (connection) => {
      if (await connection.get("SELECT id FROM rule_executions WHERE id = ?", [execution.id]))
        throw resourceConflict("RuleExecution already exists.");
      await connection.run(
        "INSERT INTO rule_executions (id, workspace_id, actor_id, scope_kind, scope_id, rule_id, rule_key, rule_label, status, created_at, updated_at, revision, execution_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
          execution.id,
          execution.context.workspaceId,
          execution.context.actorId,
          execution.context.scope?.kind ?? null,
          execution.context.scope?.id ?? null,
          execution.rule.id,
          execution.rule.key,
          execution.rule.label,
          execution.status,
          execution.createdAt,
          execution.updatedAt,
          execution.revision,
          JSON.stringify(execution),
        ],
      );
    });
  }

  async get(workspaceId: string, id: string): Promise<RuleExecution | null> {
    const row = await this.database.get<{ execution_json: string }>(
      "SELECT execution_json FROM rule_executions WHERE workspace_id = ? AND id = ?",
      [workspaceId, id],
    );
    return row ? (JSON.parse(row.execution_json) as RuleExecution) : null;
  }
  async getMany(workspaceId: string, ids: readonly string[]): Promise<readonly RuleExecution[]> {
    if (!ids.length) return [];
    const unique = [...new Set(ids)];
    const rows = await this.database.all<{ execution_json: string }>(
      `SELECT execution_json FROM rule_executions WHERE workspace_id = ? AND id IN (${unique.map(() => "?").join(",")})`,
      [workspaceId, ...unique],
    );
    return rows.map((row) => JSON.parse(row.execution_json) as RuleExecution);
  }

  async list(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly RuleExecutionSummary[]> {
    // History never fetches or parses the potentially multi-megabyte continuation payload.
    const rows = await this.database.all<ExecutionSummaryRow>(
      "SELECT id, actor_id, scope_kind, scope_id, rule_id, rule_key, rule_label, status, created_at, updated_at FROM rule_executions WHERE workspace_id = ? AND actor_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?",
      [workspaceId, actorId, limit, offset],
    );
    return rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      ...(row.scope_kind !== null && row.scope_id !== null
        ? { scope: { kind: row.scope_kind, id: row.scope_id } }
        : {}),
      rule: { id: row.rule_id, key: row.rule_key, label: row.rule_label },
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async update(execution: RuleExecution, expectedRevision: number): Promise<void> {
    assertExecutionRevision(execution, expectedRevision);
    await this.database.transaction(async (connection) => {
      const row = await connection.get<{ execution_json: string }>(
        "SELECT execution_json FROM rule_executions WHERE id = ? AND workspace_id = ? AND revision = ?",
        [execution.id, execution.context.workspaceId, expectedRevision],
      );
      const current = row ? (JSON.parse(row.execution_json) as RuleExecution) : null;
      assertExecutionUpdate(current, execution, expectedRevision);
      await connection.run(
        "UPDATE rule_executions SET revision = ?, status = ?, updated_at = ?, execution_json = ? WHERE id = ? AND revision = ?",
        [
          execution.revision,
          execution.status,
          execution.updatedAt,
          JSON.stringify(execution),
          execution.id,
          expectedRevision,
        ],
      );
    });
  }
}

interface ExecutionSummaryRow {
  readonly id: string;
  readonly actor_id: string;
  readonly scope_kind: string | null;
  readonly scope_id: string | null;
  readonly rule_id: string;
  readonly rule_key: string;
  readonly rule_label: string;
  readonly status: RuleExecution["status"];
  readonly created_at: string;
  readonly updated_at: string;
}
