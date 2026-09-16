import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import type { Actor, Membership, Workspace } from "../kernel/model.ts";
import type { CatalogReader } from "./catalog.ts";

export async function assertWorkspaceIntegrity(
  catalog: CatalogReader,
  workspace: Workspace,
): Promise<void> {
  if (workspace.isRoot) {
    if (workspace.parentId !== null || workspace.rootId !== workspace.id) {
      throw resourceConflict("A root Workspace must have no parent and reference itself as root.");
    }
    return;
  }
  if (workspace.parentId === null || workspace.parentId === workspace.id) {
    throw resourceConflict("A spawned Workspace must have a distinct parent.");
  }
  const parent = await catalog.getWorkspace(workspace.parentId);
  if (!parent) throw resourceNotFound("Workspace", workspace.parentId);
  if (parent.rootId !== workspace.rootId) {
    throw resourceConflict("A spawned Workspace must inherit its parent's root.");
  }
}

export function assertWorkspaceTopologyUnchanged(previous: Workspace, next: Workspace): void {
  if (
    previous.isRoot !== next.isRoot ||
    previous.parentId !== next.parentId ||
    previous.rootId !== next.rootId
  ) {
    throw resourceConflict("Workspace grouping cannot be changed after creation.");
  }
}

export async function assertActorIntegrity(catalog: CatalogReader, actor: Actor): Promise<void> {
  const origin = await catalog.getWorkspace(actor.originId);
  if (!origin) throw resourceNotFound("Workspace", actor.originId);
  if (origin.rootId !== actor.rootId) {
    throw resourceConflict("An Actor must inherit its issuing Workspace's root.");
  }
}

export async function assertMembershipIntegrity(
  catalog: CatalogReader,
  membership: Membership,
): Promise<void> {
  const actor = await catalog.getActor(membership.actorId);
  if (!actor) throw resourceNotFound("Actor", membership.actorId);
  const workspace = await catalog.getWorkspace(membership.workspaceId);
  if (!workspace) throw resourceNotFound("Workspace", membership.workspaceId);
  if (actor.rootId !== workspace.rootId) {
    throw resourceConflict("Membership cannot cross root Workspace boundaries.");
  }
}
