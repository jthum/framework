import type { FilterClause, FilterOp } from "./authoring.js";

export type { FilterClause, FilterOp };

export const FILTER_OPS: Array<{ value: FilterOp; label: string }> = [
  { value: "eq", label: "is" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "in", label: "is one of" },
  { value: "empty", label: "is empty" },
  { value: "not_empty", label: "is not empty" },
  { value: "gt", label: "greater than" },
  { value: "gte", label: "at least" },
  { value: "lt", label: "less than" },
  { value: "lte", label: "at most" },
];

export function normalizeFilters(
  where?: FilterClause[] | Record<string, unknown> | null,
): FilterClause[] {
  if (!where) return [];
  if (Array.isArray(where)) {
    return where.filter((clause) => clause?.field);
  }
  return Object.entries(where).map(([field, value]) => ({ field, op: "eq" as const, value }));
}

export function compactWhere(
  clauses: FilterClause[],
): FilterClause[] | Record<string, unknown> | undefined {
  const usable = clauses.filter((clause) => clause.field);
  if (!usable.length) return undefined;
  const simple = usable.every(
    (clause) =>
      (!clause.op || clause.op === "eq") &&
      clause.value != null &&
      clause.value !== "" &&
      !Array.isArray(clause.value),
  );
  if (simple) {
    return Object.fromEntries(usable.map((clause) => [clause.field, clause.value]));
  }
  return usable;
}
