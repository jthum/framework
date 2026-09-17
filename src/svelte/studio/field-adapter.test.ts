import { describe, expect, it } from "vite-plus/test";
import type { FieldDefinition } from "@jthum/framework/spec";
import {
  fieldDraftFromDefinition,
  fieldDefinitionFromDraft,
  removeFieldDefinition,
} from "./field-adapter.js";
const fields: FieldDefinition[] = [
  {
    id: "decision",
    key: "approved",
    label: "Approve?",
    type: "boolean",
    required: true,
    default: false,
  },
  {
    id: "note",
    key: "note",
    label: "Note",
    type: "text",
    validation: { minLength: 3 },
    meta: { host: "kept" },
    behavior: { requiredWhen: { fieldId: "decision", operator: "eq", value: false } },
  },
];
describe("Shared canonical field authoring", () => {
  it("blocks removal used by grouped conditions even on preserved JSON fields", () => {
    const json: FieldDefinition = {
      id: "json",
      key: "details",
      label: "Details",
      type: "json",
      behavior: { visibleWhen: { not: { any: [{ fieldId: "decision", operator: "empty" }] } } },
    };
    expect(() => removeFieldDefinition([fields[0]!, json], "decision")).toThrow(
      "conditional checks",
    );
    expect(removeFieldDefinition([fields[0]!, json], "json")).toEqual([fields[0]]);
  });
  it("retains stable conditional identity after key changes and explicit false defaults", () => {
    const drafts = fields.map((field) => fieldDraftFromDefinition(field, fields, []));
    drafts[0]!.key = "accepted";
    drafts[1]!.required_when = { field: "accepted", op: "eq", value: false };
    const result = fieldDefinitionFromDraft(drafts[1]!, drafts, [], fields[1]);
    expect(result.behavior?.requiredWhen).toEqual({
      fieldId: "decision",
      operator: "eq",
      value: false,
    });
    expect(result.meta).toEqual({ host: "kept" });
    expect(fieldDefinitionFromDraft(drafts[0]!, drafts, [], fields[0]).default).toBe(false);
  });
  it("keeps option IDs, custom labels, metadata, and multiplicity across edits", () => {
    const field: FieldDefinition = {
      id: "choice",
      key: "decision",
      label: "Decision",
      type: "choice",
      multiple: true,
      options: [{ id: "yes", key: "yes", label: "Looks good", meta: { custom: true } }],
    };
    const draft = fieldDraftFromDefinition(field, [field], []);
    draft.values!.push("no");
    const result = fieldDefinitionFromDraft(draft, [draft], [], field);
    expect(result.type).toBe("choice");
    if (result.type !== "choice") throw new Error("Wrong type");
    expect(result.multiple).toBe(true);
    expect(result.options[0]).toEqual(field.options[0]);
    expect(result.options[1]?.id).toHaveLength(21);
  });
  it("retains integer and date constraints the sheet does not expose", () => {
    const number: FieldDefinition = {
      id: "n",
      key: "amount",
      label: "Amount",
      type: "number",
      validation: { integer: true, min: 0 },
    };
    const date: FieldDefinition = {
      id: "d",
      key: "date",
      label: "Date",
      type: "date",
      validation: { min: "2026-01-01" },
    };
    for (const field of [number, date]) {
      const draft = fieldDraftFromDefinition(field, [field], []);
      const result = fieldDefinitionFromDraft(draft, [draft], [], field);
      expect("validation" in result && result.validation).toMatchObject(field.validation!);
    }
  });
  it("rejects dangling conditional references and resolves source keys to IDs", () => {
    expect(() => fieldDraftFromDefinition(fields[1]!, [fields[1]!], [])).toThrow("unavailable");
    const source = { id: "contacts", key: "contacts", label: "Contacts", fields: [] };
    const field: FieldDefinition = {
      id: "ref",
      key: "contact",
      label: "Contact",
      type: "reference",
      sourceId: source.id,
      multiple: true,
    };
    const draft = fieldDraftFromDefinition(field, [field], [source]);
    expect(draft.target).toBe("contacts");
    expect(fieldDefinitionFromDraft(draft, [draft], [source], field)).toMatchObject(field);
  });
  it("does not carry type-specific defaults or validation when changing kind", () => {
    const draft = { ...fieldDraftFromDefinition(fields[0]!, fields, []), type: "text" as const };
    expect(fieldDefinitionFromDraft(draft, [draft], [], fields[0]).default).toBeUndefined();
  });
});
