import type { FieldCondition, JsonValue, Spec } from "../spec/model.ts";

export const ACTOR_KINDS = ["user", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const PERMISSIONS = ["read", "create", "update", "delete", "manage"] as const;
export type Permission = (typeof PERMISSIONS)[number];

export interface WorkspaceAccess {
  /** Maximum permissions available to direct members, narrowed by Membership permissions. */
  readonly members: readonly Permission[];
  /** Maximum permissions available through an Attachment without origin Membership. */
  readonly others: readonly Permission[];
}

export interface WorkspacePolicy {
  readonly spawn: boolean;
  readonly createActors: boolean;
  readonly reshare: boolean;
}

export interface Workspace {
  readonly id: string;
  readonly isRoot: boolean;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly name: string;
  readonly createdBy?: string;
  readonly access: WorkspaceAccess;
  readonly policy: WorkspacePolicy;
  readonly spec: Spec;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Actor {
  readonly id: string;
  readonly originId: string;
  readonly rootId: string;
  readonly kind: ActorKind;
  readonly name: string;
  readonly email?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Instance configuration for one reusable provider/model selection. Credentials remain external. */
export interface ModelConfig {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly credentialRef?: string;
  readonly settings?: Readonly<Record<string, JsonValue>>;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Selection policy only; it can narrow eligible tools but never grant authority. */
export interface AgentToolPolicy {
  readonly include?: readonly string[];
  readonly exclude?: readonly string[];
  readonly search: boolean;
}

/** Instance configuration attached one-to-one to an Agent Actor. */
export interface AgentConfig {
  readonly actorId: string;
  readonly modelConfigId: string;
  readonly instructions: string;
  readonly tools: AgentToolPolicy;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Membership {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly Permission[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionContext {
  readonly workspaceId: string;
  readonly actorId: string;
  readonly scope?: ScopeHandle;
}

/** Opaque host/module entity inside one Workspace; not a people or ACL boundary. */
export interface ScopeHandle {
  readonly kind: string;
  readonly id: string;
}

export const ATTACHMENT_PERMISSIONS = ["read", "update", "delete"] as const;
export type AttachmentPermission = (typeof ATTACHMENT_PERMISSIONS)[number];

/** Instance binding; never serialized into a portable Spec. */
export interface Attachment {
  readonly id: string;
  /** Received Attachment when this binding was explicitly re-shared. */
  readonly parentId?: string;
  /** Stable ID of the target Workspace's Source binding definition. */
  readonly sourceId: string;
  readonly originId: string;
  readonly targetId: string;
  readonly collectionId: string;
  readonly filter?: FieldCondition;
  readonly permissions: readonly AttachmentPermission[];
  readonly allowReshare: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revokedBy?: string;
  readonly revokedAt?: string;
}
