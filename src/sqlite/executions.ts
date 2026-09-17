import { resourceConflict } from "../errors/error.ts";
import {
  assertExecutionRevision,
  assertExecutionUpdate,
  type ExecutionStore,
  type RuleExecution,
} from "../persistence/executions.ts";
import type { SqliteDatabase } from "./gateway.ts";

export class SqliteExecutionStore implements ExecutionStore {
  constructor(private readonly database: SqliteDatabase) {}

  async initialize(): Promise<void> {
    await this.database.execute(`
      CREATE TABLE IF NOT EXISTS rule_executions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        execution_json TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rule_executions_workspace_id ON rule_executions(workspace_id);
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
