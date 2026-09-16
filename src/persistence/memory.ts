import { resourceConflict } from "../errors/error.ts";
import type { Account, Actor, Membership, Workspace } from "../kernel/model.ts";
import type { CatalogRepository, CatalogTransaction, PersistenceAdapter } from "./catalog.ts";

interface MemoryState {
  accounts: Map<string, Account>;
  workspaces: Map<string, Workspace>;
  actors: Map<string, Actor>;
  memberships: Map<string, Membership>;
}

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly kind = "memory";
  private readonly repository = new MemoryCatalogRepository();

  async openCatalog(): Promise<CatalogRepository> {
    return this.repository;
  }
}

export class MemoryCatalogRepository implements CatalogRepository, CatalogTransaction {
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  async getAccount(id: string): Promise<Account | null> {
    return cloneOptional(this.state.accounts.get(id));
  }

  async listAccounts(): Promise<Account[]> {
    return cloneValues(this.state.accounts);
  }

  async getWorkspace(id: string): Promise<Workspace | null> {
    return cloneOptional(this.state.workspaces.get(id));
  }

  async listWorkspaces(accountId: string): Promise<Workspace[]> {
    return cloneValues(this.state.workspaces).filter((item) => item.accountId === accountId);
  }

  async getActor(id: string): Promise<Actor | null> {
    return cloneOptional(this.state.actors.get(id));
  }

  async listActors(accountId: string): Promise<Actor[]> {
    return cloneValues(this.state.actors).filter((item) => item.accountId === accountId);
  }

  async getMembership(actorId: string, workspaceId: string): Promise<Membership | null> {
    return (
      cloneValues(this.state.memberships).find(
        (item) => item.actorId === actorId && item.workspaceId === workspaceId,
      ) ?? null
    );
  }

  async listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return cloneValues(this.state.memberships).filter((item) => item.actorId === actorId);
  }

  async listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return cloneValues(this.state.memberships).filter((item) => item.workspaceId === workspaceId);
  }

  async insertAccount(account: Account): Promise<void> {
    insertUnique(this.state.accounts, account, "Account");
  }

  async insertWorkspace(workspace: Workspace): Promise<void> {
    insertUnique(this.state.workspaces, workspace, "Workspace");
  }

  async insertActor(actor: Actor): Promise<void> {
    insertUnique(this.state.actors, actor, "Actor");
  }

  async insertMembership(membership: Membership): Promise<void> {
    if (await this.getMembership(membership.actorId, membership.workspaceId)) {
      throw resourceConflict("The Actor is already a member of this Workspace.");
    }
    insertUnique(this.state.memberships, membership, "Membership");
  }

  transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const previous = cloneState(this.state);
      try {
        return await work(this);
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async close(): Promise<void> {}
}

function emptyState(): MemoryState {
  return {
    accounts: new Map(),
    workspaces: new Map(),
    actors: new Map(),
    memberships: new Map(),
  };
}

function insertUnique<T extends { readonly id: string }>(
  values: Map<string, T>,
  value: T,
  kind: string,
): void {
  if (values.has(value.id)) throw resourceConflict(`${kind} already exists.`);
  values.set(value.id, clone(value));
}

function cloneState(state: MemoryState): MemoryState {
  return {
    accounts: cloneMap(state.accounts),
    workspaces: cloneMap(state.workspaces),
    actors: cloneMap(state.actors),
    memberships: cloneMap(state.memberships),
  };
}

function cloneMap<T>(values: Map<string, T>): Map<string, T> {
  return new Map([...values].map(([key, value]) => [key, clone(value)]));
}

function cloneValues<T>(values: Map<string, T>): T[] {
  return [...values.values()].map(clone);
}

function cloneOptional<T>(value: T | undefined): T | null {
  return value === undefined ? null : clone(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
