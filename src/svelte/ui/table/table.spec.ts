import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import Fixture from "../../../testing/svelte/table-fixture.svelte";

describe("Table composition", () => {
  it("renders one container and preserves native table semantics and host attributes", () => {
    const body = render(Fixture).body;
    expect(body.match(/data-slot="table-container"/gu)).toHaveLength(1);
    expect(body).toContain('data-variant="default"');
    expect(body).toMatch(/<table[^>]+class="[^"]*host-table/);
    expect(body).toContain('aria-label="Invoices"');
    expect(body).toContain('data-slot="table-caption"');
    expect(body).toContain('scope="col"');
    expect(body).toContain('aria-sort="ascending"');
    expect(body).toContain('data-state="selected"');
    expect(body).toContain('colspan="2"');
    for (const tag of ["thead", "tbody", "tfoot"]) expect(body).toContain(`<${tag}`);
  });

  it("renders embedded tables without introducing another enclosing frame", () => {
    const body = render(Fixture, { props: { variant: "inset" } }).body;
    expect(body).toContain('data-variant="inset"');
    expect(body.match(/data-slot="table-container"/gu)).toHaveLength(1);
    expect(body).toContain("INV-001");
    expect(body).toContain("Total 120");
  });
});
