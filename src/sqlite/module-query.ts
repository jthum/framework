import type {
  EntityAggregate,
  EntityExpression,
  EntityFilter,
  EntityQuery,
  ModuleSchema,
} from "../persistence/modules.ts";
import { expressionType, fieldsForQuery, type QueryFields } from "../persistence/module-query.ts";
import { setAt } from "../persistence/module-schema.ts";
import type { SqliteParameters, SqliteValue } from "./gateway.ts";

const encode = (value: string): string =>
  value
    .split("")
    .map((char) => char.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("");
export const moduleTable = (module: string, entity: string): string =>
  `module__${encode(module)}__${encode(entity)}`;
export const moduleColumn = (field: string): string =>
  field === "id" ? "id" : field === "workspaceId" ? "workspace_id" : `f_${encode(field)}`;
export const moduleProjection = (field: string): string => `v_${encode(field)}`;
const sourceAlias = (source: string): string =>
  source === "root" ? "root" : `source_${encode(source)}`;
export const quoteModuleIdentifier = (identifier: string): string =>
  `"${identifier.replaceAll('"', '""')}"`;
export const moduleValue = (value: unknown): SqliteValue =>
  value === undefined || value === null
    ? null
    : typeof value === "boolean"
      ? Number(value)
      : typeof value === "object"
        ? JSON.stringify(value)
        : (value as SqliteValue);
// Drivers may bind JS integers as SQLite REAL. Preserve integer IDs in STRICT ANY columns.
export const modulePlaceholder = (value: unknown): string =>
  typeof value === "number" && Number.isSafeInteger(value) ? "CAST(? AS INTEGER)" : "?";

export interface ModuleSqlQuery {
  readonly sql: string;
  readonly parameters: SqliteParameters;
  readonly fields: QueryFields;
  readonly projected: boolean;
}

/** Logical query compilation only. No host/domain vocabulary is present in this adapter. */
export function compileModuleQuery(
  schema: ModuleSchema,
  workspaceId: string,
  query: EntityQuery,
): ModuleSqlQuery {
  const parameters: SqliteValue[] = [];
  const bind = (value: unknown): string => {
    parameters.push(moduleValue(value));
    return modulePlaceholder(value);
  };
  const compile = (query: EntityQuery): string => {
    const parameterStart = parameters.length;
    const union = !!query.union;
    const column = (field: string, source = "root"): string => {
      if (source === "traversal") return `walk.${field === "rootId" ? "root_id" : "depth"}`;
      return `${quoteModuleIdentifier(sourceAlias(source))}.${quoteModuleIdentifier(union ? moduleProjection(field) : moduleColumn(field))}`;
    };
    const expression = (value: EntityExpression): string => {
      if ("field" in value) return column(value.field, value.source);
      if ("value" in value) return bind(value.value);
      if ("coalesce" in value)
        return value.coalesce.length === 1
          ? expression(value.coalesce[0]!)
          : `COALESCE(${value.coalesce.map(operand).join(",")})`;
      if ("slice" in value) return `substr(${expression(value.slice)},1,${bind(value.length)})`;
      return `CASE WHEN ${filter(value.when)} THEN ${expression(value.thenValue)} ELSE ${expression(value.elseValue)} END`;
    };
    const operand = (value: EntityExpression): string => {
      const sql = expression(value);
      return expressionType(schema, query, value).type === "json" ? `NULLIF(${sql},'null')` : sql;
    };
    const filter = (value: EntityFilter): string => {
      if (value.op === "and" || value.op === "or")
        return value.conditions.length
          ? `(${value.conditions.map(filter).join(value.op === "and" ? " AND " : " OR ")})`
          : value.op === "and"
            ? "1"
            : "0";
      if (value.op === "not") return `(NOT ${filter(value.condition)})`;
      if (value.op === "in")
        return value.values.length
          ? `(${value.values.map((item) => `${operand(value.expression)} IS ${bind(item)}`).join(" OR ")})`
          : "0";
      const operators = { eq: "IS", ne: "IS NOT", lt: "<", lte: "<=", gt: ">", gte: ">=" };
      const comparison = `${operand(value.left)} ${operators[value.op]} ${operand(value.right)}`;
      return value.op === "eq" || value.op === "ne"
        ? `(${comparison})`
        : `COALESCE((${comparison}),0)`;
    };
    const aggregate = (value: EntityAggregate): string => {
      let input = value.expression ? expression(value.expression) : "1";
      if (value.where) input = `CASE WHEN ${filter(value.where)} THEN ${input} END`;
      const sql = `${value.op.toUpperCase()}(${value.distinct ? "DISTINCT " : ""}${input})`;
      return value.op === "sum" ? `COALESCE(${sql},0)` : sql;
    };
    // Keep expression/parameter assembly in SQL order: SELECT, FROM, WHERE, GROUP, ORDER.
    const fields = fieldsForQuery(schema, query);
    const projection =
      query.select || query.aggregate
        ? Object.keys(fields)
            .sort()
            .map(
              (name) =>
                `${query.select?.[name] ? expression(query.select[name]) : aggregate(query.aggregate![name]!)} AS ${quoteModuleIdentifier(moduleProjection(name))}`,
            )
            .join(",")
        : Object.keys(fields)
            .sort()
            .map((name) => `${column(name)} AS ${quoteModuleIdentifier(moduleProjection(name))}`)
            .join(",");
    let prefix = "";
    let source: string;
    if (query.union)
      source = `(${query.union.map((branch) => `SELECT * FROM (${compile(branch)})`).join(" UNION ALL ")}) AS root`;
    else {
      const table = quoteModuleIdentifier(moduleTable(schema.id, query.from!));
      source = `${table} AS root`;
      if (query.traverse) {
        const traversal = query.traverse;
        const parent = quoteModuleIdentifier(moduleColumn(traversal.parentField));
        // CTE parameters occur before SELECT parameters; build this fragment separately.
        const traversalParameters: SqliteValue[] = [workspaceId, ...traversal.roots, workspaceId];
        prefix = `WITH RECURSIVE walk(root_id,id,depth,path) AS (
          SELECT id,id,0,json_array(id) FROM ${table} WHERE workspace_id = ? AND id IN (${traversal.roots.map(modulePlaceholder).join(",") || "NULL"})
          UNION ALL SELECT walk.root_id,next.id,walk.depth+1,json_insert(walk.path,'$[#]',next.id)
          FROM walk CROSS JOIN ${table} AS next ${traversal.direction === "ancestors" ? `JOIN ${table} AS current ON current.id = walk.id AND current.workspace_id = next.workspace_id` : ""}
          WHERE next.workspace_id = ? AND ${traversal.direction === "ancestors" ? `next.id = current.${parent}` : `next.${parent} = walk.id`}
            AND NOT EXISTS (SELECT 1 FROM json_each(walk.path) WHERE value IS next.id)
        ) `;
        // Each nested compiler must prepend its own CTE binds only to its local parameter slice.
        parameters.splice(parameterStart, 0, ...traversalParameters);
        source += " JOIN walk ON root.id = walk.id";
      }
      if (query.latestBy) {
        // Rank/order/limit metadata before fetching full rows, even with thousands of groups.
        const orderColumns = query
          .orderBy!.map((item, index) => `${expression(item.expression)} AS order_${index}`)
          .join(",");
        const rankOrder = query
          .orderBy!.map(
            (item) =>
              `${expression(item.expression)} ${item.direction === "desc" ? "DESC" : "ASC"}`,
          )
          .join(",");
        const rankWhere = `root.workspace_id = ${bind(workspaceId)}${query.where ? ` AND ${filter(query.where)}` : ""}`;
        const selected = `SELECT id FROM (SELECT root.id,${orderColumns},ROW_NUMBER() OVER (PARTITION BY ${query.latestBy.map((field) => column(field)).join(",")} ORDER BY ${rankOrder}) AS position FROM ${table} AS root WHERE ${rankWhere}) WHERE position <= ${bind(query.limitPerGroup ?? 1)} ORDER BY ${query.orderBy!.map((item, index) => `order_${index} ${item.direction === "desc" ? "DESC" : "ASC"}`).join(",")}`;
        const bounds =
          query.limit !== undefined || query.offset !== undefined
            ? ` LIMIT ${bind(query.limit ?? -1)} OFFSET ${bind(query.offset ?? 0)}`
            : "";
        source += ` JOIN (${selected}${bounds}) AS newest ON newest.id = root.id`;
      }
    }
    for (const join of query.joins ?? [])
      source += ` ${join.kind === "left" ? "LEFT" : "INNER"} JOIN ${quoteModuleIdentifier(moduleTable(schema.id, join.entity))} AS ${quoteModuleIdentifier(sourceAlias(join.as))} ON ${column("workspaceId", join.as)} = ${bind(workspaceId)} AND ${filter(join.on)}`;
    const conditions = query.from ? [`root.workspace_id = ${bind(workspaceId)}`] : [];
    if (query.traverse && !query.traverse.includeRoots) conditions.push("walk.depth > 0");
    if (query.where && !query.latestBy) conditions.push(filter(query.where));
    const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
    const group = query.groupBy?.length
      ? ` GROUP BY ${query.groupBy.map(expression).join(",")}`
      : "";
    const order = query.orderBy?.length
      ? ` ORDER BY ${query.orderBy.map((item) => `${expression(item.expression)} ${item.direction === "desc" ? "DESC" : "ASC"}`).join(",")}`
      : "";
    const bounds =
      !query.latestBy && (query.limit !== undefined || query.offset !== undefined)
        ? ` LIMIT ${bind(query.limit ?? -1)} OFFSET ${bind(query.offset ?? 0)}`
        : "";
    return `${prefix}SELECT ${projection} FROM ${source}${where}${group}${order}${bounds}`;
  };
  return {
    sql: compile(query),
    parameters,
    fields: fieldsForQuery(schema, query),
    projected: !!(query.select || query.aggregate || query.union),
  };
}

export function decodeModuleRow(
  fields: QueryFields,
  row: Record<string, unknown>,
  projected: boolean,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = row[moduleProjection(name)];
    if (value == null && !projected && field.optional) continue;
    setAt(
      result,
      name,
      value == null
        ? null
        : field.type === "boolean"
          ? !!value
          : field.type === "json"
            ? JSON.parse(value as string)
            : value,
    );
  }
  return result;
}
