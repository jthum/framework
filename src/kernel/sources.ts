import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type {
  CollectionRecord,
  RecordQueryRelation,
  RecordStore,
  RecordValues,
} from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  JsonValue,
  SourceQueryDefinition,
} from "../spec/model.ts";
import { assertValidSourceQuery } from "../spec/validate.ts";
import type { AttachmentService } from "./attachments.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { RecordPolicyService } from "./record-policy.ts";
import type { ExecutionContext, Workspace } from "./model.ts";
import { executeSourceQuery, relatedQueryColumns, rootQueryColumns } from "./source-query.ts";

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
    private readonly records: RecordStore,
    private readonly attachments: AttachmentService,
    private readonly policies: RecordPolicyService,
    private readonly resolveWorkspace: (context: ExecutionContext) => Promise<Workspace>,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async list(context: ExecutionContext): Promise<SourceDescriptor[]> {
    await this.assertContext(context);
    const workspace = await this.resolveWorkspace(context);
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
    const workspace = await this.resolveWorkspace(context);
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
    const workspace = await this.resolveWorkspace(context);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      query = await this.withDefaultGroupLabel(context, workspace, local, query);
      assertValidSourceQuery(
        query,
        local,
        workspace.spec.collections,
        new Set(workspace.spec.sources.map((source) => source.id)),
      );
      await this.authorizeCollection(context, "records.list", workspace.id, local.id);
      if (hasRelationalPredicateOrAggregate(query) && this.records.queryRelated) {
        const { relations, attachmentIds } = await this.planRelations(
          context,
          workspace,
          local,
          query,
        );
        const restriction = await this.policies.readFilter(local, context);
        const effective = restriction
          ? {
              ...query,
              filter: query.filter ? ({ all: [restriction, query.filter] } as const) : restriction,
            }
          : query;
        const source = await this.describeLocal(context, local);
        const result = await this.records.queryRelated(workspace.id, local, effective, relations);
        for (const id of attachmentIds) await this.attachments.assertQueryTargetLive(id);
        return { source, columns: relatedQueryColumns(local, query, relations), ...result };
      }
      if (this.records.query && !hasRelationalPredicateOrAggregate(query)) {
        const restriction = await this.policies.readFilter(local, context);
        const effective = restriction
          ? {
              ...query,
              filter: query.filter ? ({ all: [restriction, query.filter] } as const) : restriction,
            }
          : query;
        const source = await this.describeLocal(context, local);
        if (query.select?.some((item) => item.path.length > 1)) {
          const { select: _selection, ...rootQuery } = effective;
          const result = await this.records.query(workspace.id, local, rootQuery);
          const projected = await executeSourceQuery(
            source,
            result.rows,
            { select: query.select },
            {
              resolve: (sourceId, ids) => this.resolveRelation(context, workspace, sourceId, ids),
            },
          );
          return { ...projected, total: result.total };
        }
        const result = await this.records.query(workspace.id, local, effective);
        return { source, columns: rootQueryColumns(local, query), ...result };
      }
      if (this.records.queryMode !== "in-memory")
        throw new FrameworkError({
          code: "SOURCE.CAPABILITY_UNSUPPORTED",
          message: "This RecordStore does not execute this Source query.",
        });
      const records = await this.policies.filter(
        context,
        workspace.id,
        local,
        await this.records.list(workspace.id, local),
      );
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
    if (this.records.query) {
      const result = await this.attachments.queryRecords(context, key, query);
      const source = await this.describeAttached(context, key, collection);
      return { source, columns: rootQueryColumns(collection, query), ...result };
    }
    if (this.records.queryMode !== "in-memory")
      throw new FrameworkError({
        code: "SOURCE.CAPABILITY_UNSUPPORTED",
        message: "This RecordStore does not execute attached Source queries.",
      });
    const records = await this.attachments.listRecords(context, key);
    const source = await this.describeAttached(context, key, collection);
    return executeSourceQuery(source, records, query);
  }

  /** A reference groups by stable record identity while displaying the target record title. */
  private async withDefaultGroupLabel(
    context: ExecutionContext,
    workspace: Workspace,
    root: CollectionDefinition,
    query: SourceQueryDefinition,
  ): Promise<SourceQueryDefinition> {
    const group = query.aggregate?.group;
    if (!group || group.labelPath) return query;
    let collection = root;
    let terminal: FieldDefinition | undefined;
    for (const [index, fieldId] of group.path.entries()) {
      terminal = collection.fields.find((field) => field.id === fieldId);
      if (!terminal || index === group.path.length - 1) break;
      if (terminal.type !== "reference") return query;
      collection = await this.relationSchema(context, workspace, terminal.sourceId);
    }
    if (terminal?.type !== "reference") return query;
    const target = await this.relationSchema(context, workspace, terminal.sourceId);
    const title = titleField(target);
    if (!title) return query;
    return {
      ...query,
      aggregate: {
        ...query.aggregate!,
        group: { ...group, labelPath: [...group.path, title.id] },
      },
    };
  }

  private async relationSchema(
    context: ExecutionContext,
    workspace: Workspace,
    sourceId: string,
  ): Promise<CollectionDefinition> {
    const local = workspace.spec.collections.find((collection) => collection.id === sourceId);
    if (local) return local;
    const binding = workspace.spec.sources.find((source) => source.id === sourceId);
    if (!binding) throw resourceNotFound("Source", sourceId);
    return this.attachments.schema(context, binding.key);
  }

  async get(context: ExecutionContext, key: string, id: string): Promise<SourceRow | null> {
    await this.assertContext(context);
    const workspace = await this.resolveWorkspace(context);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      await this.authorizeCollection(context, "records.read", workspace.id, local.id, id);
      const record = (
        await this.policies.filter(
          context,
          workspace.id,
          local,
          [await this.records.get(workspace.id, local, id)].filter(
            (item): item is CollectionRecord => item !== null,
          ),
        )
      )[0];
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
    const workspace = await this.resolveWorkspace(context);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      await this.authorizeCollection(context, "records.list", workspace.id, local.id);
      return (
        await this.policies.filter(
          context,
          workspace.id,
          local,
          await this.records.getMany(workspace.id, local, ids),
        )
      ).map(sourceRow);
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
    const workspace = await this.resolveWorkspace(context);
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

  private async planRelations(
    context: ExecutionContext,
    workspace: Workspace,
    root: CollectionDefinition,
    query: SourceQueryDefinition,
  ): Promise<{ relations: RecordQueryRelation[]; attachmentIds: string[] }> {
    const relations: RecordQueryRelation[] = [];
    const attachmentIds: string[] = [];
    const known = new Map<string, CollectionDefinition>([["", root]]);
    for (const path of allQueryPaths(query)) {
      for (let length = 1; length < path.length; length += 1) {
        const prefix = path.slice(0, length);
        const key = prefix.join("\0");
        if (known.has(key)) continue;
        const parent = known.get(prefix.slice(0, -1).join("\0"));
        const reference = parent?.fields.find((field) => field.id === prefix.at(-1));
        if (!reference || reference.type !== "reference")
          throw new FrameworkError({
            code: "VALIDATION.INVALID_INPUT",
            message: "Only declared reference Fields may be traversed.",
          });
        const local = workspace.spec.collections.find((item) => item.id === reference.sourceId);
        if (local) {
          await this.authorizeCollection(context, "records.list", workspace.id, local.id);
          await this.describeLocal(context, local);
          const filter = await this.policies.readFilter(local, context);
          relations.push({
            path: prefix,
            workspaceId: workspace.id,
            collection: local,
            ...(filter ? { filter } : {}),
          });
          known.set(key, local);
          continue;
        }
        const binding = workspace.spec.sources.find((item) => item.id === reference.sourceId);
        if (!binding) throw resourceNotFound("Source", reference.sourceId);
        const target = await this.attachments.queryTarget(context, binding.key);
        relations.push({
          path: prefix,
          workspaceId: target.workspaceId,
          collection: target.collection,
          ...(target.filter ? { filter: target.filter } : {}),
        });
        attachmentIds.push(target.attachmentId);
        known.set(key, target.collection);
      }
    }
    return { relations, attachmentIds };
  }
}

function titleField(collection: CollectionDefinition): FieldDefinition | undefined {
  return (
    collection.fields.find((field) => field.id === collection.titleFieldId) ??
    collection.fields.find((field) => ["name", "title", "label"].includes(field.key)) ??
    collection.fields.find((field) => field.type === "text")
  );
}

function hasRelationalPredicateOrAggregate(query: SourceQueryDefinition): boolean {
  const filter = (value: SourceQueryDefinition["filter"]): boolean => {
    if (!value) return false;
    if ("all" in value) return value.all.some(filter);
    if ("any" in value) return value.any.some(filter);
    if ("not" in value) return filter(value.not);
    return value.path.length > 1;
  };
  return (
    filter(query.filter) ||
    Boolean(query.sort?.some((item) => item.path.length > 1)) ||
    Boolean(
      query.aggregate &&
      [
        query.aggregate.group.path,
        ...(query.aggregate.group.labelPath ? [query.aggregate.group.labelPath] : []),
        ...query.aggregate.measures.flatMap((measure) => [
          ...(measure.path ? [measure.path] : []),
          ...(measure.paths ?? []),
        ]),
      ].some((path) => path.length > 1),
    )
  );
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

function allQueryPaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  return [
    ...queryPaths(query),
    ...(query.aggregate
      ? [
          query.aggregate.group.path,
          ...(query.aggregate.group.labelPath ? [query.aggregate.group.labelPath] : []),
          ...query.aggregate.measures.flatMap((measure) => [
            ...(measure.path ? [measure.path] : []),
            ...(measure.paths ?? []),
          ]),
        ]
      : []),
  ];
}

function filterPaths(filter: SourceQueryDefinition["filter"]): readonly (readonly string[])[] {
  if (!filter) return [];
  if ("all" in filter) return filter.all.flatMap(filterPaths);
  if ("any" in filter) return filter.any.flatMap(filterPaths);
  if ("not" in filter) return filterPaths(filter.not);
  return [filter.path];
}
