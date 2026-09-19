import { FrameworkError } from "../errors/error.ts";
import type { RecordQueryResult } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  FieldOperator,
  JsonValue,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";
import type { SqliteDatabase } from "./gateway.ts";

type Row = Record<string, null | number | string | Uint8Array>;

/** Execute root-Field queries inside SQLite; no Collection rows cross into JavaScript first. */
export async function querySqliteRecords(
  database: SqliteDatabase,
  table: string,
  collection: CollectionDefinition,
  query: SourceQueryDefinition,
  options: {
    readonly tableExpression?: string;
    readonly parameters?: readonly (null | number | string | Uint8Array)[];
  } = {},
): Promise<RecordQueryResult> {
  const parameters: Array<null | number | string | Uint8Array> = [...(options.parameters ?? [])];
  const where = query.filter ? compileFilter(query.filter, collection, parameters) : "1 = 1";
  const quoted = options.tableExpression ?? quote(table);
  if (query.aggregate) return aggregate(database, quoted, collection, query, where, parameters);

  const count = await database.get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM ${quoted} WHERE ${where}`,
    parameters,
  );
  const order = query.sort?.length
    ? query.sort
        .map(
          (sort) =>
            `${sortExpression(field(collection, sort.path))} ${sort.direction.toUpperCase()}`,
        )
        .join(", ") + ', "_created_at" ASC, "_id" ASC'
    : '"_created_at" ASC, "_id" ASC';
  const paging = page(query, parameters);
  const rows = await database.all<Row>(
    `SELECT * FROM ${quoted} WHERE ${where} ORDER BY ${order}${paging}`,
    parameters,
  );
  return {
    total: count?.total ?? 0,
    rows: rows.map((row) => ({
      id: String(row._id),
      values: query.select
        ? Object.fromEntries(
            query.select.flatMap((selection) => {
              const value = readField(row, field(collection, selection.path));
              return value === undefined ? [] : [[selection.as, value]];
            }),
          )
        : Object.fromEntries(
            collection.fields.flatMap((definition) => {
              const value = readField(row, definition);
              return value === undefined ? [] : [[definition.key, value]];
            }),
          ),
    })),
  };
}

async function aggregate(
  database: SqliteDatabase,
  table: string,
  collection: CollectionDefinition,
  query: SourceQueryDefinition,
  where: string,
  parameters: Array<null | number | string | Uint8Array>,
): Promise<RecordQueryResult> {
  const definition = query.aggregate!;
  const groupField = field(collection, definition.group.path);
  const identity = valueExpression(groupField);
  const groupKey = quote(fieldColumn(groupField));
  const label = definition.group.labelPath
    ? valueExpression(field(collection, definition.group.labelPath))
    : identity;
  const measures = definition.measures.map((measure, index) => {
    if (measure.operation === "count") return `COUNT(*) AS ${quote(`_measure_${index}`)}`;
    const expression = measure.paths?.length
      ? `(${measure.paths.map((path) => numericExpression(field(collection, path))).join(" + ")}) / ${measure.paths.length}`
      : numericExpression(field(collection, measure.path ?? []));
    const fn = measure.operation.toUpperCase();
    return `${fn}(${expression}) AS ${quote(`_measure_${index}`)}`;
  });
  const grouped = `SELECT ${identity} AS "_identity", MIN(${label}) AS "_label", ${measures.join(", ")} FROM ${table} WHERE ${where} GROUP BY ${groupKey}`;
  const count = await database.get<{ total: number }>(
    `SELECT COUNT(*) AS total FROM (${grouped})`,
    parameters,
  );
  const order = definition.sort?.length
    ? definition.sort
        .map((sort) => {
          const index = definition.measures.findIndex((measure) => measure.as === sort.key);
          const column = index < 0 ? '"_label"' : quote(`_measure_${index}`);
          return `${column} ${sort.direction.toUpperCase()}`;
        })
        .join(", ") + ', "_identity" ASC'
    : '"_identity" ASC';
  const pagingParameters = [...parameters];
  const rows = await database.all<Row>(
    `SELECT * FROM (${grouped}) ORDER BY ${order}${page(query, pagingParameters)}`,
    pagingParameters,
  );
  return {
    total: count?.total ?? 0,
    rows: rows.map((row) => {
      const identityValue = row._identity;
      const identityId =
        typeof identityValue === "string" ? identityValue : JSON.stringify(identityValue ?? null);
      const values: Record<string, JsonValue> = {
        [definition.group.as]: (row._label ?? null) as JsonValue,
      };
      for (const [index, measure] of definition.measures.entries())
        values[measure.as] = (row[`_measure_${index}`] ?? null) as JsonValue;
      return { id: identityId, values };
    }),
  };
}

export function compileFilter(
  filter: SourceFilter,
  collection: CollectionDefinition,
  parameters: Array<null | number | string | Uint8Array>,
  qualifier = "",
): string {
  if ("all" in filter)
    return filter.all.length
      ? `(${filter.all.map((item) => compileFilter(item, collection, parameters, qualifier)).join(" AND ")})`
      : "1 = 1";
  if ("any" in filter)
    return filter.any.length
      ? `(${filter.any.map((item) => compileFilter(item, collection, parameters, qualifier)).join(" OR ")})`
      : "1 = 0";
  if ("not" in filter)
    return `NOT (${compileFilter(filter.not, collection, parameters, qualifier)})`;
  const definition = field(collection, filter.path);
  const column = `${qualifier}${quote(fieldColumn(definition))}`;
  if (filter.operator === "empty")
    return `(${column} IS NULL OR ${column} IN ('null', '""', '[]'))`;
  if (filter.operator === "notEmpty")
    return `(${column} IS NOT NULL AND ${column} NOT IN ('null', '""', '[]'))`;

  const expected = filter.value === undefined ? undefined : JSON.stringify(filter.value);
  if (filter.operator === "eq" || filter.operator === "neq") {
    if (expected === undefined)
      return filter.operator === "eq" ? `${column} IS NULL` : `${column} IS NOT NULL`;
    if (filter.value === null) {
      const comparison = filter.operator === "eq" ? "IS" : "IS NOT";
      const scalar =
        filter.operator === "eq"
          ? `${column} = 'null'`
          : `(${column} <> 'null' OR ${column} IS NULL)`;
      return `(CASE WHEN json_type(${column}) = 'array' THEN EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value ${comparison} NULL) ELSE ${scalar} END)`;
    }
    parameters.push(expected, expected);
    const scalar =
      filter.operator === "eq"
        ? `COALESCE(${column} = ?, 0)`
        : `(${column} <> ? OR ${column} IS NULL)`;
    const array = `EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value ${filter.operator === "eq" ? "IS" : "IS NOT"} json_extract(?, '$'))`;
    return `(CASE WHEN json_type(${column}) = 'array' THEN ${array} ELSE ${scalar} END)`;
  }
  if (filter.operator === "contains") {
    const value = filter.value;
    const text =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";
    parameters.push(text, expected ?? null);
    return `(CASE json_type(${column}) WHEN 'text' THEN COALESCE(instr(json_extract(${column}, '$'), ?) > 0, 0) WHEN 'array' THEN EXISTS (SELECT 1 FROM json_each(${column}) WHERE json_each.value IS json_extract(?, '$')) ELSE 0 END)`;
  }
  const comparator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[
    filter.operator as Exclude<FieldOperator, "eq" | "neq" | "contains" | "empty" | "notEmpty">
  ];
  const actual =
    definition.type === "number"
      ? `COALESCE(${valueExpression(definition, qualifier)}, 0)`
      : `COALESCE(${valueExpression(definition, qualifier)}, '')`;
  const value = filter.value;
  parameters.push(typeof value === "number" || typeof value === "string" ? value : "");
  return `${actual} ${comparator} ?`;
}

function page(
  query: SourceQueryDefinition,
  parameters: Array<null | number | string | Uint8Array>,
): string {
  if (query.limit !== undefined) {
    parameters.push(query.limit, query.offset ?? 0);
    return " LIMIT ? OFFSET ?";
  }
  if (query.offset !== undefined) {
    parameters.push(query.offset);
    return " LIMIT -1 OFFSET ?";
  }
  return "";
}

function field(collection: CollectionDefinition, path: readonly string[]): FieldDefinition {
  if (path.length !== 1)
    throw new FrameworkError({
      code: "SOURCE.CAPABILITY_UNSUPPORTED",
      message: "SQLite query pushdown for relationship paths is not available.",
    });
  const definition = collection.fields.find((item) => item.id === path[0]);
  if (!definition)
    throw new FrameworkError({
      code: "VALIDATION.INVALID_INPUT",
      message: "Field path contains an unknown Field.",
    });
  return definition;
}

function valueExpression(definition: FieldDefinition, qualifier = ""): string {
  return `json_extract(${qualifier}${quote(fieldColumn(definition))}, '$')`;
}

function sortExpression(definition: FieldDefinition): string {
  const column = quote(fieldColumn(definition));
  const value = `CASE WHEN json_type(${column}) = 'array' THEN json_extract(${column}, '$[0]') ELSE ${valueExpression(definition)} END`;
  return `COALESCE(${definition.type === "number" ? value : `CASE WHEN json_type(${column}) IN ('true', 'false', 'object') THEN '' ELSE ${value} END`}, ${definition.type === "number" ? "0" : "''"})`;
}

function numericExpression(definition: FieldDefinition): string {
  const value = valueExpression(definition);
  return `CASE WHEN json_type(${quote(fieldColumn(definition))}) IN ('integer', 'real') THEN ${value} ELSE NULL END`;
}

function readField(row: Row, definition: FieldDefinition): JsonValue | undefined {
  const value = row[fieldColumn(definition)];
  return typeof value === "string" ? (JSON.parse(value) as JsonValue) : undefined;
}

function fieldColumn(field: FieldDefinition): string {
  return `_field_${[...new TextEncoder().encode(field.id)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
