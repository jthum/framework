import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import CollectionEditor from "./collection-editor.svelte";
import ViewFixture from "./view-fixture.svelte";
import FormFixture from "./form-fixture.svelte";
import RuleFixture from "./rule-fixture.svelte";
import type { CollectionActions, CollectionDraft, EditorContext } from "./authoring.js";
const collection: CollectionDraft = {
  id: "contact",
  key: "contact",
  label: "Contact",
  fields: [{ id: "email", key: "email", label: "Email", type: "text" }],
};
const context: EditorContext = { collections: [collection], views: [], forms: [], rules: [] };
const untouched = async () => {
  throw new Error("Rendering must not mutate the host");
};
const actions: CollectionActions = {
  save: untouched,
  rename: untouched,
  renameField: untouched,
  saveField: untouched,
  reorderFields: untouched,
  deleteField: untouched,
  remove: untouched,
};
describe("Standalone Studio editors", () => {
  it("renders Rule authoring and host compatibility diagnostics", () => {
    const rule = { id: "follow_up", key: "follow_up", label: "Follow up", steps: [] };
    const body = render(RuleFixture, { props: { context, rule } }).body;
    expect(body).toContain("Follow up");
    expect(body).toContain("Workflow details");
    expect(body).toContain("Host-provided diagnostic");
    expect(body).not.toContain("browser host");
    expect(body).not.toContain("/build/");
  });
  it("keeps custom effect metadata available inside nested Rule branches", () => {
    const rule = { id: "follow_up", key: "follow_up", label: "Follow up", steps: [] };
    const body = render(RuleFixture, {
      props: {
        context,
        rule,
        steps: [
          {
            gate: {
              predicate: { all: [{ op: "always" }] },
              pass: [{ effect: { key: "mail.send", params: { subject: "Welcome" } } }],
            },
          },
        ],
      },
    }).body;
    expect(body).toContain("Send a message");
    expect(body).toContain("Welcome");
    expect(body).not.toContain("/build/");
  });
  it("renders Form authoring without importing a host form runtime", () => {
    const form = {
      id: "inquiry",
      key: "inquiry",
      label: "Inquiry",
      mode: "standalone" as const,
      inputs: [{ id: "message", key: "message", label: "Message", type: "text" as const }],
    };
    const body = render(FormFixture, { props: { context, form } }).body;
    expect(body).toContain("Inquiry");
    expect(body).toContain("What is this form for?");
    expect(body).toContain("Live preview");
    expect(body).not.toContain("/build/");
  });
  it("renders View authoring with host-injected services and preview", () => {
    const view = {
      id: "contacts",
      key: "contacts",
      label: "Contact directory",
      source: "contact",
      fields: ["email"],
    };
    const body = render(ViewFixture, { props: { context, view } }).body;
    expect(body).toContain("Contact directory");
    expect(body).toContain("View setup");
    expect(body).toContain("Live preview");
    expect(body).not.toContain("/build/");
  });
  it("renders Collection authoring without SvelteKit or a runtime singleton", () => {
    const body = render(CollectionEditor, {
      props: {
        collection,
        context,
        actions,
        onOpen: untouched,
        onDeleted: untouched,
        defaultCollectionLabel: (value) => `${value}s`,
      },
    }).body;
    expect(body).toContain("Contact");
    expect(body).toContain("Fields");
    expect(body).toContain("Advanced");
    expect(body).not.toContain("/build/");
  });
});
