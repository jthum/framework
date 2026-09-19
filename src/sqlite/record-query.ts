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
import { decodeField, encodeField, explicitNulls, isStructuredField } from "./field-storage.ts";

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
    readonly nullColumns?: Readonly<Record<string, string>>;
  } = {},
): Promise<RecordQueryResult> {
  const parameters: Array<null | number | string | Uint8Array> = [...(options.parameters ?? [])];
  const where = query.filter
    ? compileFilter(query.filter, collection, parameters, "", options.nullColumns)
    : "1 = 1";
  const quoted = options.tableExpression ?? quote(table);
  if (query.aggregate)
    return aggregate(database, quoted, collection, query, where, parameters, options.nullColumns);

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
    rows: rows.map((row) => {
      const nulls = explicitNulls(row._null_fields);
      return {
        id: String(row._id),
        values: query.select
          ? Object.fromEntries(
              query.select.flatMap((selection) => {
                const value = readField(
                  row,
                  field(collection, selection.path),
                  options.nullColumns,
                  nulls,
                );
                return value === undefined ? [] : [[selection.as, value]];
              }),
            )
          : Object.fromEntries(
              collection.fields.flatMap((definition) => {
                const value = readField(row, definition, options.nullColumns, nulls);
                return value === undefined ? [] : [[definition.key, value]];
              }),
            ),
      };
    }),
  };
}

async function aggregate(
  database: SqliteDatabase,
  table: string,
  collection: CollectionDefinition,
  query: SourceQueryDefinition,
  where: string,
  parameters: Array<null | number | string | Uint8Array>,
  nullColumns?: Readonly<Record<string, string>>,
): Promise<RecordQueryResult> {
  const definition = query.aggregate!;
  const groupField = field(collection, definition.group.path);
  const identity = valueExpression(groupField);
  const groupKey = quote(fieldColumn(groupField));
  const label = definition.group.labelPath
    ? valueExpression(field(collection, definition.group.labelPath))
    : identity;
  const syntheticNull = nullColumns?.[groupField.id];
  if (!syntheticNull) parameters.push(groupField.id);
  const nullGroup = syntheticNull
    ? `COALESCE(${quote(syntheticNull)}, 0)`
    : `CASE WHEN ${groupKey} IS NULL THEN EXISTS (SELECT 1 FROM json_each("_null_fields") WHERE json_each.value = ?) ELSE 0 END`;
  const measures = definition.measures.map((measure, index) => {
    if (measure.operation === "count") return `COUNT(*) AS ${quote(`_measure_${index}`)}`;
    const expression = measure.paths?.length
      ? `(${measure.paths.map((path) => numericExpression(field(collection, path))).join(" + ")}) / ${measure.paths.length}`
      : numericExpression(field(collection, measure.path ?? []));
    const fn = measure.operation.toUpperCase();
    return `${fn}(${expression}) AS ${quote(`_measure_${index}`)}`;
  });
  const grouped = `SELECT ${identity} AS "_identity", MIN(${label}) AS "_label", ${measures.join(", ")} FROM ${table} WHERE ${where} GROUP BY ${groupKey}, ${nullGroup}`;
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
  nullColumns?: Readonly<Record<string, string>>,
): string {
  if ("all" in filter)
    return filter.all.length
      ? `(${filter.all.map((item) => compileFilter(item, collection, parameters, qualifier, nullColumns)).join(" AND ")})`
      : "1 = 1";
  if ("any" in filter)
    return filter.any.length
      ? `(${filter.any.map((item) => compileFilter(item, collection, parameters, qualifier, nullColumns)).join(" OR ")})`
      : "1 = 0";
  if ("not" in filter)
    return `NOT COALESCE((${compileFilter(filter.not, collection, parameters, qualifier, nullColumns)}), 0)`;
  const definition = field(collection, filter.path);
  const column = `${qualifier}${quote(fieldColumn(definition))}`;
  const textLike =
    definition.type === "text" ||
    definition.type === "date" ||
    definition.type === "datetime" ||
    definition.type === "choice" ||
    definition.type === "reference";
  if (filter.operator === "empty")
    return isStructuredField(definition)
      ? `(${column} IS NULL OR ${column} IN ('""', '[]'))`
      : `(${column} IS NULL OR ${textLike ? `${column} = ''` : "0 = 1"})`;
  if (filter.operator === "notEmpty")
    return isStructuredField(definition)
      ? `(${column} IS NOT NULL AND ${column} NOT IN ('""', '[]'))`
      : `(${column} IS NOT NULL AND ${textLike ? `${column} <> ''` : "1 = 1"})`;

  const structured = isStructuredField(definition);
  if (
    (filter.operator === "eq" || filter.operator === "neq") &&
    filter.value !== undefined &&
    filter.value !== null &&
    !structured
  ) {
    const type =
      definition.type === "number"
        ? "number"
        : definition.type === "boolean"
          ? "boolean"
          : "string";
    if (typeof filter.value !== type) return filter.operator === "eq" ? "0 = 1" : "1 = 1";
  }
  const expected = filter.value === undefined ? undefined : encodeField(definition, filter.value);
  if (filter.operator === "eq" || filter.operator === "neq") {
    const arrayComparison = structured && expected !== undefined;
    if (arrayComparison) {
      const value = filter.value;
      parameters.push(
        value === null
          ? null
          : typeof value === "boolean"
            ? value
              ? 1
              : 0
            : typeof value === "string" || typeof value === "number"
              ? value
              : (expected ?? null),
      );
    }
    let match: string;
    if (expected === undefined || filter.value === null) {
      const syntheticNull = nullColumns?.[definition.id];
      if (!syntheticNull) parameters.push(definition.id);
      const present = syntheticNull
        ? `COALESCE(${qualifier}${quote(syntheticNull)}, 0) = 1`
        : `EXISTS (SELECT 1 FROM json_each(${qualifier}${quote("_null_fields")}) WHERE json_each.value = ?)`;
      match =
        expected === undefined
          ? `(${column} IS NULL AND NOT ${present})`
          : `(${column} IS NULL AND ${present})`;
    } else if (structured) {
      parameters.push(expected);
      match = `${column} = ?`;
    } else {
      parameters.push(expected);
      match = `${column} = ?`;
    }
    const scalar =
      !structured && expected !== undefined && filter.value !== null
        ? filter.operator === "eq"
          ? match
          : `(${column} <> ? OR ${column} IS NULL)`
        : filter.operator === "eq"
          ? `COALESCE(${match}, 0)`
          : `NOT COALESCE(${match}, 0)`;
    const elementMatch = jsonElementMatch(filter.value);
    return arrayComparison
      ? `(CASE WHEN json_type(${column}) = 'array' THEN EXISTS (SELECT 1 FROM json_each(${column}) WHERE ${filter.operator === "eq" ? elementMatch : `NOT ${elementMatch}`}) ELSE ${scalar} END)`
      : scalar;
  }
  if (filter.operator === "contains") {
    const value = filter.value;
    const text =
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";
    if (!structured) {
      if (!textLike) return "0 = 1";
      parameters.push(text);
      return `COALESCE(instr(${column}, ?) > 0, 0)`;
    }
    parameters.push(text);
    if (value !== undefined)
      parameters.push(
        typeof value === "boolean"
          ? value
            ? 1
            : 0
          : typeof value === "string" || typeof value === "number"
            ? value
            : (expected ?? null),
      );
    return `(CASE json_type(${column}) WHEN 'text' THEN COALESCE(instr(json_extract(${column}, '$'), ?) > 0, 0) WHEN 'array' THEN EXISTS (SELECT 1 FROM json_each(${column}) WHERE ${jsonElementMatch(value)}) ELSE 0 END)`;
  }
  const comparator = { gt: ">", gte: ">=", lt: "<", lte: "<=" }[
    filter.operator as Exclude<FieldOperator, "eq" | "neq" | "contains" | "empty" | "notEmpty">
  ];
  const actual =
    definition.type === "boolean"
      ? "''"
      : definition.type === "number"
        ? `COALESCE(${valueExpression(definition, qualifier)}, 0)`
        : `COALESCE(${valueExpression(definition, qualifier)}, '')`;
  const value = filter.value;
  parameters.push(
    typeof value === "number" || typeof value === "string"
      ? definition.type === "datetime" && typeof value === "string"
        ? new Date(value).toISOString()
        : value
      : "",
  );
  return `${actual} ${comparator} ?`;
}

function jsonElementMatch(value: JsonValue | undefined): string {
  if (value === undefined) return "0 = 1";
  const type =
    value === null
      ? "json_each.type = 'null'"
      : typeof value === "boolean"
        ? `json_each.type = '${value ? "true" : "false"}'`
        : typeof value === "number"
          ? "json_each.type IN ('integer', 'real')"
          : typeof value === "string"
            ? "json_each.type = 'text'"
            : Array.isArray(value)
              ? "json_each.type = 'array'"
              : "json_each.type = 'object'";
  return `(${type} AND json_each.value IS ?)`;
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
  const column = `${qualifier}${quote(fieldColumn(definition))}`;
  return isStructuredField(definition) ? `json_extract(${column}, '$')` : column;
}

function sortExpression(definition: FieldDefinition): string {
  const column = quote(fieldColumn(definition));
  // The portable evaluator sorts numeric NULL/unset as zero (between negatives
  // and positives) and text NULL/unset as the empty string. SQLite's native
  // NULLS FIRST/LAST cannot place them there while preserving ties, so keep
  // COALESCE until a workload justifies a matching expression index.
  if (definition.type === "number") return `COALESCE(${column}, 0)`;
  if (definition.type === "boolean") return "''";
  if (!isStructuredField(definition)) return `COALESCE(${column}, '')`;
  const value = `CASE WHEN json_type(${column}) = 'array' THEN json_extract(${column}, '$[0]') ELSE ${valueExpression(definition)} END`;
  return `COALESCE(CASE WHEN json_type(${column}) IN ('true', 'false', 'object') THEN '' ELSE ${value} END, '')`;
}

function numericExpression(definition: FieldDefinition): string {
  if (definition.type === "number") return quote(fieldColumn(definition));
  const column = quote(fieldColumn(definition));
  return isStructuredField(definition)
    ? `CASE WHEN json_type(${column}) IN ('integer', 'real') THEN json_extract(${column}, '$') ELSE NULL END`
    : "NULL";
}

function readField(
  row: Row,
  definition: FieldDefinition,
  nullColumns: Readonly<Record<string, string>> | undefined,
  nulls: ReadonlySet<string>,
): JsonValue | undefined {
  const value = row[fieldColumn(definition)];
  const syntheticNull = nullColumns?.[definition.id];
  return decodeField(
    definition,
    value,
    syntheticNull ? row[syntheticNull] === 1 : nulls.has(definition.id),
  );
}

function fieldColumn(field: FieldDefinition): string {
  return `_field_${[...new TextEncoder().encode(field.id)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
