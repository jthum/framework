import { describe, expect, it } from "vite-plus/test";
import type { PageDefinition } from "../../spec/model.ts";
import {
  groupPagesByFolder,
  movePageToFolder,
  pageFolder,
  uniquePageKey,
  withPageFolder,
} from "./page-folders.ts";

const pages: PageDefinition[] = [
  { id: "a", key: "a", label: "A", layout: [], meta: { icon: "table", custom: { enabled: true } } },
  { id: "b", key: "b", label: "B", layout: [], meta: { folder: "Finance" } },
  { id: "c", key: "c", label: "C", layout: [], meta: { folder: "Finance" } },
];

describe("Page folders", () => {
  it("preserves custom metadata and identity when changing folders", () => {
    const page = pages[0]!;
    const changed = withPageFolder(page, "Reports");
    expect(changed.id).toBe(page.id);
    expect(changed.meta).toEqual({ ...page.meta, folder: "Reports" });
    expect(withPageFolder(changed, null).meta).toEqual(page.meta);
    expect(pageFolder({ ...page, meta: { folder: 4 } })).toBeNull();
  });

  it("groups without imposing any nesting or access-control semantics", () => {
    expect(
      groupPagesByFolder(pages).map((group) => [group.folder, group.pages.map((page) => page.key)]),
    ).toEqual([
      [null, ["a"]],
      ["Finance", ["b", "c"]],
    ]);
    expect(pages.map((page) => page.key)).toEqual(["a", "b", "c"]);
  });

  it("moves pages to folder ends or before folders at root", () => {
    const moved = movePageToFolder(pages, "a", "Finance");
    expect(moved.map((page) => page.id)).toEqual(["b", "c", "a"]);
    expect(pageFolder(moved[2]!)).toBe("Finance");
    expect(movePageToFolder(moved, "a", null).map((page) => page.id)).toEqual(["a", "b", "c"]);
    expect(movePageToFolder(pages, "missing", null)).toEqual(pages);
  });

  it("uses readable unique keys without making labels identity", () => {
    expect(uniquePageKey("Weekly review", ["weekly_review", "weekly_review_2"])).toBe(
      "weekly_review_3",
    );
    expect(uniquePageKey("", [])).toBe("page");
  });
});
