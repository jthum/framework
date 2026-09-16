import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import {
  ATTACHMENT_RIGHTS,
  type Actor,
  type Attachment,
  type Membership,
  type Workspace,
} from "../kernel/model.ts";
import { assertValidFieldCondition } from "../spec/validate.ts";
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

export async function assertAttachmentIntegrity(
  catalog: CatalogReader,
  attachment: Attachment,
): Promise<void> {
  const origin = await catalog.getWorkspace(attachment.originId);
  if (!origin) throw resourceNotFound("Workspace", attachment.originId);
  const target = await catalog.getWorkspace(attachment.targetId);
  if (!target) throw resourceNotFound("Workspace", attachment.targetId);
  if (origin.id === target.id || origin.rootId !== target.rootId)
    throw resourceConflict("Attachments require distinct Workspaces in the same root universe.");
  const collection = origin.spec.collections.find((item) => item.id === attachment.collectionId);
  if (!collection) throw resourceNotFound("Collection", attachment.collectionId);
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(attachment.key))
    throw resourceConflict("Attachment key must be a semantic key.");
  if (
    attachment.rights.length === 0 ||
    new Set(attachment.rights).size !== attachment.rights.length ||
    attachment.rights.some((right) => !ATTACHMENT_RIGHTS.includes(right))
  )
    throw resourceConflict("Attachment rights must be a non-empty unique set of supported rights.");
  if (typeof attachment.allowReshare !== "boolean")
    throw resourceConflict("Attachment re-share permission must be a boolean.");
  if (attachment.revokedAt !== undefined || attachment.revokedBy !== undefined)
    throw resourceConflict("A new Attachment cannot already be revoked.");
  const creator = await catalog.getActor(attachment.createdBy);
  if (!creator) throw resourceNotFound("Actor", attachment.createdBy);
  if (creator.rootId !== origin.rootId)
    throw resourceConflict(
      "Attachment provenance must reference an Actor in the same root universe.",
    );
  if (attachment.filter !== undefined) assertValidFieldCondition(attachment.filter, collection);
  if (await catalog.getAttachmentByKey(target.id, attachment.key))
    throw resourceConflict("This Source key already has an active Attachment.");
}
