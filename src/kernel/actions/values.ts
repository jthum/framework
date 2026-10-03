import { type ActionDefinition } from "../action-registry.ts";
import type { InferenceToolValueSchema } from "../inference-runtime.ts";
import { ERROR_CODES, FrameworkError } from "../../errors/error.ts";
import { type CollectionDefinition, type JsonValue } from "../../spec/model.ts";
import { type CollectionRecord, type RecordValues } from "../../persistence/records.ts";

export function actionRecord(
  value: JsonValue | undefined,
): { id?: string; sourceId?: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.sourceId === "string" ? { sourceId: value.sourceId } : {}),
  };
}

export function actionValues(
  value: JsonValue | undefined,
  name: string,
  collection: CollectionDefinition,
): RecordValues {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw actionInputError(`A record Action requires an object at ${name}.`);
  const fields = new Map(collection.fields.map((field) => [field.id, field.key]));
  return Object.fromEntries(
    Object.entries(value).map(([fieldId, fieldValue]) => {
      const key = fields.get(fieldId);
      if (!key) throw actionInputError(`Record Action Field ${fieldId} is unavailable.`);
      return [key, fieldValue];
    }),
  );
}

export function recordValue(
  record: CollectionRecord,
  collection: CollectionDefinition,
  sourceId = record.collectionId,
): JsonValue {
  return {
    id: record.id,
    sourceId,
    values: { ...record.values },
    ...record.values,
    $fields: stableFieldValues(collection, record.values),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    createdBy: record.createdBy,
    updatedBy: record.updatedBy,
  };
}

export function sourceRecordValue(
  id: string,
  sourceId: string,
  collection: CollectionDefinition,
  values: RecordValues,
): JsonValue {
  return {
    ...values,
    id,
    sourceId,
    values: { ...values },
    $fields: stableFieldValues(collection, values),
  };
}

export function stableFieldValues(
  collection: CollectionDefinition,
  values: RecordValues,
): Record<string, JsonValue> {
  return Object.fromEntries(
    collection.fields.map((field) => [field.id, values[field.key] ?? null]),
  );
}

export function stableActionValues(
  collection: CollectionDefinition,
  values: RecordValues,
): Record<string, JsonValue> {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => {
      const field = collection.fields.find((candidate) => candidate.key === key);
      if (!field) throw actionInputError(`Record Field ${key} is unavailable.`);
      return [field.id, value];
    }),
  );
}

export function actionTool(
  label: string,
  description: string,
  properties: Readonly<Record<string, InferenceToolValueSchema>>,
  required: readonly string[] = [],
): NonNullable<ActionDefinition["tool"]> {
  return {
    label,
    description,
    input: {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    },
  };
}

export function actionInputError(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}

export function requiredActionString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim())
    throw actionInputError(`Action input ${name} must be a non-empty string.`);
  return value.trim();
}

export function optionalActionObject(
  value: JsonValue | undefined,
  name: string,
): Readonly<Record<string, JsonValue>> | undefined {
  if (value === undefined) return undefined;
  if (!isJsonObject(value)) throw actionInputError(`Action input ${name} must be an object.`);
  return value;
}

export function isJsonObject(value: JsonValue): value is Readonly<Record<string, JsonValue>> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
