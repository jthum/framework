import { resourceConflict, resourceNotFound } from "../errors/error.ts";
import { MemoryExecutionStore } from "./executions.ts";
import type { Actor, Attachment, Membership, Workspace } from "../kernel/model.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type {
  CatalogRepository,
  CatalogTransaction,
  PersistenceAdapter,
  PersistenceSession,
} from "./catalog.ts";
import type { CollectionRecord, RecordStore } from "./records.ts";
import {
  assertActorIntegrity,
  assertAttachmentIntegrity,
  assertAttachmentRevocation,
  assertMembershipIdentityUnchanged,
  assertMembershipIntegrity,
  assertWorkspaceIntegrity,
  assertWorkspaceTopologyUnchanged,
} from "./catalog-integrity.ts";

interface MemoryState {
  workspaces: Map<string, Workspace>;
  actors: Map<string, Actor>;
  memberships: Map<string, Membership>;
  attachments: Map<string, Attachment>;
}

export class MemoryPersistenceAdapter implements PersistenceAdapter {
  readonly kind = "memory";
  private readonly repository = new MemoryCatalogRepository();
  private readonly records = new MemoryRecordStore();
  private readonly executions = new MemoryExecutionStore();

  async open(): Promise<PersistenceSession> {
    return {
      executions: this.executions,
      catalog: this.repository,
      records: this.records,
      applyWorkspaceSpec: async (workspace, seeds = []) => {
        const snapshot = this.records.snapshot();
        try {
          await this.records.applySchema(workspace.id, workspace.spec.collections);
          for (const seed of seeds)
            for (const record of seed.records)
              await this.records.create(workspace.id, seed.collection, record);
          await this.repository.transaction((transaction) =>
            transaction.updateWorkspace(workspace),
          );
        } catch (error) {
          this.records.restore(snapshot);
          throw error;
        }
      },
      close: async () => {},
    };
  }
}

export class MemoryCatalogRepository implements CatalogRepository, CatalogTransaction {
  private state = emptyState();
  private queue: Promise<unknown> = Promise.resolve();

  async getWorkspace(id: string): Promise<Workspace | null> {
    return cloneOptional(this.state.workspaces.get(id));
  }

  async listRootWorkspaces(): Promise<Workspace[]> {
    return cloneValues(this.state.workspaces).filter((item) => item.isRoot);
  }

  async listChildWorkspaces(parentId: string): Promise<Workspace[]> {
    return cloneValues(this.state.workspaces).filter((item) => item.parentId === parentId);
  }

  async listWorkspacesByRoot(rootId: string): Promise<Workspace[]> {
    return cloneValues(this.state.workspaces).filter((item) => item.rootId === rootId);
  }

  async getActor(id: string): Promise<Actor | null> {
    return cloneOptional(this.state.actors.get(id));
  }

  async listActorsByOrigin(originId: string): Promise<Actor[]> {
    return cloneValues(this.state.actors).filter((item) => item.originId === originId);
  }

  async listActorsByRoot(rootId: string): Promise<Actor[]> {
    return cloneValues(this.state.actors).filter((item) => item.rootId === rootId);
  }

  async listMembers(workspaceId: string): Promise<Actor[]> {
    const actorIds = new Set(
      cloneValues(this.state.memberships)
        .filter((item) => item.workspaceId === workspaceId)
        .map((item) => item.actorId),
    );
    return cloneValues(this.state.actors).filter((item) => actorIds.has(item.id));
  }

  async getMembership(actorId: string, workspaceId: string): Promise<Membership | null> {
    return (
      cloneValues(this.state.memberships).find(
        (item) => item.actorId === actorId && item.workspaceId === workspaceId,
      ) ?? null
    );
  }

  async listMembershipsForActor(actorId: string): Promise<Membership[]> {
    return cloneValues(this.state.memberships).filter((item) => item.actorId === actorId);
  }

  async listMembershipsForWorkspace(workspaceId: string): Promise<Membership[]> {
    return cloneValues(this.state.memberships).filter((item) => item.workspaceId === workspaceId);
  }

  async insertWorkspace(workspace: Workspace): Promise<void> {
    await assertWorkspaceIntegrity(this, workspace);
    insertUnique(this.state.workspaces, workspace, "Workspace");
  }

  async getAttachment(id: string): Promise<Attachment | null> {
    return cloneOptional(this.state.attachments.get(id));
  }

  async getAttachmentBySource(targetId: string, sourceId: string): Promise<Attachment | null> {
    return (
      cloneValues(this.state.attachments).find(
        (item) =>
          item.targetId === targetId && item.sourceId === sourceId && item.revokedAt === undefined,
      ) ?? null
    );
  }

  async listAttachmentsTo(targetId: string): Promise<Attachment[]> {
    return cloneValues(this.state.attachments).filter((item) => item.targetId === targetId);
  }

  async listAttachmentsFrom(originId: string): Promise<Attachment[]> {
    return cloneValues(this.state.attachments).filter((item) => item.originId === originId);
  }

  async insertAttachment(attachment: Attachment): Promise<void> {
    await assertAttachmentIntegrity(this, attachment);
    insertUnique(this.state.attachments, attachment, "Attachment");
  }

  async revokeAttachment(id: string, actorId: string, stamp: string): Promise<void> {
    const attachment = this.state.attachments.get(id);
    if (!attachment) throw resourceNotFound("Attachment", id);
    await assertAttachmentRevocation(this, attachment, actorId);
    if (attachment.revokedAt !== undefined) return;
    this.state.attachments.set(id, clone({ ...attachment, revokedAt: stamp, revokedBy: actorId }));
  }

  async insertActor(actor: Actor): Promise<void> {
    await assertActorIntegrity(this, actor);
    insertUnique(this.state.actors, actor, "Actor");
  }

  async insertMembership(membership: Membership): Promise<void> {
    await assertMembershipIntegrity(this, membership);
    if (await this.getMembership(membership.actorId, membership.workspaceId)) {
      throw resourceConflict("The Actor is already a member of this Workspace.");
    }
    insertUnique(this.state.memberships, membership, "Membership");
  }

  async updateMembership(membership: Membership): Promise<void> {
    const previous = this.state.memberships.get(membership.id);
    if (!previous) throw resourceNotFound("Membership", membership.id);
    assertMembershipIdentityUnchanged(previous, membership);
    await assertMembershipIntegrity(this, membership);
    this.state.memberships.set(membership.id, clone(membership));
  }

  async updateWorkspace(workspace: Workspace): Promise<void> {
    const previous = this.state.workspaces.get(workspace.id);
    if (!previous) throw resourceNotFound("Workspace", workspace.id);
    assertWorkspaceTopologyUnchanged(previous, workspace);
    await assertWorkspaceIntegrity(this, workspace);
    this.state.workspaces.set(workspace.id, clone(workspace));
  }

  transaction<T>(work: (transaction: CatalogTransaction) => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const previous = cloneState(this.state);
      try {
        return await work(this);
      } catch (error) {
        this.state = previous;
        throw error;
      }
    });
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}

export class MemoryRecordStore implements RecordStore {
  private readonly collections = new Map<string, CollectionDefinition>();
  private readonly records = new Map<string, Map<string, CollectionRecord>>();

  snapshot(): MemoryRecordState {
    return {
      collections: cloneMap(this.collections),
      records: new Map([...this.records].map(([key, records]) => [key, cloneMap(records)])),
    };
  }

  restore(state: MemoryRecordState): void {
    this.collections.clear();
    this.records.clear();
    for (const [key, collection] of state.collections) this.collections.set(key, collection);
    for (const [key, records] of state.records) this.records.set(key, records);
  }

  async applySchema(
    workspaceId: string,
    collections: readonly CollectionDefinition[],
  ): Promise<void> {
    const desired = new Set(collections.map((collection) => collection.id));
    for (const [key, previous] of this.collections) {
      if (!key.startsWith(`${workspaceId}\0`) || desired.has(previous.id)) continue;
      this.collections.delete(key);
      this.records.delete(key);
    }
    for (const collection of collections) {
      const key = collectionKey(workspaceId, collection.id);
      const previous = this.collections.get(key);
      if (previous) migrateMemoryRecords(this.records.get(key), previous, collection);
      this.collections.set(key, clone(collection));
      if (!this.records.has(key)) this.records.set(key, new Map());
    }
  }

  async create(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    const records = this.requireCollection(workspaceId, collection);
    if (records.has(record.id)) throw resourceConflict("Record already exists.");
    records.set(record.id, clone(record));
  }

  async get(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<CollectionRecord | null> {
    return cloneOptional(this.requireCollection(workspaceId, collection).get(recordId));
  }

  async getMany(
    workspaceId: string,
    collection: CollectionDefinition,
    recordIds: readonly string[],
  ): Promise<CollectionRecord[]> {
    const records = this.requireCollection(workspaceId, collection);
    return recordIds.flatMap((id) => {
      const record = records.get(id);
      return record === undefined ? [] : [clone(record)];
    });
  }

  async list(workspaceId: string, collection: CollectionDefinition): Promise<CollectionRecord[]> {
    return cloneValues(this.requireCollection(workspaceId, collection));
  }

  async update(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void> {
    const records = this.requireCollection(workspaceId, collection);
    if (!records.has(record.id)) throw resourceNotFound("Record", record.id);
    records.set(record.id, clone(record));
  }

  async delete(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<void> {
    const records = this.requireCollection(workspaceId, collection);
    if (!records.delete(recordId)) throw resourceNotFound("Record", recordId);
  }

  private requireCollection(
    workspaceId: string,
    collection: CollectionDefinition,
  ): Map<string, CollectionRecord> {
    const key = collectionKey(workspaceId, collection.id);
    const records = this.records.get(key);
    if (!this.collections.has(key) || !records) throw resourceNotFound("Collection", collection.id);
    return records;
  }
}

interface MemoryRecordState {
  readonly collections: Map<string, CollectionDefinition>;
  readonly records: Map<string, Map<string, CollectionRecord>>;
}

function emptyState(): MemoryState {
  return {
    workspaces: new Map(),
    actors: new Map(),
    memberships: new Map(),
    attachments: new Map(),
  };
}

function insertUnique<T extends { readonly id: string }>(
  values: Map<string, T>,
  value: T,
  kind: string,
): void {
  if (values.has(value.id)) throw resourceConflict(`${kind} already exists.`);
  values.set(value.id, clone(value));
}

function cloneState(state: MemoryState): MemoryState {
  return {
    workspaces: cloneMap(state.workspaces),
    actors: cloneMap(state.actors),
    memberships: cloneMap(state.memberships),
    attachments: cloneMap(state.attachments),
  };
}

function cloneMap<T>(values: Map<string, T>): Map<string, T> {
  return new Map([...values].map(([key, value]) => [key, clone(value)]));
}

function cloneValues<T>(values: Map<string, T>): T[] {
  return [...values.values()].map(clone);
}

function cloneOptional<T>(value: T | undefined): T | null {
  return value === undefined ? null : clone(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function collectionKey(workspaceId: string, collectionId: string): string {
  return `${workspaceId}\0${collectionId}`;
}

function migrateMemoryRecords(
  records: Map<string, CollectionRecord> | undefined,
  previous: CollectionDefinition,
  next: CollectionDefinition,
): void {
  if (!records) return;
  const previousFields = new Map(previous.fields.map((field) => [field.id, field]));
  for (const [id, record] of records) {
    const values: Record<string, CollectionRecord["values"][string]> = {};
    for (const field of next.fields) {
      const previousField = previousFields.get(field.id);
      const previousKey = previousField?.key ?? field.key;
      const value = record.values[previousKey];
      if (value !== undefined) {
        values[field.key] = value;
      } else {
        const fallback = schemaDefault(next, field.id);
        if (fallback !== undefined) values[field.key] = fallback;
      }
    }
    records.set(id, clone({ ...record, collectionId: next.id, values }));
  }
}

function schemaDefault(
  collection: CollectionDefinition,
  fieldId: string,
): CollectionRecord["values"][string] | undefined {
  const field = collection.fields.find((candidate) => candidate.id === fieldId);
  if (field?.default !== undefined) return clone(field.default);
  return collection.lifecycle?.fieldId === fieldId ? collection.lifecycle.initial : undefined;
}
