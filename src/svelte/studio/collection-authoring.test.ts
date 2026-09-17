import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createCollectionActions } from "./collection-authoring.js";

describe("Collection authoring", () => {
  it("applies focused canonical mutations while preserving stable references", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    await client.applySpec({
      ...root.workspace.spec,
      collections: [
        {
          id: "collection-project",
          key: "project",
          label: "Project",
          fields: [
            { id: "field-title", key: "title", label: "Title", type: "text" },
            {
              id: "field-status",
              key: "status",
              label: "Status",
              type: "choice",
              options: [
                { id: "option-draft", key: "draft", label: "Draft" },
                { id: "option-active", key: "active", label: "Active" },
              ],
            },
          ],
        },
      ],
      views: [
        {
          id: "view-projects",
          key: "projects",
          label: "Projects",
          source: "project",
          query: { select: [{ path: ["field-status"], as: "status" }] },
        },
      ],
      rules: [
        {
          id: "rule-activate",
          key: "activate",
          label: "Activate",
          input: { project: { sourceId: "collection-project" } },
          steps: [
            {
              id: "step-update",
              action: {
                key: "records.update",
                input: {
                  record: { $ref: "vars.project" },
                  values: { "field-status": "active" },
                },
              },
            },
          ],
        },
      ],
    });
    let changed = 0;
    const actions = createCollectionActions(client, { onChange: () => void (changed += 1) });

    await actions.rename("project", "engagement");
    await actions.renameField("engagement", "status", "state");
    await actions.saveField("engagement", {
      key: "state",
      label: "Stage",
      type: "enum",
      values: ["draft", "active", "complete"],
    });
    await actions.reorderFields("engagement", ["state", "title"]);
    await actions.save({
      key: "engagement",
      label: "Engagement",
      collection_label: "Engagements",
      lifecycle: {
        field: "state",
        initial: "draft",
        terminal: ["complete"],
        transitions: [
          { key: "start", label: "Start", from: ["draft"], to: "active" },
          { key: "complete", label: "Complete", from: ["active"], to: "complete" },
        ],
      },
    });

    const spec = (await client.getWorkspace()).spec;
    expect(changed).toBe(5);
    expect(spec.collections[0]).toMatchObject({
      id: "collection-project",
      key: "engagement",
      label: "Engagement",
      collectionLabel: "Engagements",
      fields: [
        { id: "field-status", key: "state", label: "Stage" },
        { id: "field-title", key: "title" },
      ],
      lifecycle: { fieldId: "field-status", initial: "draft", terminal: ["complete"] },
    });
    expect(spec.views[0]).toMatchObject({
      source: "engagement",
      query: { select: [{ path: ["field-status"] }] },
    });
    expect(spec.rules[0]?.steps[0]).toMatchObject({
      action: { input: { values: { "field-status": "active" } } },
    });
    expect(spec.collections[0]?.lifecycle?.transitions.every((item) => item.id)).toBe(true);
    await kernel.close();
  });

  it("rejects incomplete field orders before touching the Spec", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    await client.applySpec({
      ...root.workspace.spec,
      collections: [
        {
          id: "collection-project",
          key: "project",
          label: "Project",
          fields: [{ id: "field-title", key: "title", label: "Title", type: "text" }],
        },
      ],
    });

    await expect(createCollectionActions(client).reorderFields("project", [])).rejects.toThrow(
      "every Collection Field exactly once",
    );
    expect((await client.getWorkspace()).spec.collections[0]?.fields).toHaveLength(1);
    await kernel.close();
  });
});
