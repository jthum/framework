import { FrameworkError } from "../errors/error.ts";
import type { CollectionRecord, RecordStore } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  FieldOperator,
  JsonValue,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ExecutionContext } from "./model.ts";
import type {
  SourceCapabilities,
  SourceColumn,
  SourceDescriptor,
  SourceResult,
  SourceSchema,
} from "./sources.ts";

interface RelationContext {
  readonly workspaceId: string;
  readonly collections: readonly CollectionDefinition[];
  readonly records: RecordStore;
  readonly context: ExecutionContext;
  readonly authorize: (request: AuthorizationRequest) => Promise<void>;
}

/** Pure query execution plus optional authorized local relationship resolution. */
export async function executeSourceQuery(
  source: SourceDescriptor,
  records: readonly CollectionRecord[],
  query: SourceQueryDefinition,
  relationContext?: RelationContext,
): Promise<SourceResult> {
  validateCapabilities(source.capabilities, query);
  const root = source.schema;
  const relations = relationContext ? new RelationResolver(relationContext) : undefined;
  const paths = uniquePaths(query);
  const values = new Map<string, Map<string, JsonValue | undefined>>();
  for (const path of paths) {
    const key = pathKey(path);
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
    values.get(pathKey(path))?.get(record.id);
  const filtered = query.filter
    ? records.filter((record) => evaluateFilter(query.filter!, (path) => valueAt(record, path)))
    : [...records];
  const sorted = stableSort(filtered, query, valueAt);
  const total = sorted.length;
  const offset = query.offset ?? 0;
  const paged = sorted.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
  return {
    source,
    columns: columnsFor(source.schema, query, relations),
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

class RelationResolver {
  private readonly cache = new Map<string, Promise<Map<string, JsonValue | undefined>>>();
  private readonly authorized = new Set<string>();

  constructor(private readonly relation: RelationContext) {}

  values(
    root: CollectionDefinition,
    rows: readonly CollectionRecord[],
    path: readonly string[],
  ): Promise<Map<string, JsonValue | undefined>> {
    const key = pathKey(path);
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
      const target = this.relation.collections.find((item) => item.id === field.collectionId);
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
      const target = this.relation.collections.find((item) => item.id === field.collectionId);
      if (!target) throw invalidQuery("Relationship target Collection is unavailable.");
      await this.authorizeTarget(target);
      plural ||= field.multiple === true;
      const ids = [
        ...new Set(
          [...nodes.values()].flatMap((items) =>
            items.flatMap((record) => referenceIds(record.values[field.key])),
          ),
        ),
      ];
      const related = await this.relation.records.getMany(this.relation.workspaceId, target, ids);
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
    await this.relation.authorize({
      context: this.relation.context,
      operation: "records.list",
      resource: {
        kind: "collection",
        id: collection.id,
        workspaceId: this.relation.workspaceId,
        collectionId: collection.id,
      },
    });
    this.authorized.add(collection.id);
  }
}

function columnsFor(
  schema: SourceSchema,
  query: SourceQueryDefinition,
  relations?: RelationResolver,
): SourceColumn[] {
  if (!query.select) {
    return schema.fields.map((field) => ({
      key: field.key,
      label: field.label,
      fieldId: field.id,
      path: [field.id],
      type: field.type,
    }));
  }
  return query.select.map((selection) => {
    const field =
      selection.path.length === 1
        ? rootField(schema, selection.path)
        : relations?.field(schema, selection.path);
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

function rootField(schema: SourceSchema, path: readonly string[]): FieldDefinition {
  const field = schema.fields.find((item) => item.id === path[0]);
  if (!field) throw invalidQuery("Field path contains an unknown Field.");
  return field;
}

function uniquePaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  const paths = [
    ...filterPaths(query.filter),
    ...(query.sort?.map((item) => item.path) ?? []),
    ...(query.select?.map((item) => item.path) ?? []),
  ];
  return [...new Map(paths.map((path) => [pathKey(path), path])).values()];
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

function validateCapabilities(
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

function referenceIds(value: JsonValue | undefined): string[] {
  if (typeof value === "string") return [value];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
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

function pathKey(path: readonly string[]): string {
  return path.join("\0");
}

function invalidQuery(message: string): FrameworkError {
  return new FrameworkError({ code: "VALIDATION.INVALID_INPUT", message });
}

function unsupported(message: string): FrameworkError {
  return new FrameworkError({ code: "SOURCE.CAPABILITY_UNSUPPORTED", message });
}
