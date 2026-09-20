import { FIELD_KINDS, fieldCapability, type FieldKind } from "./field-capabilities.js";
import { labelFromKey } from "./editor-data.js";
import type { CollectionDraft, ValueSemantic } from "./authoring.js";
export const fieldKindLabel = Object.fromEntries(
  FIELD_KINDS.map((kind) => [kind, fieldCapability(kind).label]),
) as Record<FieldKind, string>;
export const fieldKindHint = Object.fromEntries(
  FIELD_KINDS.map((kind) => [kind, fieldCapability(kind).hint]),
) as Record<FieldKind, string>;
export function columnLabel(path: string, collection?: CollectionDraft): string {
  const [head = "", ...rest] = path.split(".");
  const base = collection?.fields.find((field) => field.key === head)?.label ?? labelFromKey(head);
  return !rest.length || rest[0] === "name" ? base : `${base} ${labelFromKey(rest.join("_"))}`;
}
export function statusTone(value: string): ValueSemantic {
  const normalized = value.toLowerCase();
  if (["overdue", "rejected", "failed", "suspended"].includes(normalized)) return "danger";
  if (["paid", "complete", "completed", "active", "approved"].includes(normalized))
    return "success";
  if (["pending", "submitted", "sent"].includes(normalized)) return "warning";
  if (["draft", "planned"].includes(normalized)) return "info";
  return "neutral";
}
export function formatCell(_path: string, value: unknown): string {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}
