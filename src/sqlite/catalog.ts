import { resourceConflict } from "../errors/error.ts";
import type { Account, Actor, ActorKind, Membership, Workspace } from "../kernel/model.ts";
import type {
  CatalogRepository,
  CatalogTransaction,
  PersistenceAdapter,
} from "../persistence/catalog.ts";
import type { Spec } from "../spec/model.ts";
import type {
  OpenSqliteDatabase,
  SqliteConnection,
  SqliteDatabase,
  SqliteParameters,
} from "./gateway.ts";

export class SqlitePersistenceAdapter implements PersistenceAdapter {
  readonly kind = "sqlite";

  constructor(private readonly openDatabase: OpenSqliteDatabase) {}

  async openCatalog(): Promise<CatalogRepository> {
    const database = await this.openDatabase();
    await initializeCatalog(database);
    return new SqliteCatalogRepository(database);
  }
}

export class SqliteCatalogRepository implements CatalogRepository {
  constructor(private readonly database: SqliteDatabase) {}

  getAccount(id: string): Promise<Account | null> {
    return reader(this.database).getAccount(id);
  }

  listAccounts(): Promise<Account[]> {
    return reader(this.database).listAccounts();
  }

  getWorkspace(id: string): Promise<Workspace | null> {
    return reader(this.database).getWorkspace(id);
  }

  listWorkspaces(accountId: string): Promise<Workspace[]> {
    return reader(this.database).listWorkspaces(accountId);
  }

  getActor(id: string): Promise<Actor | null> {
    return reader(this.database).getActor(id);
  }

  listActors(accountId: string): Promise<Actor[]> {
    return reader(this.database).listActors(accountId);
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

  close(): Promise<void> {
    return this.database.close();
  }
}

class SqliteCatalogTransaction implements CatalogTransaction {
  constructor(private readonly connection: SqliteConnection) {}

  getAccount(id: string): Promise<Account | null> {
    return reader(this.connection).getAccount(id);
  }

  listAccounts(): Promise<Account[]> {
    return reader(this.connection).listAccounts();
  }

  getWorkspace(id: string): Promise<Workspace | null> {
    return reader(this.connection).getWorkspace(id);
  }

  listWorkspaces(accountId: string): Promise<Workspace[]> {
    return reader(this.connection).listWorkspaces(accountId);
  }

  getActor(id: string): Promise<Actor | null> {
    return reader(this.connection).getActor(id);
  }

  listActors(accountId: string): Promise<Actor[]> {
    return reader(this.connection).listActors(accountId);
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

  async insertAccount(account: Account): Promise<void> {
    await insert(this.connection, "accounts", [
      account.id,
      account.name,
      account.sharedWorkspaceId,
      account.createdAt,
      account.updatedAt,
    ]);
  }

  async insertWorkspace(workspace: Workspace): Promise<void> {
    await insert(this.connection, "workspaces", [
      workspace.id,
      workspace.accountId,
      workspace.name,
      workspace.createdByActorId ?? null,
      JSON.stringify(workspace.spec),
      workspace.createdAt,
      workspace.updatedAt,
    ]);
  }

  async insertActor(actor: Actor): Promise<void> {
    await insert(this.connection, "actors", [
      actor.id,
      actor.accountId,
      actor.kind,
      actor.name,
      actor.email ?? null,
      actor.createdAt,
      actor.updatedAt,
    ]);
  }

  async insertMembership(membership: Membership): Promise<void> {
    await insert(this.connection, "memberships", [
      membership.id,
      membership.actorId,
      membership.workspaceId,
      JSON.stringify(membership.roles),
      membership.createdAt,
      membership.updatedAt,
    ]);
  }
}

class SqliteCatalogReader {
  constructor(private readonly connection: SqliteConnection) {}

  async getAccount(id: string): Promise<Account | null> {
    const row = await this.connection.get<AccountRow>("SELECT * FROM accounts WHERE id = ?", [id]);
    return row ? accountFromRow(row) : null;
  }

  async listAccounts(): Promise<Account[]> {
    return (
      await this.connection.all<AccountRow>("SELECT * FROM accounts ORDER BY created_at, id")
    ).map(accountFromRow);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    const row = await this.connection.get<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", [
      id,
    ]);
    return row ? workspaceFromRow(row) : null;
  }

  async listWorkspaces(accountId: string): Promise<Workspace[]> {
    return (
      await this.connection.all<WorkspaceRow>(
        "SELECT * FROM workspaces WHERE account_id = ? ORDER BY created_at, id",
        [accountId],
      )
    ).map(workspaceFromRow);
  }

  async getActor(id: string): Promise<Actor | null> {
    const row = await this.connection.get<ActorRow>("SELECT * FROM actors WHERE id = ?", [id]);
    return row ? actorFromRow(row) : null;
  }

  async listActors(accountId: string): Promise<Actor[]> {
    return (
      await this.connection.all<ActorRow>(
        "SELECT * FROM actors WHERE account_id = ? ORDER BY created_at, id",
        [accountId],
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
  await database.execute(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      shared_workspace_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      created_by_actor_id TEXT,
      spec_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS workspaces_account_id ON workspaces(account_id);

    CREATE TABLE IF NOT EXISTS actors (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('user', 'agent', 'system')),
      name TEXT NOT NULL,
      email TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS actors_account_id ON actors(account_id);

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE CASCADE,
      workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      roles_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (actor_id, workspace_id)
    );

    CREATE INDEX IF NOT EXISTS memberships_actor_id ON memberships(actor_id);
    CREATE INDEX IF NOT EXISTS memberships_workspace_id ON memberships(workspace_id);
  `);
}

const insertStatements = {
  accounts:
    "INSERT INTO accounts (id, name, shared_workspace_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  workspaces:
    "INSERT INTO workspaces (id, account_id, name, created_by_actor_id, spec_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  actors:
    "INSERT INTO actors (id, account_id, kind, name, email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  memberships:
    "INSERT INTO memberships (id, actor_id, workspace_id, roles_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
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
      error.message.includes("PRIMARY KEY constraint failed"))
  );
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1, -1);
}

interface AccountRow {
  id: string;
  name: string;
  shared_workspace_id: string;
  created_at: string;
  updated_at: string;
}

interface WorkspaceRow {
  id: string;
  account_id: string;
  name: string;
  created_by_actor_id: string | null;
  spec_json: string;
  created_at: string;
  updated_at: string;
}

interface ActorRow {
  id: string;
  account_id: string;
  kind: ActorKind;
  name: string;
  email: string | null;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  id: string;
  actor_id: string;
  workspace_id: string;
  roles_json: string;
  created_at: string;
  updated_at: string;
}

function accountFromRow(row: AccountRow): Account {
  return {
    id: row.id,
    name: row.name,
    sharedWorkspaceId: row.shared_workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function workspaceFromRow(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    ...(row.created_by_actor_id === null ? {} : { createdByActorId: row.created_by_actor_id }),
    spec: JSON.parse(row.spec_json) as Spec,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function actorFromRow(row: ActorRow): Actor {
  return {
    id: row.id,
    accountId: row.account_id,
    kind: row.kind,
    name: row.name,
    ...(row.email === null ? {} : { email: row.email }),
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
