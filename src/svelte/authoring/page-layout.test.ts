import { describe, expect, it } from "vite-plus/test";
import type { PageLayoutNode } from "../../spec/model.ts";
import {
  appendInGroup,
  blockAt,
  nodePath,
  createBlockNode,
  emptyGroup,
  groupHeightClass,
  insertBlock,
  moveInGroup,
  moveSibling,
  removeBlock,
  setBlock,
  setGroupColumns,
  setGroupMinHeight,
} from "./page-layout.ts";

const a: PageLayoutNode = { id: "a", kind: "block", block: "stat", config: { title: "A" } };
const b: PageLayoutNode = { id: "b", kind: "block", block: "table" };
const tree: readonly PageLayoutNode[] = Object.freeze([
  { id: "group", kind: "group", columns: 2, children: Object.freeze([a, b]) },
]);

describe("Page authoring", () => {
  it("creates stable distinct layout identities without changing catalog metadata", () => {
    const definition = {
      key: "stat",
      label: "Stat",
      category: "metrics",
      defaultConfig: { title: "Count" },
    };
    const first = createBlockNode(definition);
    const second = createBlockNode(definition);
    expect(first.id).not.toBe(second.id);
    expect(first.id).toMatch(/^[a-zA-Z0-9]{16}$/);
    expect(first.kind).toBe("block");
    expect(emptyGroup(7)).toMatchObject({ columns: 4, children: [] });
  });

  it("looks up and replaces nested nodes immutably", () => {
    expect(blockAt(tree, [0, 1])).toBe(b);
    expect(blockAt(tree, [])).toBeUndefined();
    const next = setBlock(tree, [0, 1], { ...b, id: "replacement" });
    expect(blockAt(next, [0, 1])?.id).toBe("replacement");
    expect(blockAt(tree, [0, 1])).toBe(b);
  });

  it("preserves node IDs through moves and settings changes", () => {
    const moved = moveInGroup(tree, 0, 0, 1);
    expect(nodePath(moved, "a")).toEqual([0, 1]);
    expect(nodePath(moved, "missing")).toBeUndefined();
    expect(blockAt(moved, [0, 1])?.id).toBe("a");
    expect(setGroupColumns(moved, 0, 3)[0]).toMatchObject({ id: "group", columns: 3 });
    expect(setGroupMinHeight(moved, 0, "l")[0]).toMatchObject({ id: "group", minHeight: "l" });
    expect(setGroupMinHeight(setGroupMinHeight(tree, 0, "m"), 0)[0]).not.toHaveProperty(
      "minHeight",
    );
  });

  it("inserts, appends and deletes only the selected node", () => {
    const inserted = insertBlock(tree, [0, 1], { ...a, id: "new" });
    expect(blockAt(inserted, [0, 2])?.id).toBe("b");
    expect(blockAt(removeBlock(inserted, [0, 1]), [0, 1])?.id).toBe("b");
    expect(blockAt(appendInGroup(tree, [0], { ...a, id: "last" }), [0, 2])?.id).toBe("last");
  });

  it("invalid paths and movement are no-ops", () => {
    expect(setBlock(tree, [8], a)).toBe(tree);
    expect(removeBlock(tree, [])).toBe(tree);
    expect(insertBlock(tree, [-1], a)).toBe(tree);
    expect(insertBlock(tree, [Number.NaN], a)).toBe(tree);
    expect(moveSibling(tree, 0.5, 0)).toBe(tree);
    expect(appendInGroup(tree, [0, 0], b)).toBe(tree);
    expect(moveSibling(tree, 0, 9)).toBe(tree);
    expect(blockAt(tree, [0, 1, 0])).toBeUndefined();
  });

  it("does not share nested catalog defaults with inserted Blocks", () => {
    const config = { colors: ["red", "green"] };
    const node = createBlockNode({
      key: "chart",
      label: "Chart",
      category: "charts",
      defaultConfig: config,
    });
    if (node.kind !== "block") throw new Error("fixture");
    expect(node.config).toEqual(config);
    expect(node.config?.colors).not.toBe(config.colors);
  });

  it("explicit section height overrides recursive catalog preferences", () => {
    const group = tree[0];
    if (group?.kind !== "group") throw new Error("fixture");
    const catalog = [
      { key: "table", label: "Table", category: "records", defaultHeight: "l" as const },
    ];
    expect(groupHeightClass(group, catalog)).toBe("min-h-[22rem]");
    expect(groupHeightClass({ ...group, minHeight: "s" }, catalog)).toBe("min-h-48");
    expect(groupHeightClass({ ...emptyGroup(), children: [group] }, catalog)).toBe("min-h-[22rem]");
  });
});
