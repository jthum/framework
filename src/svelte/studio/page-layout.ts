import { customAlphabet } from "nanoid";
import type { BlockDefinition } from "../../blocks/model.ts";
import type { PageLayoutNode, PageGroupNode, PageHeight, SpecMeta } from "../../spec/model.ts";

export const definitionId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
  16,
);

export function emptyGroup(columns = 1): PageGroupNode {
  return { id: definitionId(), kind: "group", columns: clampColumns(columns), children: [] };
}

export function createBlockNode(block: BlockDefinition, config?: SpecMeta): PageLayoutNode {
  return {
    id: definitionId(),
    kind: "block",
    block: block.key,
    config: JSON.parse(JSON.stringify(config ?? block.defaultConfig ?? {})) as SpecMeta,
  };
}

export function clampColumns(value: number): number {
  return Number.isFinite(value) ? Math.min(4, Math.max(1, Math.round(value))) : 1;
}

export function blockAt(
  layout: readonly PageLayoutNode[],
  path: readonly number[],
): PageLayoutNode | undefined {
  if (!path.length) return undefined;
  const [index, ...rest] = path;
  const node = index === undefined ? undefined : layout[index];
  return rest.length ? (node?.kind === "group" ? blockAt(node.children, rest) : undefined) : node;
}

export function nodePath(layout: readonly PageLayoutNode[], id: string): number[] | undefined {
  for (const [index, node] of layout.entries()) {
    if (node.id === id) return [index];
    if (node.kind === "group") {
      const nested = nodePath(node.children, id);
      if (nested) return [index, ...nested];
    }
  }
  return undefined;
}

export function setBlock(
  layout: readonly PageLayoutNode[],
  path: readonly number[],
  node: PageLayoutNode,
): readonly PageLayoutNode[] {
  const [index, ...rest] = path;
  if (index === undefined || !layout[index]) return layout;
  return layout.map((current, i) =>
    i !== index
      ? current
      : rest.length
        ? current.kind === "group"
          ? { ...current, children: setBlock(current.children, rest, node) }
          : current
        : node,
  );
}

export function removeBlock(
  layout: readonly PageLayoutNode[],
  path: readonly number[],
): readonly PageLayoutNode[] {
  const [index, ...rest] = path;
  if (index === undefined || !layout[index]) return layout;
  if (!rest.length) return layout.filter((_, i) => i !== index);
  const node = layout[index];
  return node?.kind === "group"
    ? setBlock(layout, [index], { ...node, children: removeBlock(node.children, rest) })
    : layout;
}

export function insertBlock(
  layout: readonly PageLayoutNode[],
  path: readonly number[],
  node: PageLayoutNode,
): readonly PageLayoutNode[] {
  const [index, ...rest] = path;
  if (index === undefined) return [...layout, node];
  if (!Number.isInteger(index) || index < 0 || index > layout.length) return layout;
  if (!rest.length) return [...layout.slice(0, index), node, ...layout.slice(index)];
  const parent = layout[index];
  return parent?.kind === "group"
    ? setBlock(layout, [index], { ...parent, children: insertBlock(parent.children, rest, node) })
    : layout;
}

export function appendInGroup(
  layout: readonly PageLayoutNode[],
  path: readonly number[],
  node: PageLayoutNode,
): readonly PageLayoutNode[] {
  const group = blockAt(layout, path);
  return group?.kind === "group"
    ? setBlock(layout, path, { ...group, children: [...group.children, node] })
    : layout;
}

export function moveSibling(
  layout: readonly PageLayoutNode[],
  from: number,
  to: number,
): readonly PageLayoutNode[] {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= layout.length ||
    to >= layout.length
  )
    return layout;
  const next = [...layout];
  const [node] = next.splice(from, 1);
  if (!node) return layout;
  next.splice(to, 0, node);
  return next;
}

export function moveInGroup(
  layout: readonly PageLayoutNode[],
  index: number,
  from: number,
  to: number,
): readonly PageLayoutNode[] {
  const group = layout[index];
  return group?.kind === "group"
    ? setBlock(layout, [index], { ...group, children: moveSibling(group.children, from, to) })
    : layout;
}

export function setGroupColumns(
  layout: readonly PageLayoutNode[],
  index: number,
  columns: number,
): readonly PageLayoutNode[] {
  const group = layout[index];
  return group?.kind === "group"
    ? setBlock(layout, [index], { ...group, columns: clampColumns(columns) })
    : layout;
}

export function setGroupMinHeight(
  layout: readonly PageLayoutNode[],
  index: number,
  minHeight?: PageHeight,
): readonly PageLayoutNode[] {
  const group = layout[index];
  if (group?.kind !== "group") return layout;
  const { minHeight: _previous, ...rest } = group;
  return setBlock(layout, [index], minHeight ? { ...rest, minHeight } : rest);
}

export function gridClass(columns: number): string {
  const count = clampColumns(columns);
  if (count === 1) return "grid grid-cols-1 gap-4";
  if (count === 2) return "grid grid-cols-1 gap-4 sm:grid-cols-2";
  if (count === 3) return "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";
  return "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4";
}

const heights: Record<PageHeight, string> = {
  s: "min-h-48",
  m: "min-h-80",
  l: "min-h-[22rem]",
  xl: "min-h-[32rem]",
};
const rank: Record<PageHeight, number> = { s: 1, m: 2, l: 3, xl: 4 };

function preferredHeight(
  layout: readonly PageLayoutNode[],
  catalog: readonly BlockDefinition[],
): PageHeight | undefined {
  let height: PageHeight | undefined;
  for (const node of layout) {
    const candidate =
      node.kind === "group"
        ? (node.minHeight ?? preferredHeight(node.children, catalog))
        : catalog.find((block) => block.key === node.block)?.defaultHeight;
    if (candidate && (!height || rank[candidate] > rank[height])) height = candidate;
  }
  return height;
}

export function groupHeightClass(
  group: PageGroupNode,
  catalog: readonly BlockDefinition[],
): string {
  const height = group.minHeight ?? preferredHeight(group.children, catalog);
  return height ? heights[height] : "";
}

export function blockLabel(node: PageLayoutNode, catalog: readonly BlockDefinition[]): string {
  return node.kind === "group"
    ? "Section"
    : (catalog.find((block) => block.key === node.block)?.label ?? node.block);
}
