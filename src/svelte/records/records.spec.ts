import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import RecordDetails from "./record-details.svelte";
import Fixture from "../../testing/svelte/records-fixture.svelte";
import type { RecordProperty } from "./data.js";

describe("record presentation", () => {
  it("groups compact properties and long-form information with host value rendering", () => {
    const body = render(Fixture).body;
    expect(body).toMatch(/<h1[^>]*>Spring launch(?:<!---->)?<\/h1>/);
    expect(body).toContain("A focused project overview.");
    expect(body).toMatch(/<dt[^>]*>Budget<\/dt>/);
    expect(body).toContain('aria-label="At a glance"');
    expect(body).toContain('data-field="budget"');
    expect(body).toContain('aria-label="Notes"');
    expect(body).toContain("First paragraph\nSecond paragraph");
    expect(body).toContain("Active");
    expect(body).toContain("Approve");
    expect(body).toContain("Related tasks");
    expect(body).toContain("Updated today");
  });

  it("has useful plain-value defaults without requiring a formatter or collection schema", () => {
    const body = render(RecordDetails, {
      props: {
        title: "Example",
        properties: [
          { key: "empty", label: "Empty", value: null },
          { key: "zero", label: "Zero", value: 0 },
          { key: "false", label: "False", value: false },
          { key: "structured", label: "Structured", value: { safe: true } },
        ],
      },
    }).body;
    expect(body).toContain("—");
    expect(body).toContain(">0<");
    expect(body).toContain(">No<");
    expect(body).toContain("safe");
    expect(body).not.toContain("[object Object]");
  });

  it("provides a named non-modal complementary panel and keeps title singular", () => {
    const body = render(Fixture, { props: { panel: true, compact: true } }).body;
    expect(body).toMatch(/<aside[^>]+tabindex="-1"[^>]+aria-labelledby="[^"]+-title"/);
    expect(body).toContain("host-panel");
    expect(body).toContain('aria-label="Close details"');
    expect(body).not.toContain("Record preview");
    expect(body).toContain('href="/projects/one"');
    expect(body).toContain("Next record");
    expect(body.match(/<h[12][^>]*>Spring launch<\/h[12]>/g)).toHaveLength(1);
    expect(body).not.toMatch(/aria-modal|role="dialog"|data-slot="sheet-overlay"/);
    expect(body).not.toContain("<h1");
  });

  it.each([false, true])(
    "keeps every property exactly once and in supplied order after highlights (compact=%s)",
    (compact) => {
      const properties: RecordProperty[] = [
        ...["Budget", "Hours", "Total", "Overflow"].map((label, index) => ({
          key: label.toLowerCase(),
          label,
          value: index,
          highlight: true,
        })),
        { key: "owner", label: "Owner", value: "Jane" },
        { key: "due", label: "Due date", value: "2026-10-17" },
        {
          key: "notes",
          label: "Notes",
          value: "A longer explanation",
          multiline: true,
          highlight: true,
        },
      ];
      const body = render(RecordDetails, { props: { title: "Example", properties, compact } }).body;
      for (const property of properties.filter((item) => !item.multiline)) {
        expect(body.match(new RegExp(`<dt[^>]*>${property.label}</dt>`, "g"))).toHaveLength(1);
      }
      expect(body).not.toMatch(/aria-label="(?:General|Connections|Dates)"/);
      const remaining = properties.filter((property) => !property.multiline).slice(compact ? 0 : 3);
      const list = body.slice(body.indexOf('data-slot="record-fields"'));
      const positions = remaining.map((property) => list.indexOf(`>${property.label}</dt>`));
      expect(
        positions.every(
          (position, index) => position >= 0 && (index === 0 || position > positions[index - 1]!),
        ),
      ).toBe(true);
      expect(body).toContain('aria-label="Notes"');
      expect(body).toContain("A longer explanation");
      if (compact) {
        expect(body).not.toContain('data-slot="record-highlights"');
        return;
      }
      const highlights = body.slice(
        body.indexOf('aria-label="At a glance"'),
        body.indexOf("</dl>"),
      );
      expect(highlights).not.toContain("Overflow");
      expect(highlights).not.toContain("Notes");
      expect(highlights).toContain(">0<");
      expect(highlights).not.toContain("bg-primary");
    },
  );

  it("does not tint the item header or highlights with the accent colour", () => {
    const body = render(Fixture, { props: { panel: true, compact: true } }).body;
    expect(body).not.toMatch(/bg-primary\/|border-primary\//);
  });

  it("does not add empty highlights or properties sections for an identity-only item", () => {
    const body = render(RecordDetails, { props: { title: "Example" } }).body;
    expect(body).not.toContain("At a glance");
    expect(body).not.toContain(">Details<");
    expect(body).not.toContain("Record preview");
    expect(body).toContain("Example");
  });

  it("keeps a compact Chrome identity header with the status beside the title", () => {
    const body = render(Fixture, { props: { panel: true, compact: true } }).body;
    expect(body.match(/data-record-style="chrome"/g)).toHaveLength(2);
    for (const key of ["budget", "enabled", "notes"]) {
      expect(body.match(new RegExp(`data-field="${key}"`, "g"))).toHaveLength(1);
    }
    expect(body).toContain("Active");
    expect(body).toContain("Approve");
    expect(body).toContain("Related tasks");
    expect(body).toContain("Updated today");
    expect(body).toContain("Next record");
    expect(body).toContain('href="/projects/one"');
    expect(body).toContain('aria-label="Close details"');
    expect(body).not.toContain("Properties");
    expect(body).not.toMatch(/aria-modal|role="dialog"|bg-primary\//);
    expect(body).not.toContain('data-slot="card"');
    expect(body).not.toContain(">Details<");
    expect(body).not.toContain(">Project<");
    const header = body.slice(body.indexOf("<header"), body.indexOf("</header>"));
    const identity = header.slice(header.indexOf('data-slot="record-identity"'));
    expect(identity).toContain("Spring launch");
    expect(identity).toContain("Active");
    expect(header).toContain("text-lg");
    expect(header).toContain("font-medium");
    expect(header).not.toContain("font-semibold");
    expect(header).not.toMatch(/text-3xl|text-4xl/);
    expect(header).not.toContain("Next record");
    expect(header).not.toContain("Open full page");
    const navigation = body.slice(body.indexOf('data-slot="record-navigation"'));
    expect(navigation).toContain("Next record");
    expect(navigation).toContain("Open full page");
    expect(body.match(/href="\/projects\/one"/g)).toHaveLength(1);
    expect(body.match(/>Active</g)).toHaveLength(1);
    expect(body).not.toContain("Compare drawer styles");
    expect(body).not.toMatch(/<footer[^>]*\bborder-t(?:\s|")/);
    expect(body).not.toMatch(/\bborder-b(?:\s|")/);
  });

  it("leads compact details with stacked-label facts, then summary and longer content", () => {
    const body = render(Fixture, { props: { panel: true, compact: true } }).body;
    const fields = body.indexOf('data-slot="record-fields"');
    const summary = body.indexOf('aria-label="Summary"');
    const notes = body.indexOf('aria-label="Notes"');
    expect(fields).toBeGreaterThan(-1);
    expect(summary).toBeGreaterThan(fields);
    expect(notes).toBeGreaterThan(summary);
    expect(body).toContain("@xs/details:grid-cols-2");
    expect(body).toContain("flex flex-col gap-1");
    expect(body.match(/A focused project overview\./g)).toHaveLength(1);
    expect(body).not.toContain('data-slot="record-highlights"');
  });

  it("keeps all data on one card-colour surface beneath the Chrome header", () => {
    const body = render(Fixture, { props: { panel: true, compact: true } }).body;
    const overviewStart = body.indexOf('data-slot="record-overview"');
    const readingStart = body.indexOf('data-slot="record-reading"');
    const overview = body.slice(overviewStart, readingStart);
    const reading = body.slice(readingStart, body.indexOf("</article>"));
    expect(overviewStart).toBeGreaterThan(-1);
    expect(readingStart).toBeGreaterThan(overviewStart);
    expect(overview).toContain('data-field="budget"');
    expect(overview).toContain('data-field="enabled"');
    expect(overview).not.toContain("bg-card");
    const content = body.slice(
      body.indexOf('data-slot="record-panel-content"'),
      body.indexOf('data-slot="record-navigation"'),
    );
    expect(content).toContain("rounded-xl border border-border bg-card");
    expect(content).not.toContain("bg-surface-chrome");
    expect(reading).not.toContain("bg-card");
    expect(reading).toContain('aria-label="Summary"');
    expect(reading).toContain('data-field="notes"');
    expect(reading).toContain("Related tasks");
    expect(reading).toContain("Updated today");
    expect(reading).not.toContain('data-field="budget"');
  });

  it("does not add a reading surface to a compact facts-only item", () => {
    const body = render(RecordDetails, {
      props: {
        title: "Example",
        compact: true,
        properties: [{ key: "quantity", label: "Quantity", value: 0 }],
      },
    }).body;
    expect(body).toContain('data-slot="record-overview"');
    expect(body).not.toContain('data-slot="record-reading"');
    expect(body).toContain(">0<");
  });

  it.each([false, true])(
    "keeps a description-only compact item readable (showHeader=%s)",
    (showHeader) => {
      const body = render(RecordDetails, {
        props: { title: "Example", description: "Only a summary.", compact: true, showHeader },
      }).body;
      expect(body.match(/Only a summary\./g)).toHaveLength(1);
      expect(body).toContain('aria-label="Summary"');
      expect(body).not.toContain('aria-label="Details"');
    },
  );

  it("keeps the page's framed details while presenting drawer facts without nested cards", () => {
    const page = render(Fixture).body;
    const drawer = render(Fixture, { props: { panel: true, compact: true } }).body;
    expect(page).toContain('data-slot="card"');
    expect(page).toContain(">Details<");
    expect(drawer).not.toContain('data-slot="card"');
    expect(drawer).toContain('aria-label="Details"');
    for (const key of ["budget", "enabled", "notes"]) {
      expect(page.match(new RegExp(`data-field="${key}"`, "g"))).toHaveLength(1);
      expect(drawer.match(new RegExp(`data-field="${key}"`, "g"))).toHaveLength(1);
    }
  });
});
