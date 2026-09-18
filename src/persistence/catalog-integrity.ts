import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import {
  ATTACHMENT_PERMISSIONS,
  PERMISSIONS,
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
  assertPermissions(workspace.access.members, "Workspace member");
  assertPermissions(workspace.access.others, "Workspace others");
  if (
    typeof workspace.policy.spawn !== "boolean" ||
    typeof workspace.policy.createActors !== "boolean" ||
    typeof workspace.policy.reshare !== "boolean"
  )
    throw resourceConflict("Workspace policy values must be booleans.");
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

export function assertActorIdentityUnchanged(previous: Actor, next: Actor): void {
  if (
    previous.id !== next.id ||
    previous.originId !== next.originId ||
    previous.rootId !== next.rootId ||
    previous.kind !== next.kind ||
    previous.createdAt !== next.createdAt
  )
    throw resourceConflict("Actor identity cannot be changed after creation.");
}

export async function assertMembershipIntegrity(
  catalog: CatalogReader,
  membership: Membership,
): Promise<void> {
  assertPermissions(membership.permissions, "Membership");
  const actor = await catalog.getActor(membership.actorId);
  if (!actor) throw resourceNotFound("Actor", membership.actorId);
  const workspace = await catalog.getWorkspace(membership.workspaceId);
  if (!workspace) throw resourceNotFound("Workspace", membership.workspaceId);
  if (actor.rootId !== workspace.rootId) {
    throw resourceConflict("Membership cannot cross root Workspace boundaries.");
  }
}

export function assertMembershipIdentityUnchanged(previous: Membership, next: Membership): void {
  if (
    previous.id !== next.id ||
    previous.actorId !== next.actorId ||
    previous.workspaceId !== next.workspaceId
  )
    throw resourceConflict("Membership identity cannot be changed after creation.");
}

function assertPermissions(permissions: readonly string[], kind: string): void {
  if (
    new Set(permissions).size !== permissions.length ||
    permissions.some(
      (permission) => !PERMISSIONS.includes(permission as (typeof PERMISSIONS)[number]),
    )
  )
    throw resourceConflict(`${kind} permissions must be a unique set of supported permissions.`);
}

export async function assertAttachmentIntegrity(
  catalog: CatalogReader,
  attachment: Attachment,
): Promise<void> {
  const parent =
    attachment.parentId === undefined ? null : await catalog.getAttachment(attachment.parentId);
  if (attachment.parentId !== undefined && !parent)
    throw resourceNotFound("Attachment", attachment.parentId);
  if (parent) {
    if (parent.revokedAt !== undefined || !parent.allowReshare)
      throw resourceConflict("A derived Attachment requires a live re-shareable parent.");
    if (
      parent.targetId === attachment.targetId ||
      parent.originId !== attachment.originId ||
      parent.collectionId !== attachment.collectionId ||
      attachment.permissions.some((permission) => !parent.permissions.includes(permission))
    )
      throw resourceConflict(
        "A derived Attachment must preserve origin and attenuate permissions.",
      );
  }
  const origin = await catalog.getWorkspace(attachment.originId);
  if (!origin) throw resourceNotFound("Workspace", attachment.originId);
  const target = await catalog.getWorkspace(attachment.targetId);
  if (!target) throw resourceNotFound("Workspace", attachment.targetId);
  if (origin.id === target.id || origin.rootId !== target.rootId)
    throw resourceConflict("Attachments require distinct Workspaces in the same root universe.");
  const collection = origin.spec.collections.find((item) => item.id === attachment.collectionId);
  if (!collection) throw resourceNotFound("Collection", attachment.collectionId);
  const source = target.spec.sources.find((item) => item.id === attachment.sourceId);
  if (!source) throw resourceNotFound("Source", attachment.sourceId);
  if (
    attachment.permissions.length === 0 ||
    new Set(attachment.permissions).size !== attachment.permissions.length ||
    attachment.permissions.some((permission) => !ATTACHMENT_PERMISSIONS.includes(permission))
  )
    throw resourceConflict(
      "Attachment permissions must be a non-empty unique set of supported permissions.",
    );
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
  if (await catalog.getAttachmentBySource(target.id, attachment.sourceId))
    throw resourceConflict("This Source already has an active Attachment.");
}

export async function assertAttachmentRevocation(
  catalog: CatalogReader,
  attachment: Attachment,
  actorId: string,
): Promise<void> {
  const actor = await catalog.getActor(actorId);
  if (!actor) throw resourceNotFound("Actor", actorId);
  const origin = await catalog.getWorkspace(attachment.originId);
  if (!origin) throw resourceNotFound("Workspace", attachment.originId);
  if (actor.rootId !== origin.rootId) {
    throw resourceConflict("Attachment revocation provenance must remain in its root universe.");
  }
}
