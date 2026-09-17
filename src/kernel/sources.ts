import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { CollectionRecord, RecordStore, RecordValues } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  JsonValue,
  SourceQueryDefinition,
} from "../spec/model.ts";
import { assertValidSourceQuery } from "../spec/validate.ts";
import type { AttachmentService } from "./attachments.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext, Workspace } from "./model.ts";
import { executeSourceQuery } from "./source-query.ts";

export interface SourceCapabilities {
  readonly filter: boolean;
  readonly sort: boolean;
  readonly pagination: boolean;
  readonly relations: boolean;
  readonly aggregate: boolean;
  readonly suggestions: boolean;
}

export type SourceSchema = CollectionDefinition;

export interface SourceDescriptor {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly schema: SourceSchema;
  readonly capabilities: SourceCapabilities;
}

export interface SourceColumn {
  readonly key: string;
  readonly label: string;
  readonly fieldId?: string;
  readonly path?: readonly string[];
  readonly type: FieldDefinition["type"];
  readonly aggregate?: "group" | "count" | "sum" | "avg" | "min" | "max";
}

export interface SourceRow {
  readonly id: string;
  readonly values: RecordValues;
}

export interface SourceResult {
  readonly source: SourceDescriptor;
  readonly columns: readonly SourceColumn[];
  readonly rows: readonly SourceRow[];
  /** Count after filtering and before pagination. */
  readonly total: number;
}

/** Contract future external and module Sources can implement. */
export interface SourceProvider {
  readonly kind: string;
  describe(context: ExecutionContext, key: string): Promise<SourceDescriptor | null>;
  query(
    context: ExecutionContext,
    key: string,
    query?: SourceQueryDefinition,
  ): Promise<SourceResult>;
  get(context: ExecutionContext, key: string, id: string): Promise<SourceRow | null>;
  getMany(
    context: ExecutionContext,
    key: string,
    ids: readonly string[],
  ): Promise<readonly SourceRow[]>;
  suggest?(
    context: ExecutionContext,
    key: string,
    fieldId: string,
    input: string,
  ): Promise<readonly JsonValue[]>;
}

const localCapabilities: SourceCapabilities = Object.freeze({
  filter: true,
  sort: true,
  pagination: true,
  relations: true,
  aggregate: true,
  suggestions: false,
});

const attachedCapabilities: SourceCapabilities = Object.freeze({
  ...localCapabilities,
  relations: false,
});

/** Built-in provider for local Collections and Attachment bindings in one Workspace. */
export class SourceService implements SourceProvider {
  readonly kind = "workspace";

  constructor(
    private readonly catalog: CatalogRepository,
    private readonly records: RecordStore,
    private readonly attachments: AttachmentService,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<SourceDescriptor[]> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = await Promise.all(
      workspace.spec.collections.map((collection) => this.describeLocal(context, collection)),
    );
    const attached: SourceDescriptor[] = [];
    for (const binding of workspace.spec.sources) {
      try {
        attached.push(await this.describeAttached(context, binding.key));
      } catch (error) {
        if (!(error instanceof FrameworkError) || error.code !== ERROR_CODES.resourceNotFound)
          throw error;
      }
    }
    return [...local, ...attached];
  }

  async describe(context: ExecutionContext, key: string): Promise<SourceDescriptor | null> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) return this.describeLocal(context, local);
    if (!workspace.spec.sources.some((source) => source.key === key)) return null;
    return this.describeAttached(context, key);
  }

  async query(
    context: ExecutionContext,
    key: string,
    query: SourceQueryDefinition = {},
  ): Promise<SourceResult> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      assertValidSourceQuery(
        query,
        local,
        workspace.spec.collections,
        new Set(workspace.spec.sources.map((source) => source.id)),
      );
      await this.authorizeCollection(context, "records.list", workspace.id, local.id);
      const records = await this.records.list(workspace.id, local);
      const source = await this.describeLocal(context, local);
      return executeSourceQuery(source, records, query, {
        resolve: (sourceId, ids) => this.resolveRelation(context, workspace, sourceId, ids),
      });
    }
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const collection = await this.attachments.schema(context, key);
    assertValidSourceQuery(query, collection);
    rejectRelationPaths(query);
    const records = await this.attachments.listRecords(context, key);
    const source = await this.describeAttached(context, key, collection);
    return executeSourceQuery(source, records, query);
  }

  async get(context: ExecutionContext, key: string, id: string): Promise<SourceRow | null> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      await this.authorizeCollection(context, "records.read", workspace.id, local.id, id);
      const record = await this.records.get(workspace.id, local, id);
      return record ? sourceRow(record) : null;
    }
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const record = await this.attachments.getRecord(context, key, id);
    return record ? sourceRow(record) : null;
  }

  async getMany(
    context: ExecutionContext,
    key: string,
    ids: readonly string[],
  ): Promise<readonly SourceRow[]> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      await this.authorizeCollection(context, "records.list", workspace.id, local.id);
      return (await this.records.getMany(workspace.id, local, ids)).map(sourceRow);
    }
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    return (await this.attachments.getManyRecords(context, key, ids)).map(sourceRow);
  }

  private async describeLocal(
    context: ExecutionContext,
    collection: CollectionDefinition,
  ): Promise<SourceDescriptor> {
    await this.authorizeCollection(context, "records.schema", context.workspaceId, collection.id);
    return sourceDescriptor(
      collection.key,
      collection.label,
      "collection",
      collection,
      localCapabilities,
    );
  }

  private async describeAttached(
    context: ExecutionContext,
    key: string,
    knownSchema?: CollectionDefinition,
  ): Promise<SourceDescriptor> {
    const workspace = await this.requireWorkspace(context.workspaceId);
    const binding = workspace.spec.sources.find((source) => source.key === key);
    if (!binding) throw resourceNotFound("Source", key);
    const schema = knownSchema ?? (await this.attachments.schema(context, key));
    return sourceDescriptor(key, binding.label, "attachment", schema, attachedCapabilities);
  }

  private async authorizeCollection(
    context: ExecutionContext,
    operation: string,
    workspaceId: string,
    collectionId: string,
    recordId?: string,
  ): Promise<void> {
    await this.authorize({
      context,
      operation,
      resource: {
        kind: recordId === undefined ? "collection" : "record",
        id: recordId ?? collectionId,
        workspaceId,
        collectionId,
      },
    });
  }

  private async resolveRelation(
    context: ExecutionContext,
    workspace: Workspace,
    sourceId: string,
    ids: readonly string[],
  ) {
    const collection = workspace.spec.collections.find((item) => item.id === sourceId);
    if (collection) {
      const source = await this.describeLocal(context, collection);
      return {
        schema: source.schema,
        rows: await this.getMany(context, collection.key, ids),
        traversable: true,
      };
    }
    const binding = workspace.spec.sources.find((item) => item.id === sourceId);
    if (!binding) throw resourceNotFound("Source", sourceId);
    const source = await this.describeAttached(context, binding.key);
    return {
      schema: source.schema,
      rows: await this.getMany(context, binding.key, ids),
      traversable: false,
    };
  }

  private async requireWorkspace(id: string) {
    const workspace = await this.catalog.getWorkspace(id);
    if (!workspace) throw resourceNotFound("Workspace", id);
    return workspace;
  }
}

function sourceDescriptor(
  key: string,
  label: string,
  kind: string,
  collection: CollectionDefinition,
  capabilities: SourceCapabilities,
): SourceDescriptor {
  return { key, label, kind, schema: structuredClone(collection), capabilities };
}

function sourceRow(record: CollectionRecord): SourceRow {
  return { id: record.id, values: structuredClone(record.values) };
}

function rejectRelationPaths(query: SourceQueryDefinition): void {
  if (queryPaths(query).some((path) => path.length > 1)) {
    throw new FrameworkError({
      code: "SOURCE.CAPABILITY_UNSUPPORTED",
      message: "Attached Sources do not expose related Collections implicitly.",
    });
  }
}

function queryPaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  return [
    ...filterPaths(query.filter),
    ...(query.sort?.map((item) => item.path) ?? []),
    ...(query.select?.map((item) => item.path) ?? []),
  ];
}

function filterPaths(filter: SourceQueryDefinition["filter"]): readonly (readonly string[])[] {
  if (!filter) return [];
  if ("all" in filter) return filter.all.flatMap(filterPaths);
  if ("any" in filter) return filter.any.flatMap(filterPaths);
  if ("not" in filter) return filterPaths(filter.not);
  return [filter.path];
}
