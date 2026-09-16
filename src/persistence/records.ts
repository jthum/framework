import type { CollectionDefinition, JsonValue } from "../spec/model.ts";

export type RecordValues = Readonly<Record<string, JsonValue>>;

export interface CollectionRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly values: RecordValues;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdByActorId: string;
  readonly updatedByActorId: string;
}

export interface RecordStore {
  materialize(workspaceId: string, collections: readonly CollectionDefinition[]): Promise<void>;
  create(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void>;
  get(
    workspaceId: string,
    collection: CollectionDefinition,
    recordId: string,
  ): Promise<CollectionRecord | null>;
  list(workspaceId: string, collection: CollectionDefinition): Promise<CollectionRecord[]>;
  update(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void>;
  delete(workspaceId: string, collection: CollectionDefinition, recordId: string): Promise<void>;
}
