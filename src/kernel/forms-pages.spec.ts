import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { Spec, RuleTriggerDefinition } from "../spec/model.ts";
import { Kernel } from "./kernel.ts";

describe("Forms and Pages", () => {
  it("publishes record mutation events before form.submitted, including conditional clearing", async () => {
    expect.hasAssertions();
    const events: Array<{ event: string; field: unknown }> = [];
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      actions: [
        {
          key: "tests.capture",
          run: ({ input }) => {
            if (typeof input.event !== "string") throw new Error("Expected an Event key");
            events.push({ event: input.event, field: input.field });
          },
        },
      ],
    });
    try {
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const context = { workspaceId: root.workspace.id, actorId: root.user.id };
      const triggers: RuleTriggerDefinition[] = [
        { event: "record.created", sourceId: "notes" },
        { event: "record.updated", sourceId: "notes" },
        { event: "record.field_changed", sourceId: "notes", fieldId: "enabled" },
        { event: "record.field_changed", sourceId: "notes", fieldId: "note" },
        { event: "form.submitted", formId: "create" },
        { event: "form.submitted", formId: "edit" },
      ];
      await kernel.applySpec(context, {
        ...root.workspace.spec,
        collections: [
          {
            id: "notes",
            key: "note",
            label: "Note",
            fields: [
              { id: "enabled", key: "enabled", label: "Enabled", type: "boolean", default: true },
              {
                id: "note",
                key: "note",
                label: "Note",
                type: "text",
                behavior: {
                  visibleWhen: { fieldId: "enabled", operator: "eq", value: true },
                  hiddenValue: "clear",
                },
              },
            ],
          },
        ],
        forms: [
          {
            id: "create",
            key: "create_note",
            label: "Create",
            mode: "create",
            collectionId: "notes",
            fieldIds: ["enabled", "note"],
          },
          {
            id: "edit",
            key: "edit_note",
            label: "Edit",
            mode: "edit",
            collectionId: "notes",
            fieldIds: ["enabled"],
          },
        ],
        rules: triggers.map((trigger, index) => ({
          id: `rule-${index}`,
          key: `capture_${index}`,
          label: trigger.event,
          trigger,
          steps: [
            {
              id: `step-${index}`,
              action: {
                key: "tests.capture",
                input: {
                  event: { $ref: "trigger.event" },
                  field: trigger.fieldId ? { $ref: "trigger.fieldId" } : null,
                },
              },
            },
          ],
        })),
      });
      await expect(
        kernel.submitForm(context, "create_note", { values: { enabled: "invalid" } }),
      ).rejects.toMatchObject({ code: "VALIDATION.INVALID_INPUT" });
      expect(events).toEqual([]);
      const created = await kernel.submitForm(context, "create_note", {
        values: { note: "A note" },
      });
      if (created.mode === "standalone") throw new Error("Expected a record Form");
      expect(events.map((item) => item.event)).toEqual(["record.created", "form.submitted"]);
      events.length = 0;
      await kernel.submitForm(context, "edit_note", {
        recordId: created.record.id,
        values: { enabled: false },
      });
      expect(events).toEqual([
        { event: "record.updated", field: null },
        { event: "record.field_changed", field: "enabled" },
        { event: "record.field_changed", field: "note" },
        { event: "form.submitted", field: null },
      ]);
      expect((await kernel.getRecord(context, "note", created.record.id))?.values.note).toBe(null);
    } finally {
      await kernel.close();
    }
  });
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
