import type { Account, Actor, Membership, Workspace } from "../kernel/model.ts";
import type { RecordStore } from "./records.ts";

export interface CatalogReader {
  getAccount(id: string): Promise<Account | null>;
  listAccounts(): Promise<Account[]>;
  getWorkspace(id: string): Promise<Workspace | null>;
  listWorkspaces(accountId: string): Promise<Workspace[]>;
  getActor(id: string): Promise<Actor | null>;
  listActors(accountId: string): Promise<Actor[]>;
  getMembership(actorId: string, workspaceId: string): Promise<Membership | null>;
  listMembershipsForActor(actorId: string): Promise<Membership[]>;
  listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]>;
}

export interface CatalogTransaction extends CatalogReader {
  insertAccount(account: Account): Promise<void>;
  insertWorkspace(workspace: Workspace): Promise<void>;
  insertActor(actor: Actor): Promise<void>;
  insertMembership(membership: Membership): Promise<void>;
  updateWorkspace(workspace: Workspace): Promise<void>;
}

export interface CatalogRepository extends CatalogReader {
  transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T>;
}

export interface PersistenceAdapter {
  readonly kind: string;
  open(): Promise<PersistenceSession>;
}

export interface PersistenceSession {
  readonly catalog: CatalogRepository;
  readonly records: RecordStore;
  applyWorkspaceSpec(workspace: Workspace): Promise<void>;
  close(): Promise<void>;
}
