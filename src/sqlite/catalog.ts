import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type {
  Actor,
  ActorKind,
  AgentConfig,
  Attachment,
  Membership,
  ModelConfig,
  Workspace,
} from "../kernel/model.ts";
import type {
  CatalogRepository,
  CatalogTransaction,
  PersistenceAdapter,
  PersistenceSession,
} from "../persistence/catalog.ts";
import { SqliteRecordStore } from "./records.ts";
import { SqliteScopeStore } from "./scopes.ts";
import { SqliteRuleSubscriptionStore } from "./subscriptions.ts";
import { SqliteExecutionStore } from "./executions.ts";
import { routeScopeDatabases, type SqliteScopeDatabases } from "./scope-databases.ts";
import {
  assertActorIntegrity,
  assertActorIdentityUnchanged,
  assertAgentConfigIdentityUnchanged,
  assertAgentConfigIntegrity,
  assertAttachmentIntegrity,
  assertAttachmentRevocation,
  assertMembershipIdentityUnchanged,
  assertMembershipIntegrity,
  assertModelConfigIdentityUnchanged,
  assertModelConfigIntegrity,
  assertWorkspaceIntegrity,
  assertWorkspaceTopologyUnchanged,
} from "../persistence/catalog-integrity.ts";
import type { Spec } from "../spec/model.ts";
import type {
  OpenSqliteDatabase,
  SqliteConnection,
  SqliteDatabase,
  SqliteParameters,
} from "./gateway.ts";

export class SqlitePersistenceAdapter implements PersistenceAdapter {
  readonly kind = "sqlite";

  constructor(
    private readonly openDatabase: OpenSqliteDatabase,
    private readonly options: { readonly scopeDatabases?: SqliteScopeDatabases } = {},
  ) {}

  async open(): Promise<PersistenceSession> {
    const database = await this.openDatabase();
    const records = new SqliteRecordStore(database);
    const executions = new SqliteExecutionStore(database);
    try {
      await initializeCatalog(database);
      await database.transaction(async (connection) => {
        const desired = this.options.scopeDatabases ? "scoped" : "single";
        const row = await connection.get<{ mode: string }>(
          "SELECT mode FROM persistence_layout WHERE id = 1",
        );
        if (row && row.mode !== desired)
          throw new FrameworkError({
            code: ERROR_CODES.persistenceUnsupported,
            message: "The configured SQLite layout does not match persisted storage.",
          });
        if (!row)
          await connection.run("INSERT INTO persistence_layout (id, mode) VALUES (1, ?)", [
            desired,
          ]);
      });
      await records.initialize();
      await executions.initialize();
    } catch (error) {
      try {
        await database.close();
      } catch {
        /* Preserve the initialization error. */
      }
      throw error;
    }
    const session: PersistenceSession = {
      scopes: new SqliteScopeStore(database),
      subscriptions: new SqliteRuleSubscriptionStore(database),
      executions,
      catalog: new SqliteCatalogRepository(database),
      records,
      applyWorkspaceSpec: (workspace, seeds = []) =>
        database.transaction(async (connection) => {
          const scopes = new SqliteScopeStore(connection);
          await records.applySchemaWith(connection, workspace.id, [
            ...workspace.spec.collections,
            ...(this.options.scopeDatabases
              ? []
              : (await scopes.list(workspace.id)).flatMap((entry) => entry.config.collections)),
          ]);
          for (const seed of seeds)
            for (const record of seed.records)
              await records.createWith(connection, workspace.id, seed.collection, record);
          await updateWorkspace(connection, workspace);
          await new SqliteRuleSubscriptionStore(connection).replace(
            workspace.id,
            undefined,
            workspace.spec.rules,
          );
        }),
      applyScopeConfig: (workspace, scope, config, seeds = []) =>
        database.transaction(async (connection) => {
          const scopes = new SqliteScopeStore(connection);
          await scopes.set(workspace.id, scope, config);
          await new SqliteRuleSubscriptionStore(connection).replace(
            workspace.id,
            scope,
            config.rules,
          );
          await records.applySchemaWith(connection, workspace.id, [
            ...workspace.spec.collections,
            ...(await scopes.list(workspace.id)).flatMap((entry) => entry.config.collections),
          ]);
          for (const seed of seeds)
            for (const record of seed.records)
              await records.createWith(connection, workspace.id, seed.collection, record);
        }),
      deleteScope: (workspace, scope) =>
        database.transaction(async (connection) => {
          const scopes = new SqliteScopeStore(connection);
          await scopes.delete(workspace.id, scope);
          await new SqliteRuleSubscriptionStore(connection).replace(workspace.id, scope, []);
          await records.applySchemaWith(connection, workspace.id, [
            ...workspace.spec.collections,
            ...(await scopes.list(workspace.id)).flatMap((entry) => entry.config.collections),
          ]);
        }),
      deleteWorkspace: (workspaceId) =>
        database.transaction(async (connection) => {
          if (!(await connection.get("SELECT id FROM workspaces WHERE id = ?", [workspaceId])))
            throw resourceNotFound("Workspace", workspaceId);
          await records.deleteWorkspaceWith(connection, workspaceId);
          await connection.run("DELETE FROM workspaces WHERE id = ?", [workspaceId]);
        }),
      close: () => database.close(),
    };
    if (!this.options.scopeDatabases) return session;
    try {
      return await routeScopeDatabases(database, session, this.options.scopeDatabases);
    } catch (error) {
      await database.close().catch(() => undefined);
      throw error;
    }
  }
}

export const SQLITE_CATALOG_SCHEMA_VERSION = 13;

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getAttachment(id: string): Promise<Attachment | null> {
    return reader(this.database).getAttachment(id);
  }
  getAttachmentBySource(targetId: string, sourceId: string): Promise<Attachment | null> {
    return reader(this.database).getAttachmentBySource(targetId, sourceId);
  }
  listAttachmentsTo(targetId: string): Promise<Attachment[]> {
    return reader(this.database).listAttachmentsTo(targetId);
  }
  listAttachmentsFrom(originId: string): Promise<Attachment[]> {
    return reader(this.database).listAttachmentsFrom(originId);
  }

  getWorkspace(id: string): Promise<Workspace | null> {
    return reader(this.database).getWorkspace(id);
  }

  listRootWorkspaces(): Promise<Workspace[]> {
    return reader(this.database).listRootWorkspaces();
  }

  listChildWorkspaces(parentId: string): Promise<Workspace[]> {
    return reader(this.database).listChildWorkspaces(parentId);
  }

  listWorkspacesByRoot(rootId: string): Promise<Workspace[]> {
    return reader(this.database).listWorkspacesByRoot(rootId);
  }

  getActor(id: string): Promise<Actor | null> {
    return reader(this.database).getActor(id);
  }

  listActorsByOrigin(originId: string): Promise<Actor[]> {
    return reader(this.database).listActorsByOrigin(originId);
  }

  listActorsByRoot(rootId: string): Promise<Actor[]> {
    return reader(this.database).listActorsByRoot(rootId);
  }

  getModelConfig(id: string): Promise<ModelConfig | null> {
    return reader(this.database).getModelConfig(id);
  }

  listModelConfigs(workspaceId: string): Promise<ModelConfig[]> {
    return reader(this.database).listModelConfigs(workspaceId);
  }

  getAgentConfig(actorId: string): Promise<AgentConfig | null> {
    return reader(this.database).getAgentConfig(actorId);
  }

  listMembers(workspaceId: string): Promise<Actor[]> {
    return reader(this.database).listMembers(workspaceId);
  }

  getMembership(actorId: string, workspaceId: string): Promise<Membership | null> {
    return reader(this.database).getMembership(actorId, workspaceId);
  }

  listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return reader(this.database).listMembershipsForActor(actorId);
  }

  listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return reader(this.database).listMembershipsForWorkspace(workspaceId);
  }

  transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T> {
    return this.database.transaction((connection) =>
      work(new SqliteCatalogTransaction(connection)),
    );
  }
}

class SqliteCatalogTransaction implements CatalogTransaction {
  constructor(private readonly connection: SqliteConnection) {}

  getAttachment(id: string): Promise<Attachment | null> {
    return reader(this.connection).getAttachment(id);
  }
  getAttachmentBySource(targetId: string, sourceId: string): Promise<Attachment | null> {
    return reader(this.connection).getAttachmentBySource(targetId, sourceId);
  }
  listAttachmentsTo(targetId: string): Promise<Attachment[]> {
    return reader(this.connection).listAttachmentsTo(targetId);
  }
  listAttachmentsFrom(originId: string): Promise<Attachment[]> {
    return reader(this.connection).listAttachmentsFrom(originId);
  }

  async insertAttachment(attachment: Attachment): Promise<void> {
    await assertAttachmentIntegrity(this, attachment);
    await insert(this.connection, "attachments", [
      attachment.id,
      attachment.parentId ?? null,
      attachment.sourceId,
      attachment.originId,
      attachment.targetId,
      attachment.collectionId,
      attachment.filter === undefined ? null : JSON.stringify(attachment.filter),
      JSON.stringify(attachment.permissions),
      attachment.allowReshare ? 1 : 0,
      attachment.createdBy,
      attachment.createdAt,
    ]);
  }

  async revokeAttachment(id: string, actorId: string, stamp: string): Promise<void> {
    const attachment = await this.getAttachment(id);
    if (!attachment) throw resourceNotFound("Attachment", id);
    await assertAttachmentRevocation(this, attachment, actorId);
    await this.connection.run(
      "UPDATE attachments SET revoked_at = ?, revoked_by = ? WHERE id = ? AND revoked_at IS NULL",
      [stamp, actorId, id],
    );
  }

  getWorkspace(id: string): Promise<Workspace | null> {
    return reader(this.connection).getWorkspace(id);
  }

  listRootWorkspaces(): Promise<Workspace[]> {
    return reader(this.connection).listRootWorkspaces();
  }

  listChildWorkspaces(parentId: string): Promise<Workspace[]> {
    return reader(this.connection).listChildWorkspaces(parentId);
  }

  listWorkspacesByRoot(rootId: string): Promise<Workspace[]> {
    return reader(this.connection).listWorkspacesByRoot(rootId);
  }

  getActor(id: string): Promise<Actor | null> {
    return reader(this.connection).getActor(id);
  }

  listActorsByOrigin(originId: string): Promise<Actor[]> {
    return reader(this.connection).listActorsByOrigin(originId);
  }

  listActorsByRoot(rootId: string): Promise<Actor[]> {
    return reader(this.connection).listActorsByRoot(rootId);
  }

  getModelConfig(id: string): Promise<ModelConfig | null> {
    return reader(this.connection).getModelConfig(id);
  }

  listModelConfigs(workspaceId: string): Promise<ModelConfig[]> {
    return reader(this.connection).listModelConfigs(workspaceId);
  }

  getAgentConfig(actorId: string): Promise<AgentConfig | null> {
    return reader(this.connection).getAgentConfig(actorId);
  }

  listMembers(workspaceId: string): Promise<Actor[]> {
    return reader(this.connection).listMembers(workspaceId);
  }

  getMembership(actorId: string, workspaceId: string): Promise<Membership | null> {
    return reader(this.connection).getMembership(actorId, workspaceId);
  }

  listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return reader(this.connection).listMembershipsForActor(actorId);
  }

  listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return reader(this.connection).listMembershipsForWorkspace(workspaceId);
  }

  async insertWorkspace(workspace: Workspace): Promise<void> {
    await assertWorkspaceIntegrity(this, workspace);
    await insert(this.connection, "workspaces", [
      workspace.id,
      workspace.isRoot ? 1 : 0,
      workspace.parentId,
      workspace.rootId,
      workspace.name,
      workspace.createdBy ?? null,
      JSON.stringify(workspace.access),
      JSON.stringify(workspace.policy),
      JSON.stringify(workspace.spec),
      workspace.createdAt,
      workspace.updatedAt,
    ]);
  }

  async insertActor(actor: Actor): Promise<void> {
    await assertActorIntegrity(this, actor);
    await insert(this.connection, "actors", [
      actor.id,
      actor.originId,
      actor.rootId,
      actor.kind,
      actor.name,
      actor.email ?? null,
      actor.createdAt,
      actor.updatedAt,
    ]);
  }

  async updateActor(actor: Actor): Promise<void> {
    const row = await this.connection.get<ActorRow>("SELECT * FROM actors WHERE id = ?", [
      actor.id,
    ]);
    if (!row) throw resourceNotFound("Actor", actor.id);
    assertActorIdentityUnchanged(actorFromRow(row), actor);
    await assertActorIntegrity(this, actor);
    await this.connection.run(
      "UPDATE actors SET name = ?, email = ?, updated_at = ? WHERE id = ?",
      [actor.name, actor.email ?? null, actor.updatedAt, actor.id],
    );
  }

  async insertModelConfig(config: ModelConfig): Promise<void> {
    await assertModelConfigIntegrity(this, config);
    await insert(this.connection, "model_configs", [
      config.id,
      config.workspaceId,
      config.name,
      config.provider,
      config.model,
      config.credentialRef ?? null,
      config.settings === undefined ? null : JSON.stringify(config.settings),
      config.createdAt,
      config.updatedAt,
    ]);
  }

  async updateModelConfig(config: ModelConfig): Promise<void> {
    const current = await this.getModelConfig(config.id);
    if (!current) throw resourceNotFound("ModelConfig", config.id);
    assertModelConfigIdentityUnchanged(current, config);
    await assertModelConfigIntegrity(this, config);
    await this.connection.run(
      "UPDATE model_configs SET name = ?, provider = ?, model = ?, credential_ref = ?, settings_json = ?, updated_at = ? WHERE id = ?",
      [
        config.name,
        config.provider,
        config.model,
        config.credentialRef ?? null,
        config.settings === undefined ? null : JSON.stringify(config.settings),
        config.updatedAt,
        config.id,
      ],
    );
  }

  async deleteModelConfig(id: string): Promise<void> {
    if (!(await this.getModelConfig(id))) throw resourceNotFound("ModelConfig", id);
    try {
      await this.connection.run("DELETE FROM model_configs WHERE id = ?", [id]);
    } catch (error) {
      if (isConstraintError(error)) throw resourceConflict("ModelConfig is used by an Agent.");
      throw error;
    }
  }

  async insertAgentConfig(config: AgentConfig): Promise<void> {
    await assertAgentConfigIntegrity(this, config);
    await insert(this.connection, "agent_configs", [
      config.actorId,
      config.modelConfigId,
      config.instructions,
      JSON.stringify(config.tools),
      config.createdAt,
      config.updatedAt,
    ]);
  }

  async updateAgentConfig(config: AgentConfig): Promise<void> {
    const current = await this.getAgentConfig(config.actorId);
    if (!current) throw resourceNotFound("AgentConfig", config.actorId);
    assertAgentConfigIdentityUnchanged(current, config);
    await assertAgentConfigIntegrity(this, config);
    await this.connection.run(
      "UPDATE agent_configs SET model_config_id = ?, instructions = ?, tools_json = ?, updated_at = ? WHERE actor_id = ?",
      [
        config.modelConfigId,
        config.instructions,
        JSON.stringify(config.tools),
        config.updatedAt,
        config.actorId,
      ],
    );
  }

  async insertMembership(membership: Membership): Promise<void> {
    await assertMembershipIntegrity(this, membership);
    await insert(this.connection, "memberships", [
      membership.id,
      membership.actorId,
      membership.workspaceId,
      JSON.stringify(membership.roles),
      JSON.stringify(membership.permissions),
      membership.createdAt,
      membership.updatedAt,
    ]);
  }

  async updateMembership(membership: Membership): Promise<void> {
    const row = await this.connection.get<MembershipRow>("SELECT * FROM memberships WHERE id = ?", [
      membership.id,
    ]);
    if (!row) throw resourceNotFound("Membership", membership.id);
    const existing = membershipFromRow(row);
    assertMembershipIdentityUnchanged(existing, membership);
    await assertMembershipIntegrity(this, membership);
    await this.connection.run(
      "UPDATE memberships SET roles_json = ?, permissions_json = ?, updated_at = ? WHERE id = ?",
      [
        JSON.stringify(membership.roles),
        JSON.stringify(membership.permissions),
        membership.updatedAt,
        membership.id,
      ],
    );
  }

  async updateWorkspace(workspace: Workspace): Promise<void> {
    await assertWorkspaceIntegrity(this, workspace);
    await updateWorkspace(this.connection, workspace);
  }
}

async function updateWorkspace(connection: SqliteConnection, workspace: Workspace): Promise<void> {
  const existing = await connection.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", [
    workspace.id,
  ]);
  if (!existing) throw resourceNotFound("Workspace", workspace.id);
  assertWorkspaceTopologyUnchanged(workspaceFromRow(existing), workspace);
  await connection.run(
    "UPDATE workspaces SET name = ?, created_by = ?, access_json = ?, policy_json = ?, spec_json = ?, updated_at = ? WHERE id = ?",
    [
      workspace.name,
      workspace.createdBy ?? null,
      JSON.stringify(workspace.access),
      JSON.stringify(workspace.policy),
      JSON.stringify(workspace.spec),
      workspace.updatedAt,
      workspace.id,
    ],
  );
}

class SqliteCatalogReader {
  constructor(private readonly connection: SqliteConnection) {}

  async getAttachment(id: string): Promise<Attachment | null> {
    const row = await this.connection.get<AttachmentRow>("SELECT * FROM attachments WHERE id = ?", [
      id,
    ]);
    return row ? attachmentFromRow(row) : null;
  }
  async getAttachmentBySource(targetId: string, sourceId: string): Promise<Attachment | null> {
    const row = await this.connection.get<AttachmentRow>(
      "SELECT * FROM attachments WHERE target_id = ? AND source_id = ? AND revoked_at IS NULL",
      [targetId, sourceId],
    );
    return row ? attachmentFromRow(row) : null;
  }
  async listAttachmentsTo(targetId: string): Promise<Attachment[]> {
    return (
      await this.connection.all<AttachmentRow>(
        "SELECT * FROM attachments WHERE target_id = ? ORDER BY created_at, id",
        [targetId],
      )
    ).map(attachmentFromRow);
  }

  async listAttachmentsFrom(originId: string): Promise<Attachment[]> {
    return (
      await this.connection.all<AttachmentRow>(
        "SELECT * FROM attachments WHERE origin_id = ? ORDER BY created_at, id",
        [originId],
      )
    ).map(attachmentFromRow);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await this.connection.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", [
      id,
    ]);
    return row ? workspaceFromRow(row) : null;
  }

  async listRootWorkspaces(): Promise<Workspace[]> {
    return (
      await this.connection.all<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE is_root = 1 ORDER BY created_at, id",
      )
    ).map(workspaceFromRow);
  }

  async listChildWorkspaces(parentId: string): Promise<Workspace[]> {
    return (
      await this.connection.all<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE parent_id = ? ORDER BY created_at, id",
        [parentId],
      )
    ).map(workspaceFromRow);
  }

  async listWorkspacesByRoot(rootId: string): Promise<Workspace[]> {
    return (
      await this.connection.all<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE root_id = ? ORDER BY created_at, id",
        [rootId],
      )
    ).map(workspaceFromRow);
  }

  async getActor(id: string): Promise<Actor | null> {
    const row = await this.connection.get<ActorRow>("SELECT * FROM actors WHERE id = ?", [id]);
    return row ? actorFromRow(row) : null;
  }

  async listActorsByOrigin(originId: string): Promise<Actor[]> {
    return (
      await this.connection.all<ActorRow>(
        "SELECT * FROM actors WHERE origin_id = ? ORDER BY created_at, id",
        [originId],
      )
    ).map(actorFromRow);
  }

  async listActorsByRoot(rootId: string): Promise<Actor[]> {
    return (
      await this.connection.all<ActorRow>(
        "SELECT * FROM actors WHERE root_id = ? ORDER BY created_at, id",
        [rootId],
      )
    ).map(actorFromRow);
  }

  async getModelConfig(id: string): Promise<ModelConfig | null> {
    const row = await this.connection.get<ModelConfigRow>(
      "SELECT * FROM model_configs WHERE id = ?",
      [id],
    );
    return row ? modelConfigFromRow(row) : null;
  }

  async listModelConfigs(workspaceId: string): Promise<ModelConfig[]> {
    return (
      await this.connection.all<ModelConfigRow>(
        "SELECT * FROM model_configs WHERE workspace_id = ? ORDER BY created_at, id",
        [workspaceId],
      )
    ).map(modelConfigFromRow);
  }

  async getAgentConfig(actorId: string): Promise<AgentConfig | null> {
    const row = await this.connection.get<AgentConfigRow>(
      "SELECT * FROM agent_configs WHERE actor_id = ?",
      [actorId],
    );
    return row ? agentConfigFromRow(row) : null;
  }

  async listMembers(workspaceId: string): Promise<Actor[]> {
    return (
      await this.connection.all<ActorRow>(
        `SELECT actors.* FROM actors
         INNER JOIN memberships ON memberships.actor_id = actors.id
         WHERE memberships.workspace_id = ?
         ORDER BY actors.created_at, actors.id`,
        [workspaceId],
      )
    ).map(actorFromRow);
  }

  async getMembership(actorId: string, workspaceId: string): Promise<Membership | null> {
    const row = await this.connection.get<MembershipRow>(
      "SELECT * FROM memberships WHERE actor_id = ? AND workspace_id = ?",
      [actorId, workspaceId],
    );
    return row ? membershipFromRow(row) : null;
  }

  async listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return (
      await this.connection.all<MembershipRow>(
        "SELECT * FROM memberships WHERE actor_id = ? ORDER BY created_at, id",
        [actorId],
      )
    ).map(membershipFromRow);
  }

  async listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return (
      await this.connection.all<MembershipRow>(
        "SELECT * FROM memberships WHERE workspace_id = ? ORDER BY created_at, id",
        [workspaceId],
      )
    ).map(membershipFromRow);
  }
}

function reader(connection: SqliteConnection): SqliteCatalogReader {
  return new SqliteCatalogReader(connection);
}

async function initializeCatalog(database: SqliteDatabase): Promise<void> {
  const version = await readSchemaVersion(database);
  if (version !== 0 && version !== SQLITE_CATALOG_SCHEMA_VERSION) {
    throw new FrameworkError({
      code: ERROR_CODES.persistenceUnsupported,
      message: "The SQLite catalog schema version is not supported.",
      details: {
        actualVersion: version,
        supportedVersion: SQLITE_CATALOG_SCHEMA_VERSION,
      },
    });
  }

  await database.execute(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS persistence_layout (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL CHECK (mode IN ('single', 'scoped'))
    );
    CREATE TABLE IF NOT EXISTS scope_changes (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      change_json TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      is_root INTEGER NOT NULL CHECK (is_root IN (0, 1)),
      parent_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
      root_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by TEXT,
      access_json TEXT NOT NULL,
      policy_json TEXT NOT NULL,
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK (
        (is_root = 1 AND parent_id IS NULL AND root_id = id)
        OR (is_root = 0 AND parent_id IS NOT NULL)
      )
    );

    CREATE INDEX IF NOT EXISTS workspaces_parent_id ON workspaces(parent_id);
    CREATE INDEX IF NOT EXISTS workspaces_root_id ON workspaces(root_id);

    CREATE TABLE IF NOT EXISTS scope_configs (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      config_json TEXT NOT NULL,
      PRIMARY KEY (workspace_id, kind, scope_id)
    );

    CREATE TABLE IF NOT EXISTS scope_record_routes (
      workspace_id TEXT NOT NULL,
      collection_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      PRIMARY KEY (workspace_id, collection_id),
      FOREIGN KEY (workspace_id, kind, scope_id) REFERENCES scope_configs(workspace_id, kind, scope_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS scope_record_routes_scope ON scope_record_routes(workspace_id, kind, scope_id);

    CREATE TABLE IF NOT EXISTS rule_subscriptions (
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      scope_kind TEXT,
      scope_id TEXT,
      event TEXT NOT NULL,
      rule_id TEXT NOT NULL,
      CHECK ((scope_kind IS NULL AND scope_id IS NULL) OR (scope_kind IS NOT NULL AND scope_id IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS rule_subscriptions_match ON rule_subscriptions(workspace_id, event, scope_kind, scope_id);

    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      origin_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      root_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('user', 'agent', 'system')),
      name TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS actors_origin_id ON actors(origin_id);
    CREATE INDEX IF NOT EXISTS actors_root_id ON actors(root_id);

    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      credential_ref TEXT,
      settings_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS model_configs_workspace_id ON model_configs(workspace_id);

    CREATE TABLE IF NOT EXISTS agent_configs (
      actor_id TEXT PRIMARY KEY REFERENCES actors(id) ON DELETE CASCADE,
      model_config_id TEXT NOT NULL REFERENCES model_configs(id) ON DELETE RESTRICT,
      instructions TEXT NOT NULL,
      tools_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS agent_configs_model_config_id ON agent_configs(model_config_id);

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      roles_json TEXT NOT NULL,
      permissions_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (actor_id, workspace_id)
    );

    CREATE INDEX IF NOT EXISTS memberships_actor_id ON memberships(actor_id);
    CREATE INDEX IF NOT EXISTS memberships_workspace_id ON memberships(workspace_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      parent_id TEXT REFERENCES attachments(id),
      source_id TEXT NOT NULL,
      origin_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      target_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      collection_id TEXT NOT NULL,
      filter_json TEXT,
      permissions_json TEXT NOT NULL,
      allow_reshare INTEGER NOT NULL CHECK (allow_reshare IN (0, 1)),
      created_by TEXT NOT NULL REFERENCES actors(id),
      created_at TEXT NOT NULL,
      revoked_by TEXT REFERENCES actors(id),
      revoked_at TEXT,
      CHECK (origin_id != target_id),
      CHECK ((revoked_at IS NULL AND revoked_by IS NULL) OR (revoked_at IS NOT NULL AND revoked_by IS NOT NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS attachments_active_source ON attachments(target_id, source_id) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS attachments_origin_id ON attachments(origin_id);
    CREATE INDEX IF NOT EXISTS attachments_target_id ON attachments(target_id);

    PRAGMA user_version = ${SQLITE_CATALOG_SCHEMA_VERSION};
  `);
}

async function readSchemaVersion(database: SqliteDatabase): Promise<number> {
  const row = await database.get<{ user_version: number }>("PRAGMA user_version");
  return row?.user_version ?? 0;
}

const insertStatements = {
  attachments:
    "INSERT INTO attachments (id, parent_id, source_id, origin_id, target_id, collection_id, filter_json, permissions_json, allow_reshare, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  workspaces:
    "INSERT INTO workspaces (id, is_root, parent_id, root_id, name, created_by, access_json, policy_json, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  actors:
    "INSERT INTO actors (id, origin_id, root_id, kind, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  model_configs:
    "INSERT INTO model_configs (id, workspace_id, name, provider, model, credential_ref, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  agent_configs:
    "INSERT INTO agent_configs (actor_id, model_config_id, instructions, tools_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  memberships:
    "INSERT INTO memberships (id, actor_id, workspace_id, roles_json, permissions_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
} as const;

async function insert(
  connection: SqliteConnection,
  table: keyof typeof insertStatements,
  parameters: SqliteParameters,
): Promise<void> {
  try {
    await connection.run(insertStatements[table], parameters);
  } catch (error) {
    if (isConstraintError(error)) throw resourceConflict(`${titleCase(table)} already exists.`);
    throw error;
  }
}

function isConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("UNIQUE constraint failed") ||
      error.message.includes("PRIMARY KEY constraint failed") ||
      error.message.includes("FOREIGN KEY constraint failed"))
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1, -1);
}

interface WorkspaceRow {
  id: string;
  is_root: number;
  parent_id: string | null;
  root_id: string;
  name: string;
  created_by: string | null;
  access_json: string;
  policy_json: string;
  spec_json: string;
  created_at: string;
  updated_at: string;
}

interface AttachmentRow {
  id: string;
  parent_id: string | null;
  source_id: string;
  origin_id: string;
  target_id: string;
  collection_id: string;
  filter_json: string | null;
  permissions_json: string;
  allow_reshare: number;
  created_by: string;
  created_at: string;
  revoked_by: string | null;
  revoked_at: string | null;
}

function attachmentFromRow(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    ...(row.parent_id === null ? {} : { parentId: row.parent_id }),
    sourceId: row.source_id,
    originId: row.origin_id,
    targetId: row.target_id,
    collectionId: row.collection_id,
    ...(row.filter_json === null
      ? {}
      : { filter: JSON.parse(row.filter_json) as NonNullable<Attachment["filter"]> }),
    permissions: JSON.parse(row.permissions_json) as Attachment["permissions"],
    allowReshare: row.allow_reshare === 1,
    createdBy: row.created_by,
    createdAt: row.created_at,
    ...(row.revoked_at === null ? {} : { revokedAt: row.revoked_at }),
    ...(row.revoked_by === null ? {} : { revokedBy: row.revoked_by }),
  };
}

interface ActorRow {
  id: string;
  origin_id: string;
  root_id: string;
  kind: ActorKind;
  name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

interface ModelConfigRow {
  id: string;
  workspace_id: string;
  name: string;
  provider: string;
  model: string;
  credential_ref: string | null;
  settings_json: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentConfigRow {
  actor_id: string;
  model_config_id: string;
  instructions: string;
  tools_json: string;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  id: string;
  actor_id: string;
  workspace_id: string;
  roles_json: string;
  permissions_json: string;
  created_at: string;
  updated_at: string;
}

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    isRoot: row.is_root === 1,
    parentId: row.parent_id,
    rootId: row.root_id,
    name: row.name,
    ...(row.created_by === null ? {} : { createdBy: row.created_by }),
    access: JSON.parse(row.access_json) as Workspace["access"],
    policy: JSON.parse(row.policy_json) as Workspace["policy"],
    spec: JSON.parse(row.spec_json) as Spec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actorFromRow(row: ActorRow): Actor {
  return {
    id: row.id,
    originId: row.origin_id,
    rootId: row.root_id,
    kind: row.kind,
    name: row.name,
    ...(row.email === null ? {} : { email: row.email }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function modelConfigFromRow(row: ModelConfigRow): ModelConfig {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    provider: row.provider,
    model: row.model,
    ...(row.credential_ref === null ? {} : { credentialRef: row.credential_ref }),
    ...(row.settings_json === null
      ? {}
      : { settings: JSON.parse(row.settings_json) as NonNullable<ModelConfig["settings"]> }),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function agentConfigFromRow(row: AgentConfigRow): AgentConfig {
  return {
    actorId: row.actor_id,
    modelConfigId: row.model_config_id,
    instructions: row.instructions,
    tools: JSON.parse(row.tools_json) as AgentConfig["tools"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function membershipFromRow(row: MembershipRow): Membership {
  return {
    id: row.id,
    actorId: row.actor_id,
    workspaceId: row.workspace_id,
    roles: JSON.parse(row.roles_json) as string[],
    permissions: JSON.parse(row.permissions_json) as Membership["permissions"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
