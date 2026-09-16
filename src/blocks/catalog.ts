import type { BlockDefinition } from "./model.ts";

export const TABLE_BLOCK: BlockDefinition = Object.freeze({
  key: "table",
  label: "Table",
  category: "data",
  description: "Show Source rows and Fields in a table.",
});

export const KANBAN_BLOCK: BlockDefinition = Object.freeze({
  key: "kanban",
  label: "Kanban",
  category: "data",
  description: "Group Source rows into a board.",
});
