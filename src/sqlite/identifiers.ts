import type { FieldDefinition } from "../spec/model.ts";

/** Adapter-private physical names derive only from stable identity, never semantic handles. */
export function encodeIdentifier(value: string): string {
  return [...new TextEncoder().encode(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function fieldColumn(field: Pick<FieldDefinition, "id">): string {
  return `_field_${encodeIdentifier(field.id)}`;
}

export function physicalTableName(workspaceId: string, collectionId: string): string {
  return `_records_${encodeIdentifier(workspaceId)}_${encodeIdentifier(collectionId)}`;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
