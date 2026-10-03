import {
  type Actor,
  type ActorKind,
  type Membership,
  type Permission,
  type Workspace,
  type WorkspacePolicy,
} from "./model.ts";

export interface CreateRootWorkspaceInput {
  readonly name: string;
  readonly user: {
    readonly name: string;
    readonly email?: string;
  };
}

export interface WorkspaceBootstrap {
  readonly workspace: Workspace;
  readonly user: Actor;
  readonly system: Actor;
  readonly memberships: readonly [Membership, Membership];
}

export interface CreateWorkspaceInput {
  readonly name: string;
}

export interface CreateActorInput {
  readonly kind: Exclude<ActorKind, "system" | "agent">;
  readonly name: string;
  readonly email?: string;
}

export interface CreateMemberInput {
  readonly name: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly Permission[];
}

export interface UpdateActorInput {
  readonly name: string;
  readonly email?: string;
}

export interface AddMembershipInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles?: readonly string[];
  readonly permissions?: readonly Permission[];
}

export interface UpdateMembershipInput {
  readonly actorId: string;
  readonly workspaceId: string;
  readonly roles?: readonly string[];
  readonly permissions: readonly Permission[];
}

export interface UpdateWorkspaceAccessInput {
  readonly members: readonly Permission[];
  readonly others: readonly Permission[];
}

export type UpdateWorkspacePolicyInput = WorkspacePolicy;

export interface RenameWorkspaceInput {
  readonly name: string;
}
