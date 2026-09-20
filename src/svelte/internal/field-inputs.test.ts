import { describe, expect, it } from "vite-plus/test";
import type { FieldDefinition } from "@jthum/framework/spec";
import { fieldInputDefaults, fieldInputState, parseFieldInputs } from "./field-inputs.js";
const fields: FieldDefinition[] = [
  { id: "yes", key: "approved", label: "Approved", type: "boolean" },
  { id: "amount", key: "amount", label: "Amount", type: "number", default: 0 },
  { id: "context", key: "context", label: "Context", type: "json", default: { source: "form" } },
];
describe("Canonical Field inputs", () => {
  it("preserves choice keys and reference-ID arrays without coupling them to labels", () => {
    const definitions: FieldDefinition[] = [
      {
        id: "tags",
        key: "tags",
        label: "Tags",
        type: "choice",
        multiple: true,
        options: [{ id: "one", key: "first", label: "Renamed option" }],
      },
      {
        id: "people",
        key: "people",
        label: "People",
        type: "reference",
        sourceId: "contacts",
        multiple: true,
      },
    ];
    expect(parseFieldInputs(definitions, { tags: ["first"], people: '["record-one"]' })).toEqual({
      tags: ["first"],
      people: ["record-one"],
    });
    expect(parseFieldInputs(definitions, { people: ["record-two"] })).toEqual({
      people: ["record-two"],
    });
  });
  it("round-trips false, zero and structured defaults without inventing answers", () => {
    const defaults = fieldInputDefaults(fields);
    expect(defaults.approved).toBe("");
    expect(parseFieldInputs(fields, { ...defaults, approved: "false" })).toEqual({
      approved: false,
      amount: 0,
      context: { source: "form" },
    });
  });
  it("reports malformed input while allowing condition evaluation during editing", () => {
    expect(() => parseFieldInputs(fields, { context: "{" })).toThrow("Context");
    expect(parseFieldInputs(fields, { context: "{" }, false)).toEqual({});
    expect(() => parseFieldInputs(fields, { approved: "unknown" })).toThrow("Approved");
  });
  it("uses stable Field identity for visibility, enabling and conditional requirements", () => {
    const note: FieldDefinition = {
      id: "note",
      key: "renamed_note",
      label: "Note",
      type: "text",
      behavior: {
        visibleWhen: { fieldId: "yes", operator: "eq", value: false },
        enabledWhen: { fieldId: "amount", operator: "gt", value: 0 },
        requiredWhen: { fieldId: "yes", operator: "eq", value: false },
      },
    };
    expect(fieldInputState([...fields, note], note, { approved: "false", amount: "5" })).toEqual({
      visible: true,
      enabled: true,
      required: true,
    });
  });
  it("clears hidden malformed JSON rather than blocking submission", () => {
    const hidden: FieldDefinition = {
      id: "hidden",
      key: "hidden",
      label: "Hidden",
      type: "json",
      behavior: {
        hiddenValue: "clear",
        visibleWhen: { fieldId: "yes", operator: "eq", value: true },
      },
    };
    expect(parseFieldInputs([...fields, hidden], { approved: "false", hidden: "{" })).toEqual({
      approved: false,
      hidden: null,
    });
  });
  it("round-trips a datetime default through a local datetime control", () => {
    const field: FieldDefinition = {
      id: "when",
      key: "when",
      label: "When",
      type: "datetime",
      default: "2026-09-17T12:00:00.000Z",
    };
    expect(parseFieldInputs([field], fieldInputDefaults([field])).when).toBe(field.default);
  });
});
