import type { FieldCondition, Spec } from "../spec/model.ts";

export const ACTOR_KINDS = ["user", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Workspace {
  readonly id: string;
  readonly isRoot: boolean;
  readonly parentId: string | null;
  readonly rootId: string;
  readonly name: string;
  readonly createdBy?: string;
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

export interface Membership {
  readonly id: string;
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExecutionContext {
  readonly workspaceId: string;
  readonly actorId: string;
}

export const ATTACHMENT_RIGHTS = ["read", "create", "update", "delete"] as const;
export type AttachmentRight = (typeof ATTACHMENT_RIGHTS)[number];

/** Instance binding; never serialized into a portable Spec. */
export interface Attachment {
  readonly id: string;
  readonly key: string;
  readonly originId: string;
  readonly targetId: string;
  readonly collectionId: string;
  readonly filter?: FieldCondition;
  readonly rights: readonly AttachmentRight[];
  readonly allowReshare: boolean;
  readonly createdBy: string;
  readonly createdAt: string;
  readonly revokedBy?: string;
  readonly revokedAt?: string;
}
