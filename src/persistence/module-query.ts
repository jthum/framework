import { invalidInput, ERROR_CODES, FrameworkError } from "../errors/error.ts";
import type {
  EntityExpression,
  EntityField,
  EntityFilter,
  EntityQuery,
  ModuleCapability,
  ModuleSchema,
} from "./modules.ts";
import { assertEntityId, assertPath, entitySchema, validJson } from "./module-schema.ts";

export type QueryFields = Readonly<Record<string, EntityField>>;
export function fieldsForEntity(schema: ModuleSchema, entity: string): QueryFields {
  return {
    id: { type: "id" },
    workspaceId: { type: "text" },
    ...entitySchema(schema, entity).fields,
  };
}

export function fieldsForQuery(schema: ModuleSchema, query: EntityQuery): QueryFields {
  const fields = query.from
    ? fieldsForEntity(schema, query.from)
    : unionFields(schema, query.union!);
  if (!query.select && !query.aggregate) return fields;
  return Object.fromEntries([
    ...Object.entries(query.select ?? {}).map(([key, expression]) => [
      key,
      expressionType(schema, query, expression),
    ]),
    ...Object.entries(query.aggregate ?? {}).map(([key, aggregate]) => [
      key,
      aggregate.op === "count" || aggregate.op === "sum"
        ? { type: "number" }
        : expressionType(schema, query, aggregate.expression!),
    ]),
  ]);
}

function unionFields(schema: ModuleSchema, branches: readonly EntityQuery[]): QueryFields {
  const fields = branches.map((branch) => fieldsForQuery(schema, branch));
  return Object.fromEntries(
    Object.keys(fields[0]!).map((name) => {
      const concrete = fields
        .filter((_, index) => {
          const expression = branches[index]!.select?.[name];
          return !expression || !("value" in expression) || expression.value !== null;
        })
        .map((entry) => entry[name]!);
      return [
        name,
        concrete.find((entry) => entry.type === "id") ?? concrete[0] ?? fields[0]![name]!,
      ];
    }),
  );
}

export function expressionType(
  schema: ModuleSchema,
  query: EntityQuery,
  expression: EntityExpression,
): EntityField {
  if ("field" in expression) {
    assertPath(expression.field);
    let fields: QueryFields;
    if (expression.source === "traversal" && query.traverse)
      fields = { rootId: { type: "id" }, depth: { type: "number" } };
    else if (expression.source && expression.source !== "root") {
      const join = query.joins?.find((join) => join.as === expression.source);
      if (!join) throw invalidInput("Unknown query source.");
      fields = fieldsForEntity(schema, join.entity);
    } else
      fields = query.from ? fieldsForEntity(schema, query.from) : unionFields(schema, query.union!);
    const field = fields[expression.field];
    if (!field) throw invalidInput(`Unknown query field: ${expression.field}.`);
    return field;
  }
  if ("value" in expression) {
    if (!validJson(expression.value)) throw invalidInput("Query literals must be JSON values.");
    return {
      type:
        expression.value === null
          ? "json"
          : typeof expression.value === "string"
            ? "text"
            : typeof expression.value === "number"
              ? "number"
              : typeof expression.value === "boolean"
                ? "boolean"
                : "json",
      optional: expression.value === null,
    };
  }
  if ("coalesce" in expression) {
    if (!expression.coalesce.length) throw invalidInput("Coalesce needs at least one value.");
    const types = expression.coalesce
      .filter((value) => !("value" in value) || value.value !== null)
      .map((value) => expressionType(schema, query, value));
    return compatibleExpressionType(types);
  }
  if ("slice" in expression) {
    if (expressionType(schema, query, expression.slice).type !== "text")
      throw invalidInput("Slice requires a text expression.");
    if (!Number.isSafeInteger(expression.length) || expression.length < 0)
      throw invalidInput("Slice lengths must be non-negative integers.");
    return { type: "text" };
  }
  validateFilter(schema, query, expression.when);
  return compatibleExpressionType(
    [expression.thenValue, expression.elseValue]
      .filter((value) => !("value" in value) || value.value !== null)
      .map((value) => expressionType(schema, query, value)),
  );
}

function compatibleExpressionType(types: readonly EntityField[]): EntityField {
  if (!types.length) return { type: "json", optional: true };
  if (
    new Set(types.map((field) => field.type)).size > 1 &&
    !(
      types.some((field) => field.type === "id") &&
      types.every((field) => ["id", "text", "number"].includes(field.type))
    )
  )
    throw invalidInput("Expression branches require compatible types.");
  return types.find((field) => field.type === "id") ?? types[0]!;
}

function validateFilter(schema: ModuleSchema, query: EntityQuery, filter: EntityFilter): void {
  if (filter.op === "and" || filter.op === "or") {
    for (const condition of filter.conditions) validateFilter(schema, query, condition);
    return;
  }
  if (filter.op === "not") {
    validateFilter(schema, query, filter.condition);
    return;
  }
  if (filter.op === "in") {
    if (!filter.values.every(validJson)) throw invalidInput("Membership values must be JSON.");
    for (const value of filter.values)
      validateComparison(schema, query, filter.expression, { value });
    return;
  }
  validateComparison(schema, query, filter.left, filter.right);
}

function validateComparison(
  schema: ModuleSchema,
  query: EntityQuery,
  left: EntityExpression,
  right: EntityExpression,
): void {
  const a = expressionType(schema, query, left),
    b = expressionType(schema, query, right);
  if (("value" in left && left.value === null) || ("value" in right && right.value === null))
    return;
  if (a.type === "json" || b.type === "json")
    throw invalidInput("Opaque JSON fields support null checks, not scalar comparisons.");
  if (
    a.type === b.type ||
    (a.type === "id" && ["text", "number"].includes(b.type)) ||
    (b.type === "id" && ["text", "number"].includes(a.type))
  )
    return;
  throw invalidInput("Query comparisons require compatible scalar types.");
}

export function validateEntityQuery(
  schema: ModuleSchema,
  query: EntityQuery,
  capabilities: readonly ModuleCapability[],
): void {
  const need = (capability: ModuleCapability): void => {
    if (!capabilities.includes(capability))
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: `This provider does not support ${capability}.`,
      });
  };
  if ((query.from === undefined) === (query.union === undefined))
    throw invalidInput("A query needs exactly one entity or union.");
  if (query.from !== undefined) entitySchema(schema, query.from);
  if (query.union) {
    need("unions");
    if (!query.union.length) throw invalidInput("A union needs at least one query.");
    for (const branch of query.union) validateEntityQuery(schema, branch, capabilities);
    const names = Object.keys(fieldsForQuery(schema, query.union[0]!)).sort().join("\0");
    if (
      query.union.some(
        (branch) => Object.keys(fieldsForQuery(schema, branch)).sort().join("\0") !== names,
      )
    )
      throw invalidInput("Union branches must expose matching fields.");
    const fields = query.union.map((branch) => fieldsForQuery(schema, branch));
    for (const name of Object.keys(fields[0]!)) {
      const types = fields.flatMap((field, index) => {
        const value = query.union![index]!.select?.[name];
        return value && "value" in value && value.value === null ? [] : [field[name]!.type];
      });
      if (
        new Set(types).size > 1 &&
        !(types.includes("id") && types.every((type) => ["id", "text", "number"].includes(type)))
      )
        throw invalidInput("Union projections must have compatible types.");
    }
    if (query.joins?.length || query.traverse || query.latestBy || query.sample)
      throw invalidInput("Join, traversal, latest and sampling queries require an entity root.");
  }
  for (const value of [query.limit, query.offset])
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      throw invalidInput("Query bounds must be non-negative integers.");
  const sources = new Set(["root", "traversal"]);
  for (const join of query.joins ?? []) {
    need("joins");
    assertPath(join.as);
    entitySchema(schema, join.entity);
    if (sources.has(join.as)) throw invalidInput("Query aliases must be distinct.");
    sources.add(join.as);
    validateFilter(schema, query, join.on);
  }
  if (query.where) validateFilter(schema, query, query.where);
  const names = [...Object.keys(query.select ?? {}), ...Object.keys(query.aggregate ?? {})];
  if ((query.select || query.aggregate) && !names.length)
    throw invalidInput("Explicit projections must expose at least one field.");
  if (
    new Set(names).size !== names.length ||
    names.some((name) => names.some((other) => other !== name && other.startsWith(`${name}.`)))
  )
    throw invalidInput("Projection paths must be distinct and cannot overlap.");
  for (const expression of Object.values(query.select ?? {}))
    expressionType(schema, query, expression);
  for (const name of names) assertPath(name);
  for (const order of query.orderBy ?? []) {
    if (order.direction !== undefined && !["asc", "desc"].includes(order.direction))
      throw invalidInput("Invalid query ordering.");
    if (expressionType(schema, query, order.expression).type === "json")
      throw invalidInput("Ordering requires scalar fields.");
  }
  for (const group of query.groupBy ?? [])
    if (expressionType(schema, query, group).type === "json")
      throw invalidInput("Grouping requires scalar expressions.");
  for (const aggregate of Object.values(query.aggregate ?? {})) {
    need("aggregates");
    if (aggregate.op !== "count" && !aggregate.expression)
      throw invalidInput("An aggregate needs an expression.");
    if (aggregate.expression) {
      const type = expressionType(schema, query, aggregate.expression).type;
      if (type === "json" || (aggregate.op === "sum" && type !== "number"))
        throw invalidInput("Aggregates require scalar expressions; sums require numbers.");
    }
    if (aggregate.where) validateFilter(schema, query, aggregate.where);
  }
  if (query.aggregate || query.groupBy) {
    need("aggregates");
    if (!query.select && query.groupBy?.length)
      throw invalidInput("Grouped queries need an explicit projection.");
    const groups = new Set((query.groupBy ?? []).map((group) => JSON.stringify(group)));
    if (
      Object.values(query.select ?? {}).some(
        (expression) => !("value" in expression) && !groups.has(JSON.stringify(expression)),
      )
    )
      throw invalidInput("Non-aggregate projections must appear in the grouping.");
    if (query.orderBy?.some((order) => !groups.has(JSON.stringify(order.expression))))
      throw invalidInput("Grouped ordering must use grouping expressions.");
  }
  if (query.latestBy) {
    need("latest");
    if (
      !query.latestBy.length ||
      !query.orderBy?.length ||
      query.aggregate ||
      query.groupBy ||
      query.traverse ||
      query.joins?.length
    )
      throw invalidInput(
        "Latest-per-group requires an ordered entity query without joins, traversal or aggregates.",
      );
    for (const field of query.latestBy)
      if (expressionType(schema, query, { field }).type === "json")
        throw invalidInput("Latest groups require scalar fields.");
  }
  if (
    query.limitPerGroup !== undefined &&
    (!query.latestBy || !Number.isSafeInteger(query.limitPerGroup) || query.limitPerGroup < 1)
  )
    throw invalidInput("Per-group limits require a grouped latest query and a positive integer.");
  if (query.traverse) {
    need("traversal");
    const field = entitySchema(schema, query.from!).fields[query.traverse.parentField];
    if (!field || field.type !== "id" || field.references?.entity !== query.from)
      throw invalidInput("Traversal requires a declared self-reference.");
    for (const root of query.traverse.roots) assertEntityId(root);
    if (!["ancestors", "descendants"].includes(query.traverse.direction))
      throw invalidInput("Unknown traversal direction.");
  }
  if (query.sample !== undefined) {
    need("sampling");
    if (
      !Number.isSafeInteger(query.sample) ||
      query.sample < 2 ||
      !query.orderBy?.length ||
      query.aggregate ||
      query.groupBy ||
      query.latestBy ||
      query.traverse ||
      query.joins?.length ||
      query.limit !== undefined ||
      query.offset !== undefined
    )
      throw invalidInput("Sampling needs a plain ordered entity query and at least two samples.");
    if (
      Object.keys(fieldsForQuery(schema, query)).some((key) =>
        ["ordinal", "total"].includes(key.split(".")[0]!),
      )
    )
      throw invalidInput("Sampling reserves ordinal and total output fields.");
  }
}
