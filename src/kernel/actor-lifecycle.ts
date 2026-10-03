import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import { type CatalogRepository } from "../persistence/catalog.ts";
import { type IdGenerator, type Clock } from "./defaults.ts";
import { type Actor, type Membership, type ExecutionContext } from "./model.ts";
import { type CatalogAuthority } from "./catalog-authority.ts";
import { membership, normalizePermissions, requiredName } from "./catalog-values.ts";
import {
  type CreateActorInput,
  type CreateMemberInput,
  type UpdateActorInput,
  type AddMembershipInput,
  type UpdateMembershipInput,
} from "./catalog-inputs.ts";

export class ActorLifecycleService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly authority: Pick<
      CatalogAuthority,
      "assertContext" | "assertAuthorized" | "requireWorkspace" | "requireActor"
    >,
  ) {}

  async createActor(context: ExecutionContext, input: CreateActorInput): Promise<Actor> {
    await this.authority.assertContext(context);
    const origin = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "actors.create",
      resource: {
        kind: "workspace",
        id: origin.id,
        workspaceId: origin.id,
      },
    });
    if (!origin.policy.createActors)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit creating local Actors.",
      });
    const stamp = this.clock.now();
    const actor: Actor = {
      id: this.ids.create("actor"),
      originId: origin.id,
      rootId: origin.rootId,
      kind: input.kind,
      name: requiredName(input.name, "Actor"),
      ...(input.email === undefined ? {} : { email: input.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.catalog.transaction((transaction) => transaction.insertActor(actor));
    return actor;
  }

  async createMember(
    context: ExecutionContext,
    input: CreateMemberInput,
  ): Promise<{ actor: Actor; membership: Membership }> {
    await this.authority.assertContext(context);
    const workspace = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "actors.create",
      resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
    });
    await this.authority.assertAuthorized({
      context,
      operation: "memberships.create",
      resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
    });
    if (!workspace.policy.createActors)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit creating local Actors.",
      });
    const stamp = this.clock.now();
    const actor: Actor = {
      id: this.ids.create("actor"),
      originId: workspace.id,
      rootId: workspace.rootId,
      kind: "user",
      name: requiredName(input.name, "Actor"),
      ...(input.email === undefined ? {} : { email: input.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const next = membership(
      this.ids,
      stamp,
      actor.id,
      workspace.id,
      input.roles ?? ["member"],
      normalizePermissions(input.permissions ?? ["read"]),
    );
    await this.catalog.transaction(async (transaction) => {
      await transaction.insertActor(actor);
      await transaction.insertMembership(next);
    });
    return { actor, membership: next };
  }

  async updateActor(
    context: ExecutionContext,
    id: string,
    input: UpdateActorInput,
  ): Promise<Actor> {
    await this.authority.assertContext(context);
    const current = await this.authority.requireActor(id);
    await this.authority.assertAuthorized({
      context,
      operation: "actors.update",
      resource: { kind: "actor", id: current.id, workspaceId: current.originId },
    });
    const { email: currentEmail, ...identity } = current;
    const actor: Actor = {
      ...identity,
      name: requiredName(input.name, "Actor"),
      ...(input.email === undefined
        ? currentEmail === undefined
          ? {}
          : { email: currentEmail }
        : input.email
          ? { email: input.email }
          : {}),
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateActor(actor));
    return actor;
  }

  async addMembership(context: ExecutionContext, input: AddMembershipInput): Promise<Membership> {
    await this.authority.assertContext(context);
    const actor = await this.authority.requireActor(input.actorId);
    const workspace = await this.authority.requireWorkspace(input.workspaceId);
    const active = await this.authority.requireWorkspace(context.workspaceId);
    if (actor.rootId !== workspace.rootId || active.rootId !== workspace.rootId) {
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "Membership cannot cross root Workspace boundaries.",
      });
    }
    await this.authority.assertAuthorized({
      context,
      operation: "memberships.create",
      resource: {
        kind: "workspace",
        id: workspace.id,
        workspaceId: workspace.id,
      },
    });
    if (await this.catalog.getMembership(actor.id, workspace.id)) {
      throw resourceConflict("The Actor is already a member of this Workspace.");
    }
    const next = membership(
      this.ids,
      this.clock.now(),
      actor.id,
      workspace.id,
      input.roles ?? ["member"],
      input.permissions ?? ["read"],
    );
    await this.catalog.transaction((transaction) => transaction.insertMembership(next));
    return next;
  }

  async updateMembership(
    context: ExecutionContext,
    input: UpdateMembershipInput,
  ): Promise<Membership> {
    await this.authority.assertContext(context);
    const current = await this.catalog.getMembership(input.actorId, input.workspaceId);
    if (!current) throw resourceNotFound("Membership", `${input.actorId}:${input.workspaceId}`);
    await this.authority.assertAuthorized({
      context,
      operation: "memberships.update",
      resource: {
        kind: "membership",
        id: current.id,
        workspaceId: current.workspaceId,
      },
    });
    const membership: Membership = {
      ...current,
      roles: input.roles === undefined ? current.roles : [...input.roles],
      permissions: normalizePermissions(input.permissions),
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateMembership(membership));
    return membership;
  }
}
