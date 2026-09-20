import type { PageDefinition } from "../../spec/model.ts";

export function pageFolder(page: PageDefinition): string | null {
  return typeof page.meta?.folder === "string" ? page.meta.folder.trim() || null : null;
}

export function withPageFolder(page: PageDefinition, folder: string | null): PageDefinition {
  const { folder: _previous, ...meta } = page.meta ?? {};
  return { ...page, meta: folder ? { ...meta, folder } : meta };
}

export function movePageToFolder(
  pages: readonly PageDefinition[],
  key: string,
  folder: string | null,
): PageDefinition[] {
  const page = pages.find((page) => page.key === key);
  if (!page) return [...pages];
  const next = pages.filter((page) => page.key !== key);
  let position = next.findIndex((page) => pageFolder(page));
  if (folder) {
    position = -1;
    next.forEach((page, index) => {
      if (pageFolder(page) === folder) position = index + 1;
    });
  }
  next.splice(position < 0 ? next.length : position, 0, withPageFolder(page, folder));
  return next;
}

export function groupPagesByFolder(
  pages: readonly PageDefinition[],
): { folder: string | null; pages: PageDefinition[] }[] {
  const groups = new Map<string | null, PageDefinition[]>();
  for (const page of pages) {
    const folder = pageFolder(page);
    const list = groups.get(folder) ?? [];
    list.push(page);
    groups.set(folder, list);
  }
  const ungrouped = groups.get(null);
  return [
    ...(ungrouped ? [{ folder: null, pages: ungrouped }] : []),
    ...Array.from(groups, ([folder, pages]) => ({ folder, pages })).filter(
      (group) => group.folder !== null,
    ),
  ];
}

export function uniquePageKey(name: string, taken: readonly string[]): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "page";
  let key = base;
  let suffix = 2;
  while (taken.includes(key)) key = `${base}_${suffix++}`;
  return key;
}
