import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import CollectionEditor from "./collection-editor.svelte";
import ViewFixture from "./view-fixture.svelte";
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
