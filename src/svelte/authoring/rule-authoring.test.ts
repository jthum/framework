import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createRule, createRuleActions } from "./rule-authoring.js";

describe("Rule authoring", () => {
  it("persists friendly Rule drafts with stable canonical identities", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    const project = {
      id: "collection-project",
      key: "project",
      label: "Project",
      fields: [
        {
          id: "field-status",
          key: "status",
          label: "Status",
          type: "text" as const,
        },
      ],
    };
    await client.applySpec({ ...root.workspace.spec, collections: [project] });
    let changed = 0;
    const options = {
      schemas: { project },
      onChange: () => void (changed += 1),
    };
    const created = await createRule(
      client,
      {
        key: "finish_project",
        label: "Finish project",
        input: { project: { record: "project" } },
        expose: ["ui"],
        steps: [
          {
            effect: {
              key: "records.set",
              params: {
                record: { $ref: "vars.project" },
                values: { status: "done" },
              },
            },
          },
        ],
      },
      options,
    );
    expect(created).toMatchObject({
      input: { project: { sourceId: "collection-project" } },
      steps: [
        {
          action: {
            key: "records.update",
            input: { values: { "field-status": "done" } },
          },
        },
      ],
    });
    const actions = createRuleActions(client, options);
    await actions.save({
      id: "replacement-is-ignored",
      key: "finish_project",
      label: "Complete project",
      input: { project: { record: "project" } },
      expose: ["ui"],
      steps: [],
    });
    expect((await client.getWorkspace()).spec.rules[0]).toMatchObject({
      id: created.id,
      label: "Complete project",
    });
    await actions.remove("finish_project");
    expect((await client.getWorkspace()).spec.rules).toEqual([]);
    expect(changed).toBe(3);
    await kernel.close();
  });
});
