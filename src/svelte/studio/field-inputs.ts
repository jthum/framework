import type { FieldDefinition, JsonValue } from "@jthum/framework/spec";
import { evaluateCondition } from "../../kernel/record-values.js";
import type { Snippet } from "svelte";

export type ReferenceInput = Snippet<
  [
    FieldDefinition,
    string,
    JsonValue | undefined,
    (value: string | string[]) => void,
    { disabled: boolean; required: boolean; invalid: boolean },
  ]
>;

export type FieldInputValues = Record<string, string | string[]>;
export function fieldInputDefaults(fields: readonly FieldDefinition[]): FieldInputValues {
  return Object.fromEntries(
    fields.map((field) => [
      field.key,
      field.default === undefined || (field.default === null && field.type !== "json")
        ? field.type === "choice" && field.multiple
          ? []
          : ""
        : field.type === "json" || (field.type === "reference" && field.multiple)
          ? JSON.stringify(field.default, null, 2)
          : field.type === "datetime" && typeof field.default === "string"
            ? localDateTime(field.default)
            : Array.isArray(field.default)
              ? field.default.map(String)
              : String(field.default),
    ]),
  );
}
export function fieldInputState(
  fields: readonly FieldDefinition[],
  field: FieldDefinition,
  input: FieldInputValues,
) {
  const collection = { id: "inputs", key: "inputs", label: "Inputs", fields };
  const values = parseFieldInputs(fields, input, false);
  return {
    visible: evaluateCondition(field.behavior?.visibleWhen, collection, values, true),
    enabled: evaluateCondition(field.behavior?.enabledWhen, collection, values, true),
    required:
      field.required === true ||
      evaluateCondition(field.behavior?.requiredWhen, collection, values, false),
  };
}
export function parseFieldInputs(
  fields: readonly FieldDefinition[],
  input: FieldInputValues,
  strict = true,
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  const initial = strict ? parseFieldInputs(fields, input, false) : undefined;
  for (const field of fields) {
    if (
      initial &&
      field.behavior?.hiddenValue === "clear" &&
      !evaluateCondition(
        field.behavior.visibleWhen,
        { id: "inputs", key: "inputs", label: "Inputs", fields },
        initial,
        true,
      )
    ) {
      values[field.key] = null;
      continue;
    }
    const raw = input[field.key];
    if (raw === undefined || raw === "") continue;
    try {
      if (field.type === "json" || (field.type === "reference" && field.multiple))
        values[field.key] = JSON.parse(String(raw)) as JsonValue;
      else if (field.type === "number") {
        const value = Number(raw);
        if (!Number.isFinite(value)) throw new Error("Invalid number");
        values[field.key] = value;
      } else if (field.type === "boolean") {
        if (raw !== "true" && raw !== "false") throw new Error("Invalid boolean");
        values[field.key] = raw === "true";
      } else if (field.type === "datetime") values[field.key] = new Date(String(raw)).toISOString();
      else values[field.key] = raw;
    } catch {
      if (strict)
        throw new Error(
          `${field.label}: enter a valid ${field.type === "reference" ? "JSON array of record IDs" : field.type} value.`,
        );
    }
  }
  return values;
}
function localDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 23);
}
