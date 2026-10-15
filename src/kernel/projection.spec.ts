import { describe, expect, it } from "vite-plus/test";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { Kernel } from "./kernel.ts";
import type { CollectionDefinition, SourceQueryDefinition } from "../spec/model.ts";

describe.each([
  ["memory", () => new MemoryPersistenceAdapter()],
  ["SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite())],
] as const)("%s nested projections", (_name, persistence) => {
  it("preserves nested outputs through Views, joins, renames and snapshots", async () => {
    let denyRelated = false;
    const kernel = await Kernel.open({
      persistence: persistence(),
      authorizer: {
        authorize: async (request) => ({
          allowed: !(
            denyRelated &&
            request.operation === "records.list" &&
            request.resource.id === "projects"
          ),
        }),
      },
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Work",
        user: { name: "Owner" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      const collections: CollectionDefinition[] = [
        {
          id: "projects",
          key: "project",
          label: "Project",
          fields: [
            { id: "name", key: "name", label: "Name", type: "text" },
            { id: "note", key: "note", label: "Note", type: "text" },
          ],
        },
        {
          id: "tasks",
          key: "task",
          label: "Task",
          fields: [
            { id: "title", key: "title", label: "Title", type: "text" },
            {
              id: "project",
              key: "project",
              label: "Project",
              type: "reference",
              sourceId: "projects",
            },
          ],
        },
      ];
      const query: SourceQueryDefinition = {
        sort: [{ path: ["title"], direction: "asc" }],
        select: [
          { path: ["title"], as: "title" },
          { path: ["project"], as: ["project", "id"] },
          { path: ["project", "name"], as: ["project", "name"] },
        ],
      };
      const spec = {
        ...workspace.spec,
        collections,
        views: [{ id: "overview", key: "overview", label: "Overview", source: "task", query }],
      };
      await kernel.applySpec(context, spec);
      const project = await kernel.createRecord(context, "project", {
        name: "Launch",
        note: "Not selected",
      });
      await kernel.createRecord(context, "task", { title: "Prepare launch", project: project.id });
      await kernel.createRecord(context, "task", { title: "Unassigned", project: null });
      const first = await kernel.queryView(context, "overview");
      expect(first.data.rows[0]?.values).toEqual({
        title: "Prepare launch",
        project: { id: project.id, name: "Launch" },
      });
      expect(first.data.rows[1]?.values).toEqual({ title: "Unassigned", project: { id: null } });
      expect(first.data.columns).toContainEqual(
        expect.objectContaining({ key: "project.name", outputPath: ["project", "name"] }),
      );
      const joined = await kernel.querySource(context, "task", {
        ...query,
        filter: { path: ["project", "name"], operator: "eq", value: "Launch" },
        sort: [{ path: ["project", "name"], direction: "asc" }],
        limit: 1,
      });
      expect(joined.total).toBe(1);
      expect(joined.rows[0]?.values).toEqual(first.data.rows[0]?.values);
      await kernel.applySpec(context, {
        ...spec,
        collections: collections.map((collection) =>
          collection.id !== "projects"
            ? collection
            : {
                ...collection,
                fields: collection.fields.map((field) =>
                  field.id === "name" ? { ...field, key: "heading" } : field,
                ),
              },
        ),
      });
      expect((await kernel.queryView(context, "overview")).data.rows[0]?.values).toEqual(
        first.data.rows[0]?.values,
      );
      await kernel.executeAction(context, "views.snapshot", {
        viewId: "overview",
        label: "Copy",
        key: "copy",
      });
      expect(
        (await kernel.querySource(context, "copy")).rows.map((row) => row.values),
      ).toContainEqual(
        expect.objectContaining({
          title: "Prepare launch",
          project_id: project.id,
          project_name: "Launch",
        }),
      );
      denyRelated = true;
      await expect(kernel.queryView(context, "overview")).rejects.toMatchObject({
        code: "PERMISSION.DENIED",
      });
      await expect(
        kernel.querySource(context, "task", {
          ...query,
          sort: [{ path: ["project", "name"], direction: "asc" }],
        }),
      ).rejects.toMatchObject({ code: "PERMISSION.DENIED" });
    } finally {
      await kernel.close();
    }
  });
});
