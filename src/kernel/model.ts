import type { Spec } from "../spec/model.ts";

export const ACTOR_KINDS = ["user", "agent", "system"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly sharedWorkspaceId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Workspace {
  readonly id: string;
  readonly accountId: string;
  readonly name: string;
  readonly createdByActorId?: string;
  readonly spec: Spec;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface Actor {
  readonly id: string;
  readonly accountId: string;
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
  readonly accountId: string;
  readonly workspaceId: string;
  readonly actorId: string;
}
