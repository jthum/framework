import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { ScopeHandle, ScopeConfig } from "../kernel/model.ts";
import type { PersistenceSession, CollectionSeed } from "../persistence/catalog.ts";
import type { RecordStore } from "../persistence/records.ts";
import type { SqliteDatabase } from "./gateway.ts";
import { SqliteRecordStore } from "./records.ts";
import { SqliteScopeStore } from "./scopes.ts";
import { SqliteRuleSubscriptionStore } from "./subscriptions.ts";

export interface ScopeDatabaseLocation {
  readonly workspaceId: string;
  readonly scope: ScopeHandle;
}

/** Callbacks must resolve distinct, stable databases, never the catalog database. */
export interface SqliteScopeDatabases {
  open(location: ScopeDatabaseLocation): SqliteDatabase | Promise<SqliteDatabase>;
  /** Optional physical cleanup after handles close. Must tolerate repeated calls and missing files. */
  remove?(location: ScopeDatabaseLocation): Promise<void>;
}

type Change =
  | {
      kind: "set";
      location: ScopeDatabaseLocation;
      config: ScopeConfig;
      seeds: readonly CollectionSeed[];
      hadCollections: boolean;
    }
  | { kind: "delete"; location: ScopeDatabaseLocation; hadCollections: boolean }
  | { kind: "workspace-delete"; workspaceId: string; locations: ScopeDatabaseLocation[] };

interface OpenScope {
  database: SqliteDatabase;
  records: SqliteRecordStore;
}

/** SQLite-only physical routing and recoverable schema lifecycle. Kernel sees the ordinary ports. */
export async function routeScopeDatabases(
  database: SqliteDatabase,
  session: PersistenceSession,
  options: SqliteScopeDatabases,
): Promise<PersistenceSession> {
  const handles = new Map<string, Promise<OpenScope>>();
  const ownedDatabases = new Set<SqliteDatabase>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const key = (location: ScopeDatabaseLocation) =>
    JSON.stringify([location.workspaceId, location.scope.kind, location.scope.id]);
  const schedule = <T>(work: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(resourceConflict("Persistence session is closed."));
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const open = async (location: ScopeDatabaseLocation): Promise<OpenScope> => {
    const id = key(location);
    let pending = handles.get(id);
    if (!pending) {
      pending = (async () => {
        const scopeDatabase = await options.open(structuredClone(location));
        if (scopeDatabase === database || ownedDatabases.has(scopeDatabase)) {
          throw resourceConflict("Each scope must have a distinct database handle.");
        }
        try {
          if (
            await scopeDatabase.get(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'persistence_layout'",
            )
          )
            throw resourceConflict("A catalog database cannot be used for scope records.");
          await scopeDatabase.execute(
            "CREATE TABLE IF NOT EXISTS scope_database_owner (id INTEGER PRIMARY KEY CHECK (id = 1), workspace_id TEXT NOT NULL, kind TEXT NOT NULL, scope_id TEXT NOT NULL, schema_version INTEGER NOT NULL)",
          );
          await scopeDatabase.transaction(async (connection) => {
            const owner = await connection.get<{
              workspace_id: string;
              kind: string;
              scope_id: string;
              schema_version: number;
            }>("SELECT * FROM scope_database_owner WHERE id = 1");
            if (
              owner &&
              (owner.workspace_id !== location.workspaceId ||
                owner.kind !== location.scope.kind ||
                owner.scope_id !== location.scope.id ||
                owner.schema_version !== 1)
            )
              throw resourceConflict(
                "Scope database belongs to another location or unsupported schema.",
              );
            if (!owner)
              await connection.run(
                "INSERT INTO scope_database_owner (id, workspace_id, kind, scope_id, schema_version) VALUES (1, ?, ?, ?, 1)",
                [location.workspaceId, location.scope.kind, location.scope.id],
              );
          });
          const records = new SqliteRecordStore(scopeDatabase);
          await records.initialize();
          ownedDatabases.add(scopeDatabase);
          return { database: scopeDatabase, records };
        } catch (error) {
          await scopeDatabase.close().catch(() => undefined);
          throw error;
        }
      })();
      handles.set(id, pending);
      pending.catch(() => handles.delete(id));
    }
    return pending;
  };
  const release = async (location: ScopeDatabaseLocation): Promise<void> => {
    const id = key(location);
    const pending = handles.get(id);
    if (pending) {
      const entry = await pending;
      await entry.database.close();
      ownedDatabases.delete(entry.database);
      handles.delete(id);
    }
    await options.remove?.(structuredClone(location));
  };
  const ensureReady = async (): Promise<void> => {
    if (await database.get("SELECT id FROM scope_changes LIMIT 1"))
      throw resourceConflict(
        "A scope lifecycle change requires recovery; reopen persistence before continuing.",
      );
  };
  const apply = async (change: Change): Promise<void> => {
    if (change.kind === "workspace-delete") {
      for (const location of change.locations) {
        const entry = await open(location);
        await entry.records.applySchema(location.workspaceId, []);
      }
      if (await session.catalog.getWorkspace(change.workspaceId))
        await session.deleteWorkspace(change.workspaceId);
      for (const location of change.locations) await release(location);
    } else {
      const hasCollections = change.kind === "set" && change.config.collections.length > 0;
      if (change.hadCollections || hasCollections) {
        const entry = await open(change.location);
        await entry.database.transaction(async (connection) => {
          await entry.records.applySchemaWith(
            connection,
            change.location.workspaceId,
            change.kind === "set" ? change.config.collections : [],
          );
          if (change.kind === "set")
            for (const seed of change.seeds)
              for (const record of seed.records)
                await entry.records.seedWith(
                  connection,
                  change.location.workspaceId,
                  seed.collection,
                  record,
                );
        });
      }
      await database.transaction(async (connection) => {
        const scopes = new SqliteScopeStore(connection);
        const subscriptions = new SqliteRuleSubscriptionStore(connection);
        if (change.kind === "set") {
          await scopes.set(change.location.workspaceId, change.location.scope, change.config);
          await connection.run(
            "DELETE FROM scope_record_routes WHERE workspace_id = ? AND kind = ? AND scope_id = ?",
            [change.location.workspaceId, change.location.scope.kind, change.location.scope.id],
          );
          for (const collection of change.config.collections)
            await connection.run(
              "INSERT INTO scope_record_routes (workspace_id, collection_id, kind, scope_id) VALUES (?, ?, ?, ?)",
              [
                change.location.workspaceId,
                collection.id,
                change.location.scope.kind,
                change.location.scope.id,
              ],
            );
          await subscriptions.replace(
            change.location.workspaceId,
            change.location.scope,
            change.config.rules,
          );
        } else {
          await scopes.delete(change.location.workspaceId, change.location.scope);
          await subscriptions.replace(change.location.workspaceId, change.location.scope, []);
        }
      });
      if (change.hadCollections && !hasCollections) await release(change.location);
    }
    await database.run("DELETE FROM scope_changes WHERE id = 1");
  };
  const change = async (value: Change): Promise<void> => {
    await database.transaction(async (connection) => {
      if (await connection.get("SELECT id FROM scope_changes LIMIT 1"))
        throw resourceConflict("Another scope lifecycle change is pending.");
      await connection.run("INSERT INTO scope_changes (id, change_json) VALUES (1, ?)", [
        JSON.stringify(value),
      ]);
    });
    await apply(value);
  };
  const store = async (workspaceId: string, collectionId: string): Promise<RecordStore> => {
    await ensureReady();
    const row = await database.get<{ kind: string; scope_id: string }>(
      "SELECT kind, scope_id FROM scope_record_routes WHERE workspace_id = ? AND collection_id = ?",
      [workspaceId, collectionId],
    );
    return row
      ? (await open({ workspaceId, scope: { kind: row.kind, id: row.scope_id } })).records
      : session.records;
  };
  const records: RecordStore = {
    applySchema: (workspaceId, collections) =>
      schedule(async () => {
        await ensureReady();
        await session.records.applySchema(workspaceId, collections);
      }),
    create: (workspaceId, collection, record) =>
      schedule(async () =>
        (await store(workspaceId, collection.id)).create(workspaceId, collection, record),
      ),
    get: (workspaceId, collection, id) =>
      schedule(async () =>
        (await store(workspaceId, collection.id)).get(workspaceId, collection, id),
      ),
    getMany: (workspaceId, collection, ids) =>
      schedule(async () =>
        (await store(workspaceId, collection.id)).getMany(workspaceId, collection, ids),
      ),
    list: (workspaceId, collection) =>
      schedule(async () => (await store(workspaceId, collection.id)).list(workspaceId, collection)),
    update: (workspaceId, collection, record) =>
      schedule(async () =>
        (await store(workspaceId, collection.id)).update(workspaceId, collection, record),
      ),
    delete: (workspaceId, collection, id) =>
      schedule(async () =>
        (await store(workspaceId, collection.id)).delete(workspaceId, collection, id),
      ),
  };
  const closeScopes = async (): Promise<void> => {
    const results = await Promise.allSettled(
      [...handles.values()].map(async (pending) => (await pending).database.close()),
    );
    handles.clear();
    ownedDatabases.clear();
    const failure = results.find((item) => item.status === "rejected");
    if (failure?.status === "rejected") throw failure.reason;
  };
  try {
    const pending = await database.get<{ change_json: string }>(
      "SELECT change_json FROM scope_changes WHERE id = 1",
    );
    if (pending) await apply(JSON.parse(pending.change_json) as Change);
  } catch (error) {
    await closeScopes().catch(() => undefined);
    throw new FrameworkError(
      {
        code: ERROR_CODES.persistenceUnsupported,
        message: "Scope lifecycle recovery could not complete.",
        retryable: true,
      },
      { cause: error },
    );
  }
  return {
    ...session,
    records,
    applyWorkspaceSpec: (workspace, seeds) =>
      schedule(async () => {
        await ensureReady();
        await session.applyWorkspaceSpec(workspace, seeds);
      }),
    applyScopeConfig: (workspace, scope, input, inputSeeds = []) => {
      const config = structuredClone(input);
      const seeds = structuredClone(inputSeeds);
      const location = structuredClone({ workspaceId: workspace.id, scope });
      return schedule(async () => {
        await ensureReady();
        const previous = await session.scopes.get(workspace.id, scope);
        await change({
          kind: "set",
          location,
          config,
          seeds,
          hadCollections: !!previous?.collections.length,
        });
      });
    },
    deleteScope: (workspace, scope) =>
      schedule(async () => {
        await ensureReady();
        const previous = await session.scopes.get(workspace.id, scope);
        await change({
          kind: "delete",
          location: { workspaceId: workspace.id, scope },
          hadCollections: !!previous?.collections.length,
        });
      }),
    deleteWorkspace: (workspaceId) =>
      schedule(async () => {
        await ensureReady();
        if (!(await session.catalog.getWorkspace(workspaceId)))
          throw resourceNotFound("Workspace", workspaceId);
        const entries = await session.scopes.list(workspaceId);
        await change({
          kind: "workspace-delete",
          workspaceId,
          locations: entries
            .filter((entry) => entry.config.collections.length)
            .map(({ scope }) => ({ workspaceId, scope })),
        });
      }),
    close: async () => {
      if (closed) return;
      closed = true;
      await queue;
      try {
        await closeScopes();
      } finally {
        await session.close();
      }
    },
  };
}
