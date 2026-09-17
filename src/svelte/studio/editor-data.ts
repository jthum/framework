import { customAlphabet } from "nanoid";
import type { FieldCondition } from "./authoring.js";
export const createDraftId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  16,
);
export function labelFromKey(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
export function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}
export function uniqueKey(base: string, taken: Iterable<string>, fallback = "item"): string {
  const key = slugify(base) || fallback;
  const used = new Set(taken);
  let result = key,
    index = 2;
  while (used.has(result)) result = `${key}_${index++}`;
  return result;
}
/** Read reactive drafts into plain data before handing them to host callbacks. */
export function cloneData<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => cloneData(item)) as T;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, cloneData(item)]),
  ) as T;
}
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}
export function conditionFieldKeys(condition: FieldCondition): string[] {
  if ("all" in condition) return condition.all.flatMap(conditionFieldKeys);
  if ("any" in condition) return condition.any.flatMap(conditionFieldKeys);
  if ("not" in condition) return conditionFieldKeys(condition.not);
  return [condition.field];
}
export function renameConditionField(
  condition: FieldCondition,
  from: string,
  to: string,
): FieldCondition {
  if ("all" in condition)
    return { all: condition.all.map((item) => renameConditionField(item, from, to)) };
  if ("any" in condition)
    return { any: condition.any.map((item) => renameConditionField(item, from, to)) };
  if ("not" in condition) return { not: renameConditionField(condition.not, from, to) };
  return condition.field === from ? { ...condition, field: to } : condition;
}
