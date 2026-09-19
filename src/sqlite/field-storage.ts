import type { FieldDefinition, JsonValue } from "../spec/model.ts";
import type { SqliteValue } from "./gateway.ts";

/**
 * SQLite record-field mapping (the portable Spec and RecordStore remain logically typed):
 * - text, single choice/reference, date: raw TEXT; dates are YYYY-MM-DD.
 * - datetime: UTC ISO-8601 TEXT with milliseconds, so lexical order is chronological.
 * - number: REAL, or INTEGER when validation.integer is true; boolean: INTEGER 0/1.
 * - json and multiple choice/reference: JSON TEXT. SQL NULL represents logical null.
 *
 * Currency is a number display format, not an exact-decimal Spec type. It therefore uses
 * REAL and retains JavaScript Number precision; exact money needs an explicit future type
 * (for example, a scaled integer or decimal string), not an implicit currency conversion.
 * Missing and explicit null both occupy SQL NULL; _null_fields records which were explicit.
 */
export function fieldSqlType(field: FieldDefinition): "TEXT" | "INTEGER" | "REAL" {
  if (field.type === "number") return field.validation?.integer ? "INTEGER" : "REAL";
  return field.type === "boolean" ? "INTEGER" : "TEXT";
}

export function isStructuredField(field: FieldDefinition): boolean {
  return (
    field.type === "json" ||
    ((field.type === "choice" || field.type === "reference") && field.multiple === true)
  );
}

export function encodeField(field: FieldDefinition, value: JsonValue | undefined): SqliteValue {
  if (value === undefined || value === null) return null;
  if (isStructuredField(field)) return JSON.stringify(value);
  if (field.type === "boolean") return value === true ? 1 : 0;
  if (field.type === "datetime") return new Date(value as string).toISOString();
  return value as string | number;
}

export function decodeField(
  field: FieldDefinition,
  value: SqliteValue | undefined,
  explicitNull = false,
): JsonValue | undefined {
  if (value === null || value === undefined) return explicitNull ? null : undefined;
  if (isStructuredField(field)) return JSON.parse(String(value)) as JsonValue;
  if (field.type === "boolean") return value === 1;
  return value as string | number;
}

export function nullFieldIds(
  fields: readonly FieldDefinition[],
  values: Readonly<Record<string, JsonValue>>,
): string {
  return JSON.stringify(
    fields.filter((field) => values[field.key] === null).map((field) => field.id),
  );
}

export function explicitNulls(marker: SqliteValue | undefined): ReadonlySet<string> {
  return new Set(typeof marker === "string" ? (JSON.parse(marker) as string[]) : []);
}
