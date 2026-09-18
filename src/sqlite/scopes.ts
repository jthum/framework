import type { ScopeConfig, ScopeHandle } from "../kernel/model.ts";
import type { ScopeEntry, ScopeStore } from "../persistence/scopes.ts";
import type { SqliteConnection } from "./gateway.ts";

interface ScopeRow {
  workspace_id: string;
  kind: string;
  scope_id: string;
  config_json: string;
}

export class SqliteScopeStore implements ScopeStore {
  constructor(private readonly connection: SqliteConnection) {}

  async get(workspaceId: string, scope: ScopeHandle): Promise<ScopeConfig | null> {
    const row = await this.connection.get<ScopeRow>(
      "SELECT * FROM scope_configs WHERE workspace_id = ? AND kind = ? AND scope_id = ?",
      [workspaceId, scope.kind, scope.id],
    );
    return row ? (JSON.parse(row.config_json) as ScopeConfig) : null;
  }

  async list(workspaceId: string): Promise<ScopeEntry[]> {
    const rows = await this.connection.all<ScopeRow>(
      "SELECT * FROM scope_configs WHERE workspace_id = ? ORDER BY kind, scope_id",
      [workspaceId],
    );
    return rows.map((row) => ({
      workspaceId,
      scope: { kind: row.kind, id: row.scope_id },
      config: JSON.parse(row.config_json) as ScopeConfig,
    }));
  }

  async set(workspaceId: string, scope: ScopeHandle, config: ScopeConfig): Promise<void> {
    await this.connection.run(
      "INSERT INTO scope_configs (workspace_id, kind, scope_id, config_json) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, kind, scope_id) DO UPDATE SET config_json = excluded.config_json",
      [workspaceId, scope.kind, scope.id, JSON.stringify(config)],
    );
  }

  async delete(workspaceId: string, scope: ScopeHandle): Promise<void> {
    await this.connection.run(
      "DELETE FROM scope_configs WHERE workspace_id = ? AND kind = ? AND scope_id = ?",
      [workspaceId, scope.kind, scope.id],
    );
  }
}
