import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import type { PageDefinition } from "../../spec/model.ts";
import Fixture from "./page-fixture.svelte";

const page: PageDefinition = {
  id: "page",
  key: "overview",
  label: "Overview",
  meta: { folder: "Reporting" },
  layout: [
    {
      id: "section",
      kind: "group",
      columns: 2,
      children: [
        { id: "custom-a", kind: "block", block: "custom", config: { title: "First content" } },
        {
          id: "nested",
          kind: "group",
          children: [
            { id: "custom-b", kind: "block", block: "custom", config: { title: "Nested content" } },
          ],
        },
      ],
    },
  ],
};

describe("Standalone Page Studio", () => {
  it("renders custom Blocks and nested Groups without a host registry or SvelteKit", () => {
    const result = render(Fixture, { props: { page } }).body;
    expect(result).toContain("Overview");
    expect(result).toContain('data-block-id="custom-a"');
    expect(result).toContain('data-block-id="custom-b"');
    expect(result).toContain("Nested content");
    expect(result).not.toContain("Block could not be loaded");
  });

  it("renders the listing with host links and metadata-based folders", () => {
    const result = render(Fixture, { props: { page, listing: true } }).body;
    expect(result).toContain("Reporting");
    expect(result).toContain('href="/screens/overview"');
    expect(result).toMatch(/2\s+blocks/);
    expect(result).not.toContain("/p/");
  });
});
