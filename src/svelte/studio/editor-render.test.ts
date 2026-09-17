import { describe, expect, it } from "vite-plus/test";
import { render } from "svelte/server";
import CollectionEditor from "./collection-editor.svelte";
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
