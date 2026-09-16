import { ERROR_CODES, FrameworkError, type ValidationIssue } from "../errors/error.ts";
import type {
  CollectionDefinition,
  FieldCondition,
  FieldDefinition,
  JsonValue,
} from "../spec/model.ts";
import { validateFieldValue } from "../spec/validate.ts";
import type { RecordValues } from "../persistence/records.ts";

export function prepareCreateValues(
  collection: CollectionDefinition,
  input: RecordValues,
): RecordValues {
  const values: Record<string, JsonValue> = {};
  for (const field of collection.fields) {
    const supplied = input[field.key];
    if (supplied !== undefined) values[field.key] = supplied;
    else if (field.default !== undefined) values[field.key] = structuredClone(field.default);
  }
  const lifecycle = collection.lifecycle;
  if (lifecycle) {
    const field = fieldById(collection, lifecycle.fieldId);
    const supplied = values[field.key];
    if (supplied !== undefined && supplied !== lifecycle.initial) {
      throw invalidInput([
        {
          path: `values.${field.key}`,
          code: "VALIDATION.LIFECYCLE_INITIAL",
          message: `${field.label} must start as ${lifecycle.initial}.`,
        },
      ]);
    }
    values[field.key] = lifecycle.initial;
  }
  rejectUnknownValues(collection, input);
  return validatePreparedValues(collection, applyConditionalClears(collection, values));
}

export function prepareUpdateValues(
  collection: CollectionDefinition,
  current: RecordValues,
  patch: RecordValues,
): RecordValues {
  rejectUnknownValues(collection, patch);
  const next = applyConditionalClears(collection, { ...current, ...patch });
  validateLifecycleTransition(collection, current, next);
  return validatePreparedValues(collection, next);
}

export function prepareMigratedValues(
  previous: CollectionDefinition,
  next: CollectionDefinition,
  current: RecordValues,
): RecordValues {
  const previousFields = new Map(previous.fields.map((field) => [field.id, field]));
  const values: Record<string, JsonValue> = {};
  for (const field of next.fields) {
    const oldKey = previousFields.get(field.id)?.key;
    const existing = oldKey ? current[oldKey] : undefined;
    if (existing !== undefined) values[field.key] = existing;
    else if (field.default !== undefined) values[field.key] = structuredClone(field.default);
  }
  if (next.lifecycle) {
    const field = fieldById(next, next.lifecycle.fieldId);
    if (values[field.key] === undefined) values[field.key] = next.lifecycle.initial;
  }
  return validatePreparedValues(next, applyConditionalClears(next, values));
}

function validatePreparedValues(
  collection: CollectionDefinition,
  values: RecordValues,
): RecordValues {
  const issues: ValidationIssue[] = [];
  for (const field of collection.fields) {
    const visible = evaluateCondition(field.behavior?.visibleWhen, collection, values, true);
    const conditionallyRequired = evaluateCondition(
      field.behavior?.requiredWhen,
      collection,
      values,
      false,
    );
    validateFieldValue(
      field,
      values[field.key],
      `values.${field.key}`,
      issues,
      visible && (field.required === true || conditionallyRequired),
    );
  }
  if (issues.length > 0) throw invalidInput(issues);
  return structuredClone(values);
}

function rejectUnknownValues(collection: CollectionDefinition, values: RecordValues): void {
  const known = new Set(collection.fields.map((field) => field.key));
  const issues = Object.keys(values)
    .filter((key) => !known.has(key))
    .map((key) => ({
      path: `values.${key}`,
      code: "VALIDATION.FIELD_UNKNOWN",
      message: `${key} is not a Field in ${collection.label}.`,
    }));
  if (issues.length > 0) throw invalidInput(issues);
}

function applyConditionalClears(
  collection: CollectionDefinition,
  input: RecordValues,
): RecordValues {
  const values: Record<string, JsonValue> = { ...input };
  for (const field of collection.fields) {
    if (
      field.behavior?.hiddenValue === "clear" &&
      !evaluateCondition(field.behavior.visibleWhen, collection, values, true)
    ) {
      values[field.key] = null;
    }
  }
  return values;
}

function validateLifecycleTransition(
  collection: CollectionDefinition,
  current: RecordValues,
  next: RecordValues,
): void {
  const lifecycle = collection.lifecycle;
  if (!lifecycle) return;
  const field = fieldById(collection, lifecycle.fieldId);
  const from = current[field.key];
  const to = next[field.key];
  if (from === to) return;
  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !lifecycle.transitions.some(
      (transition) => transition.from.includes(from) && transition.to === to,
    )
  ) {
    throw invalidInput([
      {
        path: `values.${field.key}`,
        code: "VALIDATION.LIFECYCLE_TRANSITION",
        message: `Cannot move ${field.label} from ${valueLabel(from)} to ${valueLabel(to)}.`,
      },
    ]);
  }
}

function evaluateCondition(
  condition: FieldCondition | undefined,
  collection: CollectionDefinition,
  values: RecordValues,
  fallback: boolean,
): boolean {
  if (!condition) return fallback;
  if ("all" in condition)
    return condition.all.every((item) => evaluateCondition(item, collection, values, true));
  if ("any" in condition)
    return condition.any.some((item) => evaluateCondition(item, collection, values, false));
  if ("not" in condition) return !evaluateCondition(condition.not, collection, values, false);
  const field = fieldById(collection, condition.fieldId);
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

function fieldById(collection: CollectionDefinition, id: string): FieldDefinition {
  const field = collection.fields.find((candidate) => candidate.id === id);
  if (!field)
    throw new TypeError(`Collection ${collection.key} has an unresolved Field reference.`);
  return field;
}

function scalarEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function comparable(value: JsonValue | undefined): number | string {
  return typeof value === "number" || typeof value === "string" ? value : "";
}

function scalarText(value: JsonValue | undefined): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? `${value}`
    : "";
}

function valueLabel(value: JsonValue | undefined): string {
  return value === undefined ? "unset" : JSON.stringify(value);
}

function invalidInput(issues: readonly ValidationIssue[]): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.validationInvalidInput,
    message: "Some record values need attention.",
    issues,
  });
}
