import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { CollectionRecord, RecordStore } from "../persistence/records.ts";
import type { CollectionDefinition, FieldCondition } from "../spec/model.ts";
import { assertValidFieldCondition } from "../spec/validate.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { Clock, IdGenerator } from "./defaults.ts";
import {
  ATTACHMENT_RIGHTS,
  type Attachment,
  type AttachmentRight,
  type ExecutionContext,
} from "./model.ts";
import { evaluateCondition } from "./record-values.ts";

export interface CreateAttachmentInput {
  readonly collectionKey: string;
  readonly targetId: string;
  readonly sourceId: string;
  readonly filter?: FieldCondition;
  readonly rights?: readonly AttachmentRight[];
  readonly allowReshare?: boolean;
}

export interface ReshareAttachmentInput {
  readonly sourceKey: string;
  readonly targetId: string;
  readonly sourceId: string;
  readonly filter?: FieldCondition;
  readonly rights?: readonly AttachmentRight[];
  readonly allowReshare?: boolean;
}

export interface AttachmentMutationTarget {
  readonly attachment: Attachment;
  readonly collection: CollectionDefinition;
  readonly record: CollectionRecord;
}

/** Mechanical live binding. Full origin/member/others policy is supplied by the Authorizer. */
export class AttachmentService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly records: RecordStore,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async create(context: ExecutionContext, input: CreateAttachmentInput): Promise<Attachment> {
    await this.assertContext(context);
    const origin = await this.catalog.getWorkspace(context.workspaceId);
    if (!origin) throw resourceNotFound("Workspace", context.workspaceId);
    const collection = origin.spec.collections.find((item) => item.key === input.collectionKey);
    if (!collection) throw resourceNotFound("Collection", input.collectionKey);
    await this.assertContext({ ...context, workspaceId: input.targetId });
    const target = await this.catalog.getWorkspace(input.targetId);
    if (target?.id === origin.id)
      throw resourceConflict("Attachments require distinct Workspaces.");
    if (!target?.spec.sources.some((source) => source.id === input.sourceId))
      throw resourceNotFound("Source", input.sourceId);
    await this.authorize({
      context,
      operation: "attachments.create",
      resource: {
        kind: "collection",
        id: collection.id,
        collectionId: collection.id,
        workspaceId: origin.id,
      },
    });
    await this.authorize({
      context: { ...context, workspaceId: input.targetId },
      operation: "attachments.accept",
      resource: { kind: "workspace", id: input.targetId, workspaceId: input.targetId },
    });
    const rights = normalizedRights(input.rights ?? ["read"]);
    if (rights.some((right) => !origin.access.others.includes(right)))
      throw denied("Attachment rights cannot exceed the origin Workspace's others access.");
    const attachment: Attachment = {
      id: this.ids.create("attachment"),
      sourceId: input.sourceId,
      originId: origin.id,
      targetId: input.targetId,
      collectionId: collection.id,
      ...(input.filter === undefined ? {} : { filter: structuredClone(input.filter) }),
      rights,
      allowReshare: input.allowReshare ?? false,
      createdBy: context.actorId,
      createdAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.insertAttachment(attachment));
    return attachment;
  }

  async reshare(context: ExecutionContext, input: ReshareAttachmentInput): Promise<Attachment> {
    await this.assertContext(context);
    const current = await this.catalog.getWorkspace(context.workspaceId);
    if (!current) throw resourceNotFound("Workspace", context.workspaceId);
    if (!current.policy.reshare) throw denied("This Workspace does not permit re-sharing.");
    const source = current.spec.sources.find((item) => item.key === input.sourceKey);
    if (!source) throw resourceNotFound("Source", input.sourceKey);
    const parent = await this.catalog.getAttachmentBySource(current.id, source.id);
    if (!parent) throw resourceNotFound("Source binding", input.sourceKey);
    await this.assertLive(parent.id);
    if (!parent.allowReshare) throw denied("This Attachment does not permit re-sharing.");
    await this.authorize({
      context,
      operation: "attachments.reshare",
      resource: {
        kind: "attachment",
        id: parent.id,
        attachmentId: parent.id,
        workspaceId: current.id,
        collectionId: parent.collectionId,
      },
    });
    await this.assertContext({ ...context, workspaceId: input.targetId });
    const target = await this.catalog.getWorkspace(input.targetId);
    if (!target?.spec.sources.some((candidate) => candidate.id === input.sourceId))
      throw resourceNotFound("Source", input.sourceId);
    await this.authorize({
      context: { ...context, workspaceId: input.targetId },
      operation: "attachments.accept",
      resource: { kind: "workspace", id: input.targetId, workspaceId: input.targetId },
    });
    const rights = normalizedRights(input.rights ?? parent.rights);
    if (rights.some((right) => !parent.rights.includes(right)))
      throw denied("Derived Attachment rights cannot exceed the received Attachment.");
    const attachment: Attachment = {
      id: this.ids.create("attachment"),
      parentId: parent.id,
      sourceId: input.sourceId,
      originId: parent.originId,
      targetId: input.targetId,
      collectionId: parent.collectionId,
      ...combineFilters(parent.filter, input.filter),
      rights,
      allowReshare: input.allowReshare ?? false,
      createdBy: context.actorId,
      createdAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.insertAttachment(attachment));
    return attachment;
  }

  async listTo(context: ExecutionContext): Promise<Attachment[]> {
    await this.assertContext(context);
    await this.authorize({
      context,
      operation: "attachments.listTo",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    return this.catalog.listAttachmentsTo(context.workspaceId);
  }

  async listFrom(context: ExecutionContext): Promise<Attachment[]> {
    await this.assertContext(context);
    await this.authorize({
      context,
      operation: "attachments.listFrom",
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
    return this.catalog.listAttachmentsFrom(context.workspaceId);
  }

  async revoke(context: ExecutionContext, id: string): Promise<void> {
    await this.assertContext(context);
    const attachment = await this.catalog.getAttachment(id);
    if (!attachment) throw resourceNotFound("Attachment", id);
    if (context.workspaceId !== attachment.originId && context.workspaceId !== attachment.targetId)
      throw denied("Revocation requires the origin or target Workspace context.");
    await this.authorize({
      context,
      operation: "attachments.revoke",
      resource: {
        kind: "attachment",
        id,
        attachmentId: id,
        workspaceId: context.workspaceId,
        collectionId: attachment.collectionId,
      },
    });
    await this.catalog.transaction((transaction) =>
      transaction.revokeAttachment(id, context.actorId, this.clock.now()),
    );
  }

  async schema(context: ExecutionContext, key: string): Promise<CollectionDefinition> {
    const { attachment, collection } = await this.resolve(context, key, "records.schema");
    await this.assertLive(attachment.id);
    return structuredClone(collection);
  }

  async listRecords(context: ExecutionContext, key: string): Promise<CollectionRecord[]> {
    const { attachment, collection } = await this.resolve(context, key, "records.list");
    const records = await this.records.list(attachment.originId, collection);
    await this.assertLive(attachment.id);
    return records.filter((record) =>
      evaluateCondition(attachment.filter, collection, record.values, true),
    );
  }

  async getRecord(
    context: ExecutionContext,
    key: string,
    id: string,
  ): Promise<CollectionRecord | null> {
    const { attachment, collection } = await this.resolve(context, key, "records.read", id);
    const record = await this.records.get(attachment.originId, collection, id);
    await this.assertLive(attachment.id);
    return record && evaluateCondition(attachment.filter, collection, record.values, true)
      ? record
      : null;
  }

  async getManyRecords(
    context: ExecutionContext,
    key: string,
    ids: readonly string[],
  ): Promise<CollectionRecord[]> {
    const { attachment, collection } = await this.resolve(context, key, "records.list");
    const records = await this.records.getMany(attachment.originId, collection, ids);
    await this.assertLive(attachment.id);
    return records.filter((record) =>
      evaluateCondition(attachment.filter, collection, record.values, true),
    );
  }

  async resolveMutation(
    context: ExecutionContext,
    key: string,
    right: "update" | "delete",
    recordId: string,
  ): Promise<AttachmentMutationTarget> {
    const { attachment, collection } = await this.resolve(
      context,
      key,
      `records.${right}`,
      recordId,
      right,
    );
    const record = await this.records.get(attachment.originId, collection, recordId);
    await this.assertLive(attachment.id);
    if (!record || !evaluateCondition(attachment.filter, collection, record.values, true))
      throw resourceNotFound("Record", recordId);
    return { attachment, collection, record };
  }

  private async resolve(
    context: ExecutionContext,
    key: string,
    operation: string,
    recordId?: string,
    right: AttachmentRight = "read",
  ): Promise<{ attachment: Attachment; collection: CollectionDefinition }> {
    await this.assertContext(context);
    const target = await this.catalog.getWorkspace(context.workspaceId);
    const source = target?.spec.sources.find((candidate) => candidate.key === key);
    if (!source) throw resourceNotFound("Source", key);
    const attachment = await this.catalog.getAttachmentBySource(context.workspaceId, source.id);
    if (!attachment) throw resourceNotFound("Source binding", key);
    await this.authorize({
      context,
      operation: `attachments.${right}`,
      resource: {
        kind: "attachment",
        id: attachment.id,
        attachmentId: attachment.id,
        workspaceId: attachment.targetId,
        collectionId: attachment.collectionId,
      },
    });
    const origin = await this.catalog.getWorkspace(attachment.originId);
    const collection = origin?.spec.collections.find((item) => item.id === attachment.collectionId);
    if (!collection) throw resourceNotFound("Collection", attachment.collectionId);
    const originMembership = await this.catalog.getMembership(context.actorId, attachment.originId);
    if (!originMembership && !attachment.rights.includes(right))
      throw denied(`This Attachment does not permit ${right} operations.`);
    // Revalidate against current schema: removed filter Fields must fail closed.
    if (attachment.filter !== undefined) assertValidFieldCondition(attachment.filter, collection);
    await this.authorize({
      context,
      operation,
      resource: {
        kind: recordId === undefined ? "collection" : "record",
        id: recordId ?? collection.id,
        workspaceId: attachment.originId,
        collectionId: collection.id,
        attachmentId: attachment.id,
      },
    });
    return { attachment, collection };
  }

  private async assertLive(id: string): Promise<void> {
    const visited = new Set<string>();
    let currentId: string | undefined = id;
    while (currentId !== undefined) {
      if (visited.has(currentId)) throw resourceConflict("Attachment provenance contains a cycle.");
      visited.add(currentId);
      const attachment = await this.catalog.getAttachment(currentId);
      if (!attachment || attachment.revokedAt !== undefined)
        throw resourceNotFound("Attachment", currentId);
      currentId = attachment.parentId;
    }
  }
}

function normalizedRights(rights: readonly AttachmentRight[]): AttachmentRight[] {
  const normalized = ATTACHMENT_RIGHTS.filter((right) => rights.includes(right));
  if (
    normalized.length === 0 ||
    normalized.length !== rights.length ||
    normalized.length !== new Set(rights).size
  )
    throw resourceConflict("Attachment rights must be a non-empty unique set of supported rights.");
  return normalized;
}

function combineFilters(
  inherited: FieldCondition | undefined,
  added: FieldCondition | undefined,
): { filter?: FieldCondition } {
  if (inherited === undefined && added === undefined) return {};
  if (inherited === undefined) return { filter: structuredClone(added!) };
  if (added === undefined) return { filter: structuredClone(inherited) };
  return { filter: { all: [structuredClone(inherited), structuredClone(added)] } };
}

function denied(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.permissionDenied, message });
}
