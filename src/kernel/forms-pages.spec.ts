import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { Spec } from "../spec/model.ts";
import { Kernel } from "./kernel.ts";

describe("Forms and Pages", () => {
  it("submits create, edit, and standalone Forms through one contract", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, fixture(workspace.spec));

    await expect(
      kernel.submitForm(context, "create_project", {
        values: { name: "Launch", private_note: "not exposed" },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    const created = await kernel.submitForm(context, "create_project", {
      values: { name: "Launch" },
    });
    expect(created).toMatchObject({ mode: "create", record: { values: { name: "Launch" } } });
    if (created.mode === "standalone") throw new Error("Expected a record Form.");

    await expect(
      kernel.submitForm(context, "edit_project", { values: { name: "Renamed" } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    const edited = await kernel.submitForm(context, "edit_project", {
      recordId: created.record.id,
      values: { name: "Renamed" },
    });
    expect(edited).toMatchObject({ mode: "edit", record: { values: { name: "Renamed" } } });

    await expect(
      kernel.submitForm(context, "contact_us", { values: { email: "invalid" } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    const standalone = await kernel.submitForm(context, "contact_us", {
      values: { email: "jane@example.com" },
    });
    expect(standalone).toMatchObject({
      mode: "standalone",
      values: { email: "jane@example.com", subscribe: true },
    });
    expect(await kernel.listRecords(context, "project")).toHaveLength(1);
    await kernel.close();
  });

  it("returns portable Form and Page definitions as isolated values", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    await kernel.applySpec(context, fixture(workspace.spec));

    const forms = await kernel.listForms(context);
    const page = await kernel.getPage(context, "home");
    expect(forms.map((form) => form.key)).toEqual(["create_project", "edit_project", "contact_us"]);
    expect(page).toMatchObject({
      key: "home",
      layout: [
        { kind: "block", block: "heading" },
        { kind: "group", columns: 2, children: [{ kind: "block", block: "table" }] },
      ],
    });
    (forms[0] as { label: string }).label = "Changed outside the Kernel";
    expect(await kernel.getForm(context, "create_project")).toMatchObject({
      label: "Create project",
    });
    expect(await kernel.getForm(context, "missing")).toBeNull();
    expect(await kernel.getPage(context, "missing")).toBeNull();
    await kernel.close();
  });
});

function fixture(empty: Spec): Spec {
  return {
    ...empty,
    collections: [
      {
        id: "collection-project",
        key: "project",
        label: "Project",
        fields: [
          { id: "field-name", key: "name", label: "Name", type: "text", required: true },
          {
            id: "field-private-note",
            key: "private_note",
            label: "Private note",
            type: "text",
          },
        ],
      },
    ],
    forms: [
      {
        id: "form-create-project",
        key: "create_project",
        label: "Create project",
        mode: "create",
        collectionId: "collection-project",
        fieldIds: ["field-name"],
      },
      {
        id: "form-edit-project",
        key: "edit_project",
        label: "Edit project",
        mode: "edit",
        collectionId: "collection-project",
        fieldIds: ["field-name"],
      },
      {
        id: "form-contact-us",
        key: "contact_us",
        label: "Contact us",
        mode: "standalone",
        fields: [
          {
            id: "field-email",
            key: "email",
            label: "Email",
            type: "text",
            format: "email",
            required: true,
          },
          {
            id: "field-subscribe",
            key: "subscribe",
            label: "Subscribe",
            type: "boolean",
            default: true,
          },
        ],
        submit: { success: { title: "Thanks" } },
      },
    ],
    pages: [
      {
        id: "page-home",
        key: "home",
        label: "Home",
        meta: { icon: "home", folder: "Overview" },
        layout: [
          { id: "block-heading", kind: "block", block: "heading", config: { text: "Projects" } },
          {
            id: "group-projects",
            kind: "group",
            columns: 2,
            minHeight: "m",
            children: [{ id: "block-projects", kind: "block", block: "table" }],
          },
        ],
      },
    ],
  };
}
