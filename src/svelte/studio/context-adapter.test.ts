import { describe, expect, it } from "vite-plus/test";
import type { CollectionDefinition, Spec } from "@jthum/framework/spec";
import { createEmptySpec } from "@jthum/framework/spec";
import { editorContextFromSpec } from "./context-adapter.js";

function fixture(): Spec {
  const empty = createEmptySpec({ id: "spec-work", key: "work", label: "Work" });
  return {
    ...empty,
    collections: [
      {
        id: "collection-task",
        key: "task",
        label: "Task",
        fields: [
          { id: "field-title", key: "title", label: "Title", type: "text" },
          {
            id: "field-client",
            key: "client",
            label: "Client",
            type: "reference",
            sourceId: "source-client",
          },
          {
            id: "field-status",
            key: "status",
            label: "Status",
            type: "choice",
            options: [
              { id: "option-open", key: "open", label: "Open" },
              { id: "option-done", key: "done", label: "Done" },
            ],
          },
        ],
        lifecycle: {
          fieldId: "field-status",
          initial: "open",
          terminal: ["done"],
          transitions: [
            {
              id: "transition-complete",
              key: "complete",
              label: "Complete",
              from: ["open"],
              to: "done",
            },
          ],
        },
      },
    ],
    sources: [{ id: "source-client", key: "client", label: "Client" }],
    views: [
      {
        id: "view-client",
        key: "clients",
        label: "Clients",
        source: "client",
        query: { select: [{ path: ["field-client-name"], as: "name", label: "Name" }] },
      },
    ],
    forms: [
      {
        id: "form-create-task",
        key: "create_task",
        label: "Create task",
        mode: "create",
        collectionId: "collection-task",
        fieldIds: ["field-title", "field-client"],
      },
      {
        id: "form-lead",
        key: "lead",
        label: "Lead",
        mode: "standalone",
        fields: [{ id: "field-email", key: "email", label: "Email", type: "text" }],
      },
    ],
    rules: [],
  };
}

const clients: CollectionDefinition = {
  id: "origin-client",
  key: "client",
  label: "Origin clients",
  fields: [{ id: "field-client-name", key: "name", label: "Name", type: "text" }],
};

describe("Studio context adapter", () => {
  it("projects canonical identities, lifecycle, Forms, and attached Source schemas", () => {
    const context = editorContextFromSpec(fixture(), { schemas: { client: clients } });

    expect(context.collections).toHaveLength(2);
    expect(context.collections[0]).toMatchObject({
      id: "collection-task",
      fields: expect.arrayContaining([
        expect.objectContaining({ key: "title" }),
        expect.objectContaining({ key: "client", target: "client" }),
      ]),
      lifecycle: {
        field: "status",
        transitions: [{ id: "transition-complete", key: "complete" }],
      },
    });
    expect(context.collections[1]).toMatchObject({
      id: "source-client",
      key: "client",
      label: "Client",
      fields: [{ id: "field-client-name", key: "name" }],
    });
    expect(context.views[0]).toMatchObject({ source: "client", fields: ["name"] });
    expect(context.forms).toEqual([
      expect.objectContaining({ type: "task", fields: ["title", "client"] }),
      expect.objectContaining({ inputs: [expect.objectContaining({ id: "field-email" })] }),
    ]);
  });

  it("omits an unavailable attached schema but rejects Views that require it", () => {
    const spec = fixture();
    expect(() => editorContextFromSpec({ ...spec, views: [] })).not.toThrow();
    expect(() => editorContextFromSpec(spec)).toThrow("Source schema client is unavailable");
  });

  it("rejects fields that Studio cannot preserve", () => {
    const spec = fixture();
    const collection = spec.collections[0]!;
    expect(() =>
      editorContextFromSpec(
        {
          ...spec,
          collections: [
            {
              ...collection,
              fields: [
                ...collection.fields,
                { id: "field-payload", key: "payload", label: "Payload", type: "json" },
              ],
            },
          ],
        },
        { schemas: { client: clients } },
      ),
    ).toThrow("does not yet edit JSON fields");
  });
});
