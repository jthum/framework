import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { ScopeHandle, ScopeConfig, Workspace } from "../kernel/model.ts";
import { assertWorkspaceTopologyUnchanged } from "../persistence/catalog-integrity.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { PersistenceSession, CollectionSeed } from "../persistence/catalog.ts";
import type { RecordStore } from "../persistence/records.ts";
import type { SqliteDatabase } from "./gateway.ts";
import { SqliteRecordStore } from "./records.ts";
import { SqliteScopeStore } from "./scopes.ts";
import { SqliteRuleSubscriptionStore } from "./subscriptions.ts";

export interface WorkspaceDatabaseLocation {
  readonly workspaceId: string;
}

export interface ScopeDatabaseLocation extends WorkspaceDatabaseLocation {
  readonly scope: ScopeHandle;
}

export interface SqliteWorkspaceDatabases {
  open(location: WorkspaceDatabaseLocation): SqliteDatabase | Promise<SqliteDatabase>;
  /** Idempotent physical cleanup after handles close. */
  remove?(location: WorkspaceDatabaseLocation): Promise<void>;
}

export interface SqlitePersistenceOptions {
  readonly workspaceDatabases?: SqliteWorkspaceDatabases;
  readonly scopeDatabases?: SqliteScopeDatabases;
}

interface RecordDatabaseLocation extends WorkspaceDatabaseLocation {
  readonly scope?: ScopeHandle;
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
      collections: readonly CollectionDefinition[];
    }
  | {
      kind: "delete";
      location: ScopeDatabaseLocation;
      hadCollections: boolean;
      collections: readonly CollectionDefinition[];
    }
  | {
      kind: "workspace-set";
      workspace: Workspace;
      collections: readonly CollectionDefinition[];
      seeds: readonly CollectionSeed[];
      hadCollections: boolean;
    }
  | { kind: "workspace-delete"; workspaceId: string; locations: RecordDatabaseLocation[] };

interface OpenRecordDatabase {
  database: SqliteDatabase;
  records: SqliteRecordStore;
}

/** SQLite-only physical routing and recoverable schema lifecycle. Kernel sees the ordinary ports. */
export async function routeDatabases(
  database: SqliteDatabase,
  session: PersistenceSession,
  options: SqlitePersistenceOptions,
): Promise<PersistenceSession> {
  const handles = new Map<string, Promise<OpenRecordDatabase>>();
  const ownedDatabases = new Set<SqliteDatabase>();
  let queue: Promise<unknown> = Promise.resolve();
  let closed = false;
  const key = (location: RecordDatabaseLocation) =>
    JSON.stringify([
      location.workspaceId,
      location.scope?.kind ?? null,
      location.scope?.id ?? null,
    ]);
  const target = (location: RecordDatabaseLocation): RecordDatabaseLocation =>
    options.scopeDatabases && location.scope ? location : { workspaceId: location.workspaceId };
  const schedule = <T>(work: () => Promise<T>): Promise<T> => {
    if (closed) return Promise.reject(resourceConflict("Persistence session is closed."));
    const result = queue.then(work);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const open = async (location: RecordDatabaseLocation): Promise<OpenRecordDatabase> => {
    const id = key(location);
    let pending = handles.get(id);
    if (!pending) {
      pending = (async () => {
        const recordDatabase = location.scope
          ? await options.scopeDatabases!.open(structuredClone(location) as ScopeDatabaseLocation)
          : await options.workspaceDatabases!.open({ workspaceId: location.workspaceId });
        if (recordDatabase === database || ownedDatabases.has(recordDatabase)) {
          throw resourceConflict("Each record location must have a distinct database handle.");
        }
        try {
          if (
            await recordDatabase.get(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'persistence_layout'",
            )
          )
            throw resourceConflict("A catalog database cannot be used for scope records.");
          await recordDatabase.execute(
            "CREATE TABLE IF NOT EXISTS record_database_owner (id INTEGER PRIMARY KEY CHECK (id = 1), workspace_id TEXT NOT NULL, kind TEXT, scope_id TEXT, schema_version INTEGER NOT NULL)",
          );
          await recordDatabase.transaction(async (connection) => {
            const owner = await connection.get<{
              workspace_id: string;
              kind: string | null;
              scope_id: string | null;
              schema_version: number;
            }>("SELECT * FROM record_database_owner WHERE id = 1");
            if (
              owner &&
              (owner.workspace_id !== location.workspaceId ||
                owner.kind !== (location.scope?.kind ?? null) ||
                owner.scope_id !== (location.scope?.id ?? null) ||
                owner.schema_version !== 1)
            )
              throw resourceConflict(
                "Record database belongs to another location or unsupported schema.",
              );
            if (!owner)
              await connection.run(
                "INSERT INTO record_database_owner (id, workspace_id, kind, scope_id, schema_version) VALUES (1, ?, ?, ?, 1)",
                [location.workspaceId, location.scope?.kind ?? null, location.scope?.id ?? null],
              );
          });
          const records = new SqliteRecordStore(recordDatabase);
          await records.initialize();
          ownedDatabases.add(recordDatabase);
          return { database: recordDatabase, records };
        } catch (error) {
          await recordDatabase.close().catch(() => undefined);
          throw error;
        }
      })();
      handles.set(id, pending);
      pending.catch(() => handles.delete(id));
    }
    return pending;
  };
  const release = async (location: RecordDatabaseLocation): Promise<void> => {
    const id = key(location);
    const pending = handles.get(id);
    if (pending) {
      const entry = await pending;
      await entry.database.close();
      ownedDatabases.delete(entry.database);
      handles.delete(id);
    }
    if (location.scope)
      await options.scopeDatabases?.remove?.(structuredClone(location) as ScopeDatabaseLocation);
    else await options.workspaceDatabases?.remove?.({ workspaceId: location.workspaceId });
  };
  const ensureReady = async (): Promise<void> => {
    if (await database.get("SELECT id FROM record_changes LIMIT 1"))
      throw resourceConflict(
        "A record storage lifecycle change requires recovery; reopen persistence before continuing.",
      );
  };
  const scopedCollections = async (
    workspaceId: string,
    scope: ScopeHandle,
    config: ScopeConfig | null,
  ): Promise<{ collections: readonly CollectionDefinition[]; hadCollections: boolean }> => {
    const workspace = await session.catalog.getWorkspace(workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", workspaceId);
    const previous = await session.scopes.get(workspaceId, scope);
    if (options.scopeDatabases)
      return {
        collections: config?.collections ?? [],
        hadCollections: !!previous?.collections.length,
      };
    const entries = await session.scopes.list(workspaceId);
    return {
      collections: [
        ...workspace.spec.collections,
        ...entries
          .filter((entry) => entry.scope.kind !== scope.kind || entry.scope.id !== scope.id)
          .flatMap((entry) => entry.config.collections),
        ...(config?.collections ?? []),
      ],
      hadCollections:
        !!workspace.spec.collections.length ||
        entries.some((entry) => entry.config.collections.length > 0),
    };
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
    } else if (change.kind === "workspace-set") {
      if (change.hadCollections || change.collections.length) {
        const entry = await open({ workspaceId: change.workspace.id });
        await entry.database.transaction(async (connection) => {
          await entry.records.applySchemaWith(connection, change.workspace.id, change.collections);
          for (const seed of change.seeds)
            for (const record of seed.records)
              await entry.records.seedWith(
                connection,
                change.workspace.id,
                seed.collection,
                record,
              );
        });
      }
      await session.applyWorkspaceSpec(change.workspace);
    } else {
      const hasCollections = change.collections.length > 0;
      if (change.hadCollections || hasCollections) {
        const entry = await open(target(change.location));
        await entry.database.transaction(async (connection) => {
          await entry.records.applySchemaWith(
            connection,
            change.location.workspaceId,
            change.collections,
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
      if (options.scopeDatabases && change.hadCollections && !hasCollections)
        await release(change.location);
    }
    await database.run("DELETE FROM record_changes WHERE id = 1");
  };
  const change = async (value: Change): Promise<void> => {
    await database.transaction(async (connection) => {
      if (await connection.get("SELECT id FROM record_changes LIMIT 1"))
        throw resourceConflict("Another record storage lifecycle change is pending.");
      await connection.run("INSERT INTO record_changes (id, change_json) VALUES (1, ?)", [
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
    return row && options.scopeDatabases
      ? (await open({ workspaceId, scope: { kind: row.kind, id: row.scope_id } })).records
      : options.workspaceDatabases
        ? (await open({ workspaceId })).records
        : session.records;
  };
  const records: RecordStore = {
    applySchema: (workspaceId, collections) =>
      schedule(async () => {
        await ensureReady();
        if (options.workspaceDatabases)
          await (await open({ workspaceId })).records.applySchema(workspaceId, collections);
        else await session.records.applySchema(workspaceId, collections);
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
  const closeRecordDatabases = async (): Promise<void> => {
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
      "SELECT change_json FROM record_changes WHERE id = 1",
    );
    if (pending) await apply(JSON.parse(pending.change_json) as Change);
  } catch (error) {
    await closeRecordDatabases().catch(() => undefined);
    throw new FrameworkError(
      {
        code: ERROR_CODES.persistenceUnsupported,
        message: "Record storage lifecycle recovery could not complete.",
        retryable: true,
      },
      { cause: error },
    );
  }
  return {
    ...session,
    records,
    applyWorkspaceSpec: (input, inputSeeds = []) => {
      const workspace = structuredClone(input);
      const seeds = structuredClone(inputSeeds);
      return schedule(async () => {
        await ensureReady();
        if (!options.workspaceDatabases) return session.applyWorkspaceSpec(workspace, seeds);
        const current = await session.catalog.getWorkspace(workspace.id);
        if (!current) throw resourceNotFound("Workspace", workspace.id);
        assertWorkspaceTopologyUnchanged(current, workspace);
        assertUniqueSeeds(seeds);
        const local = options.scopeDatabases
          ? []
          : (await session.scopes.list(workspace.id)).flatMap((entry) => entry.config.collections);
        await change({
          kind: "workspace-set",
          workspace,
          seeds,
          collections: [...workspace.spec.collections, ...local],
          hadCollections: current.spec.collections.length > 0 || local.length > 0,
        });
      });
    },
    applyScopeConfig: (workspace, scope, input, inputSeeds = []) => {
      const config = structuredClone(input);
      const seeds = structuredClone(inputSeeds);
      const location = structuredClone({ workspaceId: workspace.id, scope });
      return schedule(async () => {
        await ensureReady();
        assertUniqueSeeds(seeds);
        const schema = await scopedCollections(workspace.id, scope, config);
        await change({
          kind: "set",
          location,
          config,
          seeds,
          ...schema,
        });
      });
    },
    deleteScope: (workspace, scope) =>
      schedule(async () => {
        await ensureReady();
        const schema = await scopedCollections(workspace.id, scope, null);
        await change({
          kind: "delete",
          location: { workspaceId: workspace.id, scope },
          ...schema,
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
          locations: [
            ...entries
              .filter((entry) => options.scopeDatabases && entry.config.collections.length)
              .map(({ scope }) => ({ workspaceId, scope })),
            ...(options.workspaceDatabases ? [{ workspaceId }] : []),
          ],
        });
      }),
    close: async () => {
      if (closed) return;
      closed = true;
      await queue;
      try {
        await closeRecordDatabases();
      } finally {
        await session.close();
      }
    },
  };
}

function assertUniqueSeeds(seeds: readonly CollectionSeed[]): void {
  const seen = new Set<string>();
  for (const seed of seeds)
    for (const record of seed.records) {
      const id = JSON.stringify([seed.collection.id, record.id]);
      if (seen.has(id)) throw resourceConflict("Initial records contain duplicate identities.");
      seen.add(id);
    }
}
