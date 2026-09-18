import type { ScopeHandle } from "../kernel/model.ts";
import type { CollectionScope, ScopeStore } from "../persistence/scopes.ts";
import type { SqliteConnection } from "./gateway.ts";

export class SqliteScopeStore implements ScopeStore {
  constructor(private readonly connection: SqliteConnection) {}

  async get(workspaceId: string, collectionId: string): Promise<ScopeHandle | null> {
    const row = await this.connection.get<{ kind: string; scope_id: string }>(
      "SELECT kind, scope_id FROM collection_scopes WHERE workspace_id = ? AND collection_id = ?",
      [workspaceId, collectionId],
    );
    return row ? { kind: row.kind, id: row.scope_id } : null;
  }

  async list(workspaceId: string): Promise<CollectionScope[]> {
    const rows = await this.connection.all<{
      collection_id: string;
      kind: string;
      scope_id: string;
    }>(
      "SELECT collection_id, kind, scope_id FROM collection_scopes WHERE workspace_id = ? ORDER BY collection_id",
      [workspaceId],
    );
    return rows.map((row) => ({
      collectionId: row.collection_id,
      scope: { kind: row.kind, id: row.scope_id },
    }));
  }

  async set(workspaceId: string, collectionId: string, scope: ScopeHandle | null): Promise<void> {
    if (scope === null) {
      await this.connection.run(
        "DELETE FROM collection_scopes WHERE workspace_id = ? AND collection_id = ?",
        [workspaceId, collectionId],
      );
      return;
    }
    await this.connection.run(
      "INSERT INTO collection_scopes (workspace_id, collection_id, kind, scope_id) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, collection_id) DO UPDATE SET kind = excluded.kind, scope_id = excluded.scope_id",
      [workspaceId, collectionId, scope.kind, scope.id],
    );
  }
}
