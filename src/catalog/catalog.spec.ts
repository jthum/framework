import { describe, expect, it } from "vite-plus/test";
import { Catalog } from "./catalog.ts";

const catalog = () =>
  new Catalog([
    {
      key: "official",
      label: "Official",
      categories: [{ key: "work", label: "Work" }],
      entries: [
        {
          key: "projects",
          label: "Project tracker",
          description: "Plan client delivery.",
          category: "work",
          tags: ["planning", "delivery"],
          payload: { collections: 2 },
        },
        { key: "notes", label: "Notes", category: "personal", tags: ["writing"] },
      ],
    },
    {
      key: "team",
      label: "Team library",
      entries: [
        { key: "projects", label: "Internal projects", category: "work", tags: ["planning"] },
      ],
    },
  ]);

describe("Catalog", () => {
  it("keeps source provenance explicit when entry keys overlap", () => {
    const entries = catalog().list({ category: "work" });

    expect(entries.items.map(({ source, entry }) => `${source.key}/${entry.key}`)).toEqual([
      "official/projects",
      "team/projects",
    ]);
    expect(catalog().get("team", "projects")?.label).toBe("Internal projects");
  });

  it("filters inert entries and paginates without executing installation code", () => {
    const entries = catalog().list({ search: "CLIENT planning", tags: ["delivery"], limit: 1 });

    expect(entries).toMatchObject({ total: 1, offset: 0, limit: 1, hasMore: false });
    expect(entries.items[0]?.entry.key).toBe("projects");
  });

  it("retains the requested page size at the end of a result set", () => {
    const entries = catalog().list({ offset: 2, limit: 10 });

    expect(entries).toMatchObject({ total: 3, offset: 2, limit: 10, hasMore: false });
    expect(entries.items).toHaveLength(1);
  });

  it("returns defensive copies", () => {
    const first = catalog();
    const entry = first.get("official", "projects") as { payload: { collections: number } };
    const sources = first.sources() as unknown as { categories: { label: string }[] }[];
    entry.payload.collections = 99;
    sources[0]!.categories[0]!.label = "Changed";

    expect(first.get("official", "projects")).toMatchObject({ payload: { collections: 2 } });
    expect(first.sources()[0]?.categories?.[0]?.label).toBe("Work");
  });

  it("rejects ambiguous source definitions and invalid pagination", () => {
    expect(
      () =>
        new Catalog([
          { key: "same", label: "One", entries: [] },
          { key: "same", label: "Two", entries: [] },
        ]),
    ).toThrow("already installed");
    expect(() => catalog().list({ offset: -1 })).toThrow("offset");
  });
});
