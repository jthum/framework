import type { RuleEffect } from "./rule-model.js";

/** Authoring affordances translated by the canonical Rule adapter, never executed here. */
export const CORE_RULE_EFFECTS: readonly RuleEffect[] = [
  { key: "null", label: "Do nothing" },
  {
    key: "records.create",
    label: "Create record",
    input: { type: "Collection key", fields: "Field values" },
  },
  {
    key: "records.set",
    label: "Update record",
    input: { record: "Record binding", values: "Field values" },
  },
  { key: "records.delete", label: "Delete record", input: { record: "Record binding" } },
  {
    key: "records.query",
    label: "Query records",
    input: { type: "Collection key", view: "View key", where: "Filter" },
  },
];
