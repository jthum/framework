import { FrameworkError } from "../errors/error.ts";
import type { RecordQueryRelation, RecordQueryResult } from "../persistence/records.ts";
import type {
  CollectionDefinition,
  FieldDefinition,
  SourceFilter,
  SourceQueryDefinition,
} from "../spec/model.ts";
import type { SqliteDatabase, SqliteValue } from "./gateway.ts";
import { compileFilter, querySqliteRecords } from "./record-query.ts";

export interface PhysicalQueryRelation extends RecordQueryRelation {
  readonly table: string;
  readonly schema?: string;
}

/** Project declared relationship paths inside SQLite, then reuse the ordinary query compiler. */
export async function queryRelatedSqliteRecords(
  database: SqliteDatabase,
  rootTable: string,
  root: CollectionDefinition,
  query: SourceQueryDefinition,
  relations: readonly PhysicalQueryRelation[],
): Promise<RecordQueryResult> {
  const paths = [
    ...new Map(
      allPaths(query)
        .filter((path) => path.length > 1)
        .map((path) => [key(path), path]),
    ).values(),
  ];
  const parameters: SqliteValue[] = [];
  const synthetic = paths.map((path, index) => {
    const id = uniqueFieldId(root, index);
    const target = relations.find((relation) => key(relation.path) === key(path.slice(0, -1)));
    const terminal = target?.collection.fields.find((field) => field.id === path.at(-1));
    if (!terminal) throw invalidPath();
    const field: FieldDefinition = { ...terminal, id, key: id };
    return { path, field, expression: relationExpression(root, path, relations, parameters) };
  });
  const byPath = new Map(synthetic.map((item) => [key(item.path), item.field.id]));
  const rewrite = (path: readonly string[]) => {
    if (path.length === 1) return path;
    const id = byPath.get(key(path));
    if (!id) throw invalidPath();
    return [id];
  };
  const rewritten: SourceQueryDefinition = {
    ...query,
    ...(query.filter ? { filter: rewriteFilter(query.filter, rewrite) } : {}),
    ...(query.sort
      ? { sort: query.sort.map((sort) => ({ ...sort, path: rewrite(sort.path) })) }
      : {}),
    ...(query.select
      ? { select: query.select.map((item) => ({ ...item, path: rewrite(item.path) })) }
      : {}),
    ...(query.aggregate
      ? {
          aggregate: {
            ...query.aggregate,
            group: {
              ...query.aggregate.group,
              path: rewrite(query.aggregate.group.path),
              ...(query.aggregate.group.labelPath
                ? { labelPath: rewrite(query.aggregate.group.labelPath) }
                : {}),
            },
            measures: query.aggregate.measures.map((measure) => ({
              ...measure,
              ...(measure.path ? { path: rewrite(measure.path) } : {}),
              ...(measure.paths ? { paths: measure.paths.map(rewrite) } : {}),
            })),
          },
        }
      : {}),
  };
  const projected = `SELECT root.*, ${synthetic.map((item) => `${item.expression} AS ${quote(fieldColumn(item.field))}`).join(", ")} FROM ${quote(rootTable)} AS root`;
  const result = await querySqliteRecords(
    database,
    rootTable,
    { ...root, fields: [...root.fields, ...synthetic.map((item) => item.field)] },
    rewritten,
    { tableExpression: `(${projected})`, parameters },
  );
  if (query.select || query.aggregate) return result;
  return {
    ...result,
    rows: result.rows.map((row) => ({
      id: row.id,
      values: Object.fromEntries(
        root.fields.flatMap((field) => {
          const value = row.values[field.key];
          return value === undefined ? [] : [[field.key, value]];
        }),
      ),
    })),
  };
}

function relationExpression(
  root: CollectionDefinition,
  path: readonly string[],
  relations: readonly PhysicalQueryRelation[],
  parameters: SqliteValue[],
): string {
  let current = root;
  let previousAlias = "root";
  let from = "";
  let plural = false;
  const conditions: string[] = [];
  const order: string[] = [];
  for (let index = 0; index < path.length - 1; index += 1) {
    const prefix = path.slice(0, index + 1);
    const reference = current.fields.find((field) => field.id === path[index]);
    const relation = relations.find((item) => key(item.path) === key(prefix));
    if (!reference || reference.type !== "reference" || !relation) throw invalidPath();
    const alias = `r${index}`;
    const table = `${relation.schema ? `${quote(relation.schema)}.` : ""}${quote(relation.table)}`;
    const referenceColumn = `${previousAlias}.${quote(fieldColumn(reference))}`;
    if (reference.multiple) {
      plural = true;
      const jsonAlias = `j${index}`;
      const each = `json_each(${referenceColumn}) AS ${jsonAlias}`;
      from += from ? ` JOIN ${each} ON 1 = 1` : ` FROM ${each}`;
      from += ` JOIN ${table} AS ${alias} ON ${alias}."_id" = ${jsonAlias}.value`;
      order.push(`${jsonAlias}.key`);
    } else {
      from += from
        ? ` JOIN ${table} AS ${alias} ON json_extract(${referenceColumn}, '$') = ${alias}."_id"`
        : ` FROM ${table} AS ${alias}`;
      if (index === 0) conditions.push(`json_extract(${referenceColumn}, '$') = ${alias}."_id"`);
    }
    if (relation.filter)
      conditions.push(compileFilter(relation.filter, relation.collection, parameters, `${alias}.`));
    current = relation.collection;
    previousAlias = alias;
  }
  const terminal = current.fields.find((field) => field.id === path.at(-1));
  if (!terminal) throw invalidPath();
  const value = `${previousAlias}.${quote(fieldColumn(terminal))}`;
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  if (!plural) return `(SELECT ${value}${from}${where} LIMIT 1)`;
  const flattened = `json_each(CASE WHEN json_type(${value}) = 'array' THEN ${value} ELSE json_array(json(${value})) END) AS terminal`;
  const ordered = `SELECT CASE WHEN terminal.type IN ('array', 'object') THEN json(terminal.value) ELSE json_quote(terminal.value) END AS "_value"${from} JOIN ${flattened} ON 1 = 1 WHERE ${[...conditions, `${value} IS NOT NULL`].join(" AND ")} ORDER BY ${[...order, "terminal.key"].join(", ")}`;
  return `COALESCE((SELECT json_group_array(json("_value")) FROM (${ordered})), '[]')`;
}

function rewriteFilter(
  filter: SourceFilter,
  rewrite: (path: readonly string[]) => readonly string[],
): SourceFilter {
  if ("all" in filter) return { all: filter.all.map((item) => rewriteFilter(item, rewrite)) };
  if ("any" in filter) return { any: filter.any.map((item) => rewriteFilter(item, rewrite)) };
  if ("not" in filter) return { not: rewriteFilter(filter.not, rewrite) };
  return { ...filter, path: rewrite(filter.path) };
}

function allPaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  const filterPaths = (filter: SourceFilter | undefined): readonly (readonly string[])[] => {
    if (!filter) return [];
    if ("all" in filter) return filter.all.flatMap(filterPaths);
    if ("any" in filter) return filter.any.flatMap(filterPaths);
    if ("not" in filter) return filterPaths(filter.not);
    return [filter.path];
  };
  return [
    ...filterPaths(query.filter),
    ...(query.sort?.map((item) => item.path) ?? []),
    ...(query.select?.map((item) => item.path) ?? []),
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

function uniqueFieldId(collection: CollectionDefinition, index: number): string {
  let id = `__relation_${index}`;
  while (collection.fields.some((field) => field.id === id || field.key === id)) id += "_";
  return id;
}

function key(path: readonly string[]): string {
  return path.join("\0");
}

function fieldColumn(field: FieldDefinition): string {
  return `_field_${[...new TextEncoder().encode(field.id)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function invalidPath(): FrameworkError {
  return new FrameworkError({
    code: "VALIDATION.INVALID_INPUT",
    message: "Relationship path contains an unknown Field or Source.",
  });
}
