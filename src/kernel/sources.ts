import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { CollectionRecord, RecordStore, RecordValues } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  FieldOperator,
  JsonValue,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";
import { assertValidSourceQuery } from "../spec/validate.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";
import type { AttachmentService } from "./attachments.ts";

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
  readonly fieldId: string;
  readonly path: readonly string[];
  readonly type: FieldDefinition["type"];
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
  aggregate: false,
  suggestions: false,
});

const attachedCapabilities: SourceCapabilities = Object.freeze({
  ...localCapabilities,
  relations: false,
});

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
      assertValidSourceQuery(query, local, workspace.spec.collections);
      await this.authorizeCollection(context, "records.list", workspace.id, local.id);
      const records = await this.records.list(workspace.id, local);
      const descriptor = await this.describeLocal(context, local);
      return executeQuery(
        descriptor,
        records,
        query,
        new RelationResolver(
          workspace.id,
          workspace.spec.collections,
          this.records,
          context,
          this.authorize,
        ),
      );
    }
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const collection = await this.attachments.schema(context, key);
    assertValidSourceQuery(query, collection);
    rejectRelationPaths(query);
    const records = await this.attachments.listRecords(context, key);
    const descriptor = await this.describeAttached(context, key, collection);
    return executeQuery(descriptor, records, query);
  }

  async get(context: ExecutionContext, key: string, id: string): Promise<SourceRow | null> {
    await this.assertContext(context);
    const workspace = await this.requireWorkspace(context.workspaceId);
    const local = workspace.spec.collections.find((collection) => collection.key === key);
    if (local) {
      await this.authorizeCollection(context, "records.read", workspace.id, local.id, id);
      const record = await this.records.get(workspace.id, local, id);
      return record ? row(record) : null;
    }
    if (!workspace.spec.sources.some((source) => source.key === key))
      throw resourceNotFound("Source", key);
    const record = await this.attachments.getRecord(context, key, id);
    return record ? row(record) : null;
  }

  private async describeLocal(
    context: ExecutionContext,
    collection: CollectionDefinition,
  ): Promise<SourceDescriptor> {
    await this.authorizeCollection(context, "records.schema", context.workspaceId, collection.id);
    return descriptor(
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
    return descriptor(key, binding.label, "attachment", schema, attachedCapabilities);
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

  private async requireWorkspace(id: string) {
    const workspace = await this.catalog.getWorkspace(id);
    if (!workspace) throw resourceNotFound("Workspace", id);
    return workspace;
  }
}

class RelationResolver {
  private readonly cache = new Map<string, Promise<Map<string, JsonValue | undefined>>>();
  private readonly authorized = new Set<string>();

  constructor(
    private readonly workspaceId: string,
    private readonly collections: readonly CollectionDefinition[],
    private readonly records: RecordStore,
    private readonly context: ExecutionContext,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  values(
    root: CollectionDefinition,
    rows: readonly CollectionRecord[],
    path: readonly string[],
  ): Promise<Map<string, JsonValue | undefined>> {
    const key = path.join("\0");
    let result = this.cache.get(key);
    if (!result) {
      result = this.resolve(root, rows, path);
      this.cache.set(key, result);
    }
    return result;
  }

  field(root: CollectionDefinition, path: readonly string[]): FieldDefinition {
    let collection = root;
    for (const [index, fieldId] of path.entries()) {
      const field = collection.fields.find((item) => item.id === fieldId);
      if (!field) throw invalidQuery("Field path contains an unknown Field.");
      if (index === path.length - 1) return field;
      if (field.type !== "reference")
        throw invalidQuery("Only declared reference Fields may be traversed.");
      const target = this.collections.find((item) => item.id === field.collectionId);
      if (!target) throw invalidQuery("Relationship target Collection is unavailable.");
      collection = target;
    }
    throw invalidQuery("Field path cannot be empty.");
  }

  private async resolve(
    root: CollectionDefinition,
    rows: readonly CollectionRecord[],
    path: readonly string[],
  ): Promise<Map<string, JsonValue | undefined>> {
    if (path.length === 0) throw invalidQuery("Field path cannot be empty.");
    let collection = root;
    let plural = false;
    let nodes = new Map(rows.map((record) => [record.id, [record]]));
    for (let index = 0; index < path.length; index += 1) {
      const field = collection.fields.find((item) => item.id === path[index]);
      if (!field) throw invalidQuery("Field path contains an unknown Field.");
      if (index === path.length - 1) {
        return new Map(
          rows.map((rootRecord) => {
            const values = (nodes.get(rootRecord.id) ?? []).flatMap((record) => {
              const value = record.values[field.key];
              return value === undefined ? [] : Array.isArray(value) && plural ? value : [value];
            });
            return [rootRecord.id, plural ? values : values[0]];
          }),
        );
      }
      if (field.type !== "reference")
        throw invalidQuery("Only declared reference Fields may be traversed.");
      const target = this.collections.find((item) => item.id === field.collectionId);
      if (!target) throw invalidQuery("Relationship target Collection is unavailable.");
      await this.authorizeTarget(target);
      plural ||= field.multiple === true;
      const ids = [
        ...new Set(
          [...nodes.values()].flatMap((records) =>
            records.flatMap((record) => referenceIds(record.values[field.key])),
          ),
        ),
      ];
      const related = await this.records.getMany(this.workspaceId, target, ids);
      const byId = new Map(related.map((record) => [record.id, record]));
      nodes = new Map(
        rows.map((rootRecord) => [
          rootRecord.id,
          (nodes.get(rootRecord.id) ?? []).flatMap((record) =>
            referenceIds(record.values[field.key]).flatMap((id) => {
              const relatedRecord = byId.get(id);
              return relatedRecord ? [relatedRecord] : [];
            }),
          ),
        ]),
      );
      collection = target;
    }
    return new Map();
  }

  private async authorizeTarget(collection: CollectionDefinition): Promise<void> {
    if (this.authorized.has(collection.id)) return;
    await this.authorize({
      context: this.context,
      operation: "records.list",
      resource: {
        kind: "collection",
        id: collection.id,
        workspaceId: this.workspaceId,
        collectionId: collection.id,
      },
    });
    this.authorized.add(collection.id);
  }
}

async function executeQuery(
  source: SourceDescriptor,
  records: readonly CollectionRecord[],
  query: SourceQueryDefinition,
  relations?: RelationResolver,
): Promise<SourceResult> {
  validateQueryCapabilities(source.capabilities, query);
  const root = collectionFromSchema(source.schema);
  const paths = uniquePaths(query);
  const values = new Map<string, Map<string, JsonValue | undefined>>();
  for (const path of paths) {
    const key = path.join("\0");
    if (path.length === 1) {
      const field = root.fields.find((item) => item.id === path[0]);
      if (!field) throw invalidQuery("Field path contains an unknown Field.");
      values.set(key, new Map(records.map((record) => [record.id, record.values[field.key]])));
    } else {
      if (!relations) throw unsupported("This Source does not support relationship traversal.");
      values.set(key, await relations.values(root, records, path));
    }
  }
  const valueAt = (record: CollectionRecord, path: readonly string[]) =>
    values.get(path.join("\0"))?.get(record.id);
  const filtered = query.filter
    ? records.filter((record) => evaluateFilter(query.filter!, (path) => valueAt(record, path)))
    : [...records];
  const sorted = stableSort(filtered, query, valueAt);
  const total = sorted.length;
  const offset = query.offset ?? 0;
  const paged = sorted.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
  const columns = columnsFor(source.schema, query, relations);
  return {
    source,
    columns,
    rows: paged.map((record) => ({
      id: record.id,
      values:
        query.select === undefined
          ? structuredClone(record.values)
          : Object.fromEntries(
              query.select.flatMap((selection) => {
                const value = valueAt(record, selection.path);
                return value === undefined ? [] : [[selection.as, structuredClone(value)]];
              }),
            ),
    })),
    total,
  };
}

function descriptor(
  key: string,
  label: string,
  kind: string,
  collection: CollectionDefinition,
  capabilities: SourceCapabilities,
): SourceDescriptor {
  return {
    key,
    label,
    kind,
    schema: structuredClone(collection),
    capabilities,
  };
}

function collectionFromSchema(schema: SourceSchema): CollectionDefinition {
  return schema;
}

function uniquePaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  const paths: readonly (readonly string[])[] = [
    ...filterPaths(query.filter),
    ...(query.sort?.map((item) => item.path) ?? []),
    ...(query.select?.map((item) => item.path) ?? []),
  ];
  return [...new Map(paths.map((path) => [path.join("\0"), path])).values()];
}

function filterPaths(filter: SourceFilter | undefined): readonly (readonly string[])[] {
  if (!filter) return [];
  if ("all" in filter) return filter.all.flatMap(filterPaths);
  if ("any" in filter) return filter.any.flatMap(filterPaths);
  if ("not" in filter) return filterPaths(filter.not);
  return [filter.path];
}

function evaluateFilter(
  filter: SourceFilter,
  valueAt: (path: readonly string[]) => JsonValue | undefined,
): boolean {
  if ("all" in filter) return filter.all.every((item) => evaluateFilter(item, valueAt));
  if ("any" in filter) return filter.any.some((item) => evaluateFilter(item, valueAt));
  if ("not" in filter) return !evaluateFilter(filter.not, valueAt);
  return compare(valueAt(filter.path), filter.operator, filter.value);
}

function compare(
  actual: JsonValue | undefined,
  operator: FieldOperator,
  expected?: JsonValue,
): boolean {
  if (
    Array.isArray(actual) &&
    operator !== "empty" &&
    operator !== "notEmpty" &&
    operator !== "contains"
  ) {
    return actual.some((item) => compare(item, operator, expected));
  }
  switch (operator) {
    case "eq":
      return JSON.stringify(actual) === JSON.stringify(expected);
    case "neq":
      return JSON.stringify(actual) !== JSON.stringify(expected);
    case "contains":
      return typeof actual === "string"
        ? actual.includes(scalarText(expected))
        : Array.isArray(actual) &&
            actual.some((item) => JSON.stringify(item) === JSON.stringify(expected));
    case "empty":
      return (
        actual === undefined ||
        actual === null ||
        actual === "" ||
        (Array.isArray(actual) && actual.length === 0)
      );
    case "notEmpty":
      return !compare(actual, "empty");
    case "gt":
      return comparable(actual) > comparable(expected);
    case "gte":
      return comparable(actual) >= comparable(expected);
    case "lt":
      return comparable(actual) < comparable(expected);
    case "lte":
      return comparable(actual) <= comparable(expected);
  }
}

function stableSort(
  records: readonly CollectionRecord[],
  query: SourceQueryDefinition,
  valueAt: (record: CollectionRecord, path: readonly string[]) => JsonValue | undefined,
): CollectionRecord[] {
  if (!query.sort?.length) return [...records];
  return records
    .map((record, index) => ({ record, index }))
    .sort((left, right) => {
      for (const sort of query.sort ?? []) {
        const comparison = compareOrder(
          valueAt(left.record, sort.path),
          valueAt(right.record, sort.path),
        );
        if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}

function columnsFor(
  schema: SourceSchema,
  query: SourceQueryDefinition,
  relations?: RelationResolver,
): SourceColumn[] {
  if (!query.select)
    return schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      fieldId: field.id,
      path: [field.id],
      type: field.type,
    }));
  return query.select.map((selection) => {
    const field =
      selection.path.length === 1
        ? fieldAtPath(schema, selection.path)
        : relations?.field(collectionFromSchema(schema), selection.path);
    if (!field) throw unsupported("This Source does not support relationship traversal.");
    return {
      key: selection.as,
      label: selection.label ?? field.label,
      fieldId: field.id,
      path: [...selection.path],
      type: field.type,
    };
  });
}

function fieldAtPath(schema: SourceSchema, path: readonly string[]): FieldDefinition {
  const field = schema.fields.find((item) => item.id === path[0]);
  if (!field) throw invalidQuery("Field path contains an unknown Field.");
  return field;
}

function validateQueryCapabilities(
  capabilities: SourceCapabilities,
  query: SourceQueryDefinition,
): void {
  if (query.filter && !capabilities.filter)
    throw unsupported("This Source does not support filtering.");
  if (query.sort?.length && !capabilities.sort)
    throw unsupported("This Source does not support sorting.");
  if ((query.offset !== undefined || query.limit !== undefined) && !capabilities.pagination)
    throw unsupported("This Source does not support pagination.");
  if (uniquePaths(query).some((path) => path.length > 1) && !capabilities.relations)
    throw unsupported("This Source does not support relationship traversal.");
}

function rejectRelationPaths(query: SourceQueryDefinition): void {
  if (uniquePaths(query).some((path) => path.length > 1))
    throw unsupported("Attached Sources do not expose related Collections implicitly.");
}

function referenceIds(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function row(record: CollectionRecord): SourceRow {
  return { id: record.id, values: structuredClone(record.values) };
}

function scalarText(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? `${value}`
    : "";
}

function comparable(value: JsonValue | undefined): number | string {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

function compareOrder(left: JsonValue | undefined, right: JsonValue | undefined): number {
  const a = comparable(Array.isArray(left) ? left[0] : left);
  const b = comparable(Array.isArray(right) ? right[0] : right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function invalidQuery(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}

function unsupported(message: string): FrameworkError {
  return new FrameworkError({ code: "SOURCE.CAPABILITY_UNSUPPORTED", message });
}
