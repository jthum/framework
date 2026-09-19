import type { WorkspaceConfig } from "../kernel/workspace-config.ts";
import type { WorkspaceConfigStore } from "../persistence/workspace-config.ts";
import type { SqliteConnection, SqliteDatabase } from "./gateway.ts";

export class SqliteWorkspaceConfigStore implements WorkspaceConfigStore {
  constructor(private readonly database: SqliteDatabase) {}

  async get(workspaceId: string): Promise<WorkspaceConfig> {
    const row = await this.database.get<{ config_json: string }>(
      "SELECT config_json FROM workspace_configs WHERE workspace_id = ?",
      [workspaceId],
    );
    return row ? (JSON.parse(row.config_json) as WorkspaceConfig) : { settings: [], actions: [] };
  }

  update(
    workspaceId: string,
    change: (current: WorkspaceConfig) => WorkspaceConfig,
  ): Promise<WorkspaceConfig> {
    return this.database.transaction(async (connection) => {
      const current = await readConfig(connection, workspaceId);
      const next = change(current);
      await connection.run(
        "INSERT INTO workspace_configs (workspace_id, config_json) VALUES (?, ?) ON CONFLICT (workspace_id) DO UPDATE SET config_json = excluded.config_json",
        [workspaceId, JSON.stringify(next)],
      );
      return next;
    });
  }
}

async function readConfig(
  connection: SqliteConnection,
  workspaceId: string,
): Promise<WorkspaceConfig> {
  const row = await connection.get<{ config_json: string }>(
    "SELECT config_json FROM workspace_configs WHERE workspace_id = ?",
    [workspaceId],
  );
  return row ? (JSON.parse(row.config_json) as WorkspaceConfig) : { settings: [], actions: [] };
}
