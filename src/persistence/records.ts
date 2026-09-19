import type {
  CollectionDefinition,
  JsonValue,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";

export type RecordValues = Readonly<Record<string, JsonValue>>;

export interface CollectionRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly values: RecordValues;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly createdBy: string;
  readonly updatedBy: string;
}

export interface RecordQueryResult {
  readonly rows: readonly { readonly id: string; readonly values: RecordValues }[];
  readonly total: number;
}

/** An authorized reference hop needed by a Source query. Paths contain reference Field IDs. */
export interface RecordQueryRelation {
  readonly path: readonly string[];
  readonly workspaceId: string;
  readonly collection: CollectionDefinition;
  readonly filter?: SourceFilter;
}

export interface RecordStore {
  /** Explicit reference-evaluator mode for adapters whose entire dataset already lives in memory. */
  readonly queryMode?: "in-memory";
  applySchema(workspaceId: string, collections: readonly CollectionDefinition[]): Promise<void>;
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
  getMany(
    workspaceId: string,
    collection: CollectionDefinition,
    recordIds: readonly string[],
  ): Promise<CollectionRecord[]>;
  /** List records in stable createdAt/id order. */
  list(workspaceId: string, collection: CollectionDefinition): Promise<CollectionRecord[]>;
  /** List visible rows with a storage-executed restriction. */
  listFiltered?(
    workspaceId: string,
    collection: CollectionDefinition,
    filter: SourceFilter,
  ): Promise<CollectionRecord[]>;
  /** A storage-executed query. Adapters that implement this must not materialize the Collection. */
  query?(
    workspaceId: string,
    collection: CollectionDefinition,
    query: SourceQueryDefinition,
  ): Promise<RecordQueryResult>;
  /** Execute a query across declared, authorized relationship hops without loading root rows. */
  queryRelated?(
    workspaceId: string,
    collection: CollectionDefinition,
    query: SourceQueryDefinition,
    relations: readonly RecordQueryRelation[],
  ): Promise<RecordQueryResult>;
  update(
    workspaceId: string,
    collection: CollectionDefinition,
    record: CollectionRecord,
  ): Promise<void>;
  delete(workspaceId: string, collection: CollectionDefinition, recordId: string): Promise<void>;
}
