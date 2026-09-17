import type { BlockDefinition } from "./model.ts";

export const TABLE_BLOCK: BlockDefinition = Object.freeze({
  key: "table",
  label: "Table",
  category: "data",
  description: "Show Source rows and Fields in a table.",
  inputs: [{ key: "view", label: "View", type: "view", required: true }],
} satisfies BlockDefinition);

export const KANBAN_BLOCK: BlockDefinition = Object.freeze({
  key: "kanban",
  label: "Kanban",
  category: "data",
  description: "Group Source rows into a board.",
  defaultHeight: "m",
  inputs: [
    { key: "view", label: "View", type: "view", required: true },
    {
      key: "groupField",
      label: "Group by",
      type: "field",
      dependsOn: "view",
      required: true,
      fieldKind: "choice",
    },
  ],
} satisfies BlockDefinition);
