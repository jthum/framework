import type { CollectionDefinition, FieldCondition, JsonValue } from "./model.ts";

/** Evaluate portable Field conditions against logical record values. */
export function evaluateCondition(
  condition: FieldCondition | undefined,
  collection: CollectionDefinition,
  values: Readonly<Record<string, JsonValue | undefined>>,
  fallback: boolean,
): boolean {
  if (!condition) return fallback;
  if ("all" in condition)
    return condition.all.every((item) => evaluateCondition(item, collection, values, true));
  if ("any" in condition)
    return condition.any.some((item) => evaluateCondition(item, collection, values, false));
  if ("not" in condition) return !evaluateCondition(condition.not, collection, values, false);
  const field = collection.fields.find((candidate) => candidate.id === condition.fieldId);
  if (!field)
    throw new TypeError(`Collection ${collection.key} has an unresolved Field reference.`);
  const actual = values[field.key];
  const expected = condition.value;
  switch (condition.operator) {
    case "eq":
      return scalarEqual(actual, expected);
    case "neq":
      return !scalarEqual(actual, expected);
    case "contains":
      return typeof actual === "string"
        ? actual.includes(scalarText(expected))
        : Array.isArray(actual) && actual.some((item) => scalarEqual(item, expected));
    case "empty":
      return (
        actual === undefined ||
        actual === null ||
        actual === "" ||
        (Array.isArray(actual) && actual.length === 0)
      );
    case "notEmpty":
      return !evaluateCondition({ ...condition, operator: "empty" }, collection, values, false);
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

function scalarEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparable(value: JsonValue | undefined): number | string {
  if (typeof value === "boolean") return Number(value);
  return typeof value === "number" || typeof value === "string" ? value : "";
}

function scalarText(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? `${value}`
    : "";
}
