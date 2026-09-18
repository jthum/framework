import type {
  Actor,
  AgentConfig,
  Attachment,
  Membership,
  ModelConfig,
  ScopeConfig,
  ScopeHandle,
  Workspace,
} from "../kernel/model.ts";
import type { RecordStore } from "./records.ts";
import type { CollectionRecord } from "./records.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { ExecutionStore } from "./executions.ts";
import type { ScopeStore } from "./scopes.ts";
import type { RuleSubscriptionStore } from "./subscriptions.ts";

export interface CollectionSeed {
  readonly collection: CollectionDefinition;
  readonly records: readonly CollectionRecord[];
}

export interface CatalogReader {
  getWorkspace(id: string): Promise<Workspace | null>;
  listRootWorkspaces(): Promise<Workspace[]>;
  listChildWorkspaces(parentId: string): Promise<Workspace[]>;
  listWorkspacesByRoot(rootId: string): Promise<Workspace[]>;
  getActor(id: string): Promise<Actor | null>;
  listActorsByOrigin(originId: string): Promise<Actor[]>;
  listActorsByRoot(rootId: string): Promise<Actor[]>;
  getModelConfig(id: string): Promise<ModelConfig | null>;
  listModelConfigs(workspaceId: string): Promise<ModelConfig[]>;
  getAgentConfig(actorId: string): Promise<AgentConfig | null>;
  listMembers(workspaceId: string): Promise<Actor[]>;
  getMembership(actorId: string, workspaceId: string): Promise<Membership | null>;
  listMembershipsForActor(actorId: string): Promise<Membership[]>;
  listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]>;
  getAttachment(id: string): Promise<Attachment | null>;
  getAttachmentBySource(targetId: string, sourceId: string): Promise<Attachment | null>;
  listAttachmentsTo(targetId: string): Promise<Attachment[]>;
  listAttachmentsFrom(originId: string): Promise<Attachment[]>;
}

export interface CatalogTransaction extends CatalogReader {
  insertWorkspace(workspace: Workspace): Promise<void>;
  insertActor(actor: Actor): Promise<void>;
  updateActor(actor: Actor): Promise<void>;
  insertModelConfig(config: ModelConfig): Promise<void>;
  updateModelConfig(config: ModelConfig): Promise<void>;
  deleteModelConfig(id: string): Promise<void>;
  insertAgentConfig(config: AgentConfig): Promise<void>;
  updateAgentConfig(config: AgentConfig): Promise<void>;
  insertMembership(membership: Membership): Promise<void>;
  updateMembership(membership: Membership): Promise<void>;
  updateWorkspace(workspace: Workspace): Promise<void>;
  insertAttachment(attachment: Attachment): Promise<void>;
  revokeAttachment(id: string, actorId: string, stamp: string): Promise<void>;
}

export interface CatalogRepository extends CatalogReader {
  transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T>;
}

export interface PersistenceAdapter {
  readonly kind: string;
  open(): Promise<PersistenceSession>;
}

export interface PersistenceSession {
  readonly scopes: ScopeStore;
  readonly subscriptions: RuleSubscriptionStore;
  readonly executions: ExecutionStore;
  readonly catalog: CatalogRepository;
  readonly records: RecordStore;
  /** Atomically applies schema/catalog changes and optional initial records. */
  applyWorkspaceSpec(workspace: Workspace, seeds?: readonly CollectionSeed[]): Promise<void>;
  applyScopeConfig(
    workspace: Workspace,
    scope: ScopeHandle,
    config: ScopeConfig,
    seeds?: readonly CollectionSeed[],
  ): Promise<void>;
  deleteScope(workspace: Workspace, scope: ScopeHandle): Promise<void>;
  /** Removes one validated Workspace and its instance state; multi-database adapters recover interrupted cleanup. */
  deleteWorkspace(workspaceId: string): Promise<void>;
  close(): Promise<void>;
}
