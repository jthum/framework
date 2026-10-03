import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import { type CatalogRepository, type PersistenceSession } from "../persistence/catalog.ts";
import { createEmptySpec } from "../spec/model.ts";
import { assertValidSpec } from "../spec/validate.ts";
import { semanticKey, type IdGenerator, type Clock } from "./defaults.ts";
import {
  PERMISSIONS,
  type Actor,
  type Membership,
  type Workspace,
  type ExecutionContext,
} from "./model.ts";
import { type CatalogAuthority } from "./catalog-authority.ts";
import {
  membership,
  defaultAccess,
  defaultPolicy,
  normalizePermissions,
  requiredName,
} from "./catalog-values.ts";
import {
  type CreateRootWorkspaceInput,
  type WorkspaceBootstrap,
  type CreateWorkspaceInput,
  type UpdateWorkspaceAccessInput,
  type UpdateWorkspacePolicyInput,
  type RenameWorkspaceInput,
} from "./catalog-inputs.ts";

export class WorkspaceLifecycleService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly persistence: Pick<PersistenceSession, "deleteWorkspace">,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly authority: Pick<
      CatalogAuthority,
      "assertContext" | "assertAuthorized" | "requireWorkspace"
    >,
  ) {}

  async createRootWorkspace(input: CreateRootWorkspaceInput): Promise<WorkspaceBootstrap> {
    const name = requiredName(input.name, "Workspace");
    const userName = requiredName(input.user.name, "User");
    const stamp = this.clock.now();
    const workspaceId = this.ids.create("workspace");
    const userId = this.ids.create("actor");
    const systemId = this.ids.create("actor");
    const workspace: Workspace = {
      id: workspaceId,
      isRoot: true,
      parentId: null,
      rootId: workspaceId,
      name,
      access: defaultAccess(),
      policy: defaultPolicy(),
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    assertValidSpec(workspace.spec);
    const user: Actor = {
      id: userId,
      originId: workspaceId,
      rootId: workspaceId,
      kind: "user",
      name: userName,
      ...(input.user.email === undefined ? {} : { email: input.user.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const system: Actor = {
      id: systemId,
      originId: workspaceId,
      rootId: workspaceId,
      kind: "system",
      name: "System",
      createdAt: stamp,
      updatedAt: stamp,
    };
    const memberships = [
      membership(this.ids, stamp, userId, workspaceId, ["owner"], PERMISSIONS),
      membership(this.ids, stamp, systemId, workspaceId, ["system"], PERMISSIONS),
    ] as const;

    await this.catalog.transaction(async (transaction) => {
      await transaction.insertWorkspace(workspace);
      await transaction.insertActor(user);
      await transaction.insertActor(system);
      await transaction.insertMembership(memberships[0]);
      await transaction.insertMembership(memberships[1]);
    });

    return { workspace, user, system, memberships };
  }

  async createWorkspace(
    context: ExecutionContext,
    input: CreateWorkspaceInput,
  ): Promise<{ workspace: Workspace; membership: Membership }> {
    await this.authority.assertContext(context);
    const parent = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "workspaces.create",
      resource: {
        kind: "workspace",
        id: context.workspaceId,
        workspaceId: context.workspaceId,
      },
    });
    if (!parent.policy.spawn)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit spawning child Workspaces.",
      });

    const name = requiredName(input.name, "Workspace");
    const stamp = this.clock.now();
    const workspace: Workspace = {
      id: this.ids.create("workspace"),
      isRoot: false,
      parentId: parent.id,
      rootId: parent.rootId,
      name,
      createdBy: context.actorId,
      access: defaultAccess(),
      policy: defaultPolicy(),
      spec: createEmptySpec({
        id: this.ids.create("spec"),
        key: semanticKey(name),
        label: name,
      }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    assertValidSpec(workspace.spec);
    const ownerMembership = membership(
      this.ids,
      stamp,
      context.actorId,
      workspace.id,
      ["owner"],
      PERMISSIONS,
    );
    await this.catalog.transaction(async (transaction) => {
      await transaction.insertWorkspace(workspace);
      await transaction.insertMembership(ownerMembership);
    });
    return { workspace, membership: ownerMembership };
  }

  async updateWorkspaceAccess(
    context: ExecutionContext,
    input: UpdateWorkspaceAccessInput,
  ): Promise<Workspace> {
    await this.authority.assertContext(context);
    const current = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "workspace.access.update",
      resource: { kind: "workspace", id: current.id, workspaceId: current.id },
    });
    const workspace: Workspace = {
      ...current,
      access: {
        members: normalizePermissions(input.members),
        others: normalizePermissions(input.others),
      },
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
    return workspace;
  }

  async updateWorkspacePolicy(
    context: ExecutionContext,
    policy: UpdateWorkspacePolicyInput,
  ): Promise<Workspace> {
    await this.authority.assertContext(context);
    const current = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "workspace.policy.update",
      resource: { kind: "workspace", id: current.id, workspaceId: current.id },
    });
    const workspace: Workspace = {
      ...current,
      policy: { ...policy },
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
    return workspace;
  }

  async renameWorkspace(
    context: ExecutionContext,
    input: RenameWorkspaceInput,
  ): Promise<Workspace> {
    await this.authority.assertContext(context);
    const current = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "workspace.update",
      resource: { kind: "workspace", id: current.id, workspaceId: current.id },
    });
    const workspace: Workspace = {
      ...current,
      name: requiredName(input.name, "Workspace"),
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
    return workspace;
  }

  async deleteWorkspace(context: ExecutionContext): Promise<void> {
    await this.authority.assertContext(context);
    const workspace = await this.authority.requireWorkspace(context.workspaceId);
    await this.authority.assertAuthorized({
      context,
      operation: "workspace.delete",
      resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
    });
    if (workspace.isRoot) throw resourceConflict("A root Workspace cannot be deleted.");
    if ((await this.catalog.listChildWorkspaces(workspace.id)).length)
      throw resourceConflict("A Workspace with child Workspaces cannot be deleted.");
    if ((await this.catalog.listActorsByOrigin(workspace.id)).length)
      throw resourceConflict("A Workspace that issued Actors cannot be deleted.");
    if ((await this.catalog.listAttachmentsFrom(workspace.id)).length)
      throw resourceConflict("A Workspace exposing Collections cannot be deleted.");
    const incoming = await this.catalog.listAttachmentsTo(workspace.id);
    const incomingIds = new Set(incoming.map((attachment) => attachment.id));
    for (const candidate of await this.catalog.listWorkspacesByRoot(workspace.rootId))
      for (const attachment of await this.catalog.listAttachmentsTo(candidate.id))
        if (attachment.parentId && incomingIds.has(attachment.parentId))
          throw resourceConflict("A Workspace with re-shared Attachments cannot be deleted.");
    await this.persistence.deleteWorkspace(workspace.id);
  }
}
