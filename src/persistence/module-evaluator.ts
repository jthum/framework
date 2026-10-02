import type {
  EntityAggregate,
  EntityExpression,
  EntityFilter,
  EntityQuery,
  EntityRow,
} from "./modules.ts";
import { compareEntityValues, setAt, valueAt } from "./module-schema.ts";

type Context = Readonly<Record<string, EntityRow | null>>;
export function evaluateExpression(expression: EntityExpression, row: Context): unknown {
  if ("field" in expression)
    return valueAt(row[expression.source ?? "root"], expression.field) ?? null;
  if ("value" in expression) return expression.value;
  if ("coalesce" in expression)
    return (
      expression.coalesce
        .map((value) => evaluateExpression(value, row))
        .find((value) => value != null) ?? null
    );
  if ("slice" in expression) {
    const value = evaluateExpression(expression.slice, row);
    // Match SQLite substr's Unicode code-point semantics, not grapheme segmentation.
    return Array.from(typeof value === "string" ? value : "")
      .slice(0, expression.length)
      .join("");
  }
  return evaluateExpression(
    evaluateFilter(expression.when, row) ? expression.thenValue : expression.elseValue,
    row,
  );
}

export function evaluateFilter(filter: EntityFilter, row: Context): boolean {
  if (filter.op === "and")
    return filter.conditions.every((condition) => evaluateFilter(condition, row));
  if (filter.op === "or")
    return filter.conditions.some((condition) => evaluateFilter(condition, row));
  if (filter.op === "not") return !evaluateFilter(filter.condition, row);
  if (filter.op === "in")
    return filter.values.some((value) => value === evaluateExpression(filter.expression, row));
  const left = evaluateExpression(filter.left, row),
    right = evaluateExpression(filter.right, row);
  if (filter.op === "eq") return left === right;
  if (filter.op === "ne") return left !== right;
  if (left == null || right == null) return false;
  const comparison = compareEntityValues(left, right);
  return filter.op === "lt"
    ? comparison < 0
    : filter.op === "lte"
      ? comparison <= 0
      : filter.op === "gt"
        ? comparison > 0
        : comparison >= 0;
}

function aggregateValue(aggregate: EntityAggregate, rows: readonly Context[]): unknown {
  const matching = rows.filter((row) => !aggregate.where || evaluateFilter(aggregate.where, row));
  let values = matching
    .map((row) => (aggregate.expression ? evaluateExpression(aggregate.expression, row) : 1))
    .filter((value) => value !== null);
  if (aggregate.distinct) values = [...new Set(values)];
  if (aggregate.op === "count") return values.length;
  if (aggregate.op === "sum") return values.reduce<number>((sum, value) => sum + Number(value), 0);
  if (!values.length) return null;
  values.sort(compareEntityValues);
  return aggregate.op === "min" ? values[0] : values.at(-1);
}

/** Reference execution for a provider whose complete data already lives in memory. */
export function evaluateEntityQuery(
  query: EntityQuery,
  read: (entity: string) => readonly EntityRow[],
): EntityRow[] {
  let rows: Context[] = (
    query.from
      ? read(query.from)
      : query.union!.flatMap((branch) => evaluateEntityQuery(branch, read))
  ).map((root) => ({ root }));
  if (query.traverse) {
    const traversal = query.traverse;
    const all = read(query.from!);
    const byId = new Map(all.map((row) => [row.id, row]));
    rows = [];
    for (const root of new Set(traversal.roots)) {
      const initial = byId.get(root);
      if (!initial) continue;
      const pending = [{ row: initial, depth: 0 }],
        visited = new Set<unknown>();
      while (pending.length) {
        const next = pending.shift()!;
        if (visited.has(next.row.id)) continue;
        visited.add(next.row.id);
        if (traversal.includeRoots || next.depth > 0)
          rows.push({ root: next.row, traversal: { rootId: root, depth: next.depth } });
        if (traversal.direction === "ancestors") {
          const parent = byId.get(valueAt(next.row, traversal.parentField));
          if (parent) pending.push({ row: parent, depth: next.depth + 1 });
        } else
          for (const child of all)
            if (valueAt(child, traversal.parentField) === next.row.id)
              pending.push({ row: child, depth: next.depth + 1 });
      }
    }
  }
  for (const join of query.joins ?? [])
    rows = rows.flatMap((row) => {
      const matching = read(join.entity)
        .map((candidate) => ({ ...row, [join.as]: candidate }))
        .filter((candidate) => evaluateFilter(join.on, candidate));
      return matching.length ? matching : join.kind === "left" ? [{ ...row, [join.as]: null }] : [];
    });
  if (query.where) rows = rows.filter((row) => evaluateFilter(query.where!, row));
  const order = (left: Context, right: Context): number => {
    for (const item of query.orderBy ?? []) {
      const comparison = compareEntityValues(
        evaluateExpression(item.expression, left),
        evaluateExpression(item.expression, right),
      );
      if (comparison) return item.direction === "desc" ? -comparison : comparison;
    }
    return 0;
  };
  rows.sort(order);
  if (query.latestBy) {
    const seen = new Map<string, number>();
    rows = rows.filter((row) => {
      const key = JSON.stringify(query.latestBy!.map((field) => valueAt(row.root, field) ?? null));
      const count = seen.get(key) ?? 0;
      if (count >= (query.limitPerGroup ?? 1)) return false;
      seen.set(key, count + 1);
      return true;
    });
  }
  const projection = (row: Context): Record<string, unknown> => {
    if (!query.select && !query.aggregate) return structuredClone(row.root!);
    const result: Record<string, unknown> = {};
    for (const [key, expression] of Object.entries(query.select ?? {}))
      setAt(result, key, evaluateExpression(expression, row));
    return result;
  };
  let results: EntityRow[];
  if (query.aggregate || query.groupBy) {
    const groups = new Map<string, Context[]>();
    if (!query.groupBy?.length) groups.set("all", rows);
    else
      for (const row of rows) {
        const key = JSON.stringify(
          query.groupBy.map((expression) => evaluateExpression(expression, row)),
        );
        const entries = groups.get(key) ?? [];
        entries.push(row);
        groups.set(key, entries);
      }
    results = [...groups.values()].map((entries) => {
      const result = projection(entries[0] ?? { root: {} });
      for (const [key, aggregate] of Object.entries(query.aggregate ?? {}))
        setAt(result, key, aggregateValue(aggregate, entries));
      return result;
    });
  } else {
    if (query.sample !== undefined && rows.length) {
      const total = rows.length;
      const ordinals = [
        ...new Set(
          Array.from({ length: query.sample }, (_, slot) =>
            Math.round(((total - 1) * slot) / (query.sample! - 1)),
          ),
        ),
      ];
      return structuredClone(
        ordinals.map((ordinal) => ({ ...projection(rows[ordinal]!), ordinal, total })),
      );
    }
    return structuredClone(
      rows
        .slice(
          query.offset ?? 0,
          query.limit === undefined ? undefined : (query.offset ?? 0) + query.limit,
        )
        .map(projection),
    );
  }
  return structuredClone(
    results.slice(
      query.offset ?? 0,
      query.limit === undefined ? undefined : (query.offset ?? 0) + query.limit,
    ),
  );
}
