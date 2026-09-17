import { describe, expect, it } from "vite-plus/test";
import { createWorkspaceClient } from "@jthum/framework/client";
import { Kernel } from "@jthum/framework/kernel";
import { MemoryPersistenceAdapter } from "@jthum/framework/persistence";
import { createViewActions } from "./view-authoring.js";

describe("View authoring", () => {
  it("saves, previews, duplicates, and removes canonical Views", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const context = { workspaceId: root.workspace.id, actorId: root.user.id };
    const client = await createWorkspaceClient(kernel, context);
    const project = {
      id: "collection-project",
      key: "project",
      label: "Project",
      fields: [
        { id: "field-title", key: "title", label: "Title", type: "text" as const },
        {
          id: "field-status",
          key: "status",
          label: "Status",
          type: "choice" as const,
          options: [
            { id: "option-active", key: "active", label: "Active" },
            { id: "option-paused", key: "paused", label: "Paused" },
          ],
        },
      ],
    };
    await client.applySpec({ ...root.workspace.spec, collections: [project] });
    await client.createRecord("project", { title: "Alpha", status: "active" });
    await client.createRecord("project", { title: "Beta", status: "paused" });
    let changed = 0;
    const actions = createViewActions(client, {
      schemas: { project },
      onChange: () => void (changed += 1),
    });

    await actions.save({
      key: "active_projects",
      label: "Active projects",
      source: "project",
      fields: ["title", "status"],
      where: [{ field: "status", op: "eq", value: "active" }],
    });
    const created = (await client.getWorkspace()).spec.views[0]!;
    await actions.save({
      key: "active_projects",
      label: "Current projects",
      source: "project",
      fields: ["title"],
      where: undefined,
    });
    const saved = (await client.getWorkspace()).spec.views[0]!;
    expect(saved).toMatchObject({ id: created.id, label: "Current projects" });

    const preview = await actions.query(
      {
        id: saved.id,
        key: saved.key,
        label: saved.label,
        source: "project",
        fields: ["title"],
        where: [{ field: "status", op: "eq", value: "paused" }],
      },
      {},
    );
    expect(preview).toEqual([expect.objectContaining({ title: "Beta" })]);
    expect((await client.getWorkspace()).spec.views[0]?.query?.filter).toBeUndefined();

    await actions.save({
      key: "project_copy",
      label: "Project copy",
      source: "project",
      fields: ["title"],
    });
    expect((await client.getWorkspace()).spec.views).toHaveLength(2);
    await actions.remove("project_copy");
    expect((await client.getWorkspace()).spec.views).toHaveLength(1);
    expect(changed).toBe(4);
    await kernel.close();
  });
});
