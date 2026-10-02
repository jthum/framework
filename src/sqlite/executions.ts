import { resourceConflict } from "../errors/error.ts";
import {
  assertExecutionRevision,
  assertExecutionUpdate,
  type ExecutionStore,
  type RuleExecution,
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
       WHERE execution.workspace_id = ? AND json_extract(execution.execution_json, '$.status') = 'waiting'
         AND json_extract(request.value, '$.actorId') = ? AND json_extract(request.value, '$.status') = 'pending'
       ORDER BY json_extract(request.value, '$.createdAt') DESC, json_extract(request.value, '$.id') DESC LIMIT ? OFFSET ?`,
      [workspaceId, actorId, limit, offset],
    );
    return rows.map((row) => JSON.parse(row.request_json) as ActorRequest);
  }

  async hasActiveScope(workspaceId: string, scope: ScopeHandle): Promise<boolean> {
    return !!(await this.database.get(
      "SELECT id FROM rule_executions WHERE workspace_id = ? AND json_extract(execution_json, '$.context.scope.kind') = ? AND json_extract(execution_json, '$.context.scope.id') = ? AND json_extract(execution_json, '$.status') IN ('running', 'waiting') LIMIT 1",
      [workspaceId, scope.kind, scope.id],
    ));
  }

  async initialize(): Promise<void> {
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS rule_executions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        execution_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rule_executions_workspace_id ON rule_executions(workspace_id);
      CREATE INDEX IF NOT EXISTS rule_executions_waiting ON rule_executions(workspace_id, json_extract(execution_json, '$.status'));
    `);
  }

  async create(execution: RuleExecution): Promise<void> {
    if (execution.revision !== 0)
      throw resourceConflict("A new execution must have revision zero.");
    await this.database.transaction(async (connection) => {
      if (await connection.get("SELECT id FROM rule_executions WHERE id = ?", [execution.id]))
        throw resourceConflict("RuleExecution already exists.");
      await connection.run(
        "INSERT INTO rule_executions (id, workspace_id, revision, execution_json) VALUES (?, ?, ?, ?)",
        [
          execution.id,
          execution.context.workspaceId,
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

  async list(
    workspaceId: string,
    actorId: string,
    limit: number,
    offset: number,
  ): Promise<readonly RuleExecution[]> {
    const rows = await this.database.all<{ execution_json: string }>(
      "SELECT execution_json FROM rule_executions WHERE workspace_id = ? AND json_extract(execution_json, '$.context.actorId') = ? ORDER BY json_extract(execution_json, '$.createdAt') DESC, id DESC LIMIT ? OFFSET ?",
      [workspaceId, actorId, limit, offset],
    );
    return rows.map((row) => JSON.parse(row.execution_json) as RuleExecution);
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
        "UPDATE rule_executions SET revision = ?, execution_json = ? WHERE id = ? AND revision = ?",
        [execution.revision, JSON.stringify(execution), execution.id, expectedRevision],
      );
    });
  }
}
