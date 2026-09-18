import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { Kernel } from "./kernel.ts";
import { createWorkspaceClient } from "../client/workspace-client.ts";
import type { ExecutionContext } from "./model.ts";

describe.each([
  ["Memory", () => new MemoryPersistenceAdapter()],
  ["SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite())],
] as const)("%s module scope", (_name, persistence) => {
  it("isolates topic Collections, Views, mutations, and relation reads without changing Spec", async () => {
    const kernel = await Kernel.open({ persistence: persistence() });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Team",
        user: { name: "Jane" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      const alpha = { ...context, scope: { kind: "topic", id: "alpha" } };
      const beta = { ...context, scope: { kind: "topic", id: "beta" } };
      const spec = {
        ...workspace.spec,
        collections: [
          { id: "alpha-tasks", key: "alpha_tasks", label: "Tasks", fields: [] },
          { id: "beta-tasks", key: "beta_tasks", label: "Tasks", fields: [] },
          { id: "people", key: "people", label: "People", fields: [] },
        ],
        views: [
          { id: "alpha-view", key: "alpha_view", label: "Tasks", source: "alpha_tasks", query: {} },
          { id: "beta-view", key: "beta_view", label: "Tasks", source: "beta_tasks", query: {} },
        ],
      };
      await kernel.applySpec(context, spec);
      await kernel.bindCollection(context, "alpha_tasks", alpha.scope);
      await kernel.bindCollection(context, "beta_tasks", beta.scope);
      const task = await kernel.createRecord(alpha, "alpha_tasks", {});
      const client = await createWorkspaceClient(kernel, alpha);
      expect((await client.queryView("alpha_view")).data.rows.map((row) => row.id)).toEqual([
        task.id,
      ]);
      await kernel.createRecord(beta, "beta_tasks", {});
      expect((await kernel.listSources(context)).map((source) => source.key)).toEqual(["people"]);
      expect((await kernel.listSources(alpha)).map((source) => source.key)).toEqual([
        "alpha_tasks",
        "people",
      ]);
      expect((await kernel.listViews(alpha)).map((view) => view.key)).toEqual(["alpha_view"]);
      expect((await kernel.queryView(alpha, "alpha_view")).data.rows.map((row) => row.id)).toEqual([
        task.id,
      ]);
      for (const other of [beta, context, { ...alpha, scope: { kind: "thread", id: "alpha" } }]) {
        await expect(kernel.getRecord(other, "alpha_tasks", task.id)).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
        await expect(kernel.createRecord(other, "alpha_tasks", {})).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
        await expect(kernel.updateRecord(other, "alpha_tasks", task.id, {})).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
        await expect(kernel.deleteRecord(other, "alpha_tasks", task.id)).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
        await expect(kernel.querySource(other, "alpha_tasks")).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
        await expect(kernel.queryView(other, "alpha_view")).rejects.toMatchObject({
          code: ERROR_CODES.resourceNotFound,
        });
      }
      await expect(kernel.querySource(alpha, "people")).resolves.toMatchObject({ rows: [] });
      expect((await kernel.getWorkspace(context))?.spec).toEqual(spec);
      await kernel.applySpec(context, {
        ...spec,
        views: [],
        collections: spec.collections.filter((collection) => collection.id !== "alpha-tasks"),
      });
      expect(await kernel.listCollectionScopes(context)).toEqual([
        { collectionId: "beta-tasks", scope: beta.scope },
      ]);
    } finally {
      await kernel.close();
    }
  });

  it("carries a module Event scope through a Rule and domain Action; scope never grants authority", async () => {
    const seen: ExecutionContext[] = [];
    const kernel = await Kernel.open({
      persistence: persistence(),
      actions: [
        {
          key: "topic.mark",
          run: async ({ context }) => {
            seen.push(context);
            return { done: true };
          },
        },
      ],
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Team",
        user: { name: "Jane" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      const scoped = { ...context, scope: { kind: "topic", id: "alpha" } };
      await kernel.applySpec(context, {
        ...workspace.spec,
        collections: [{ id: "tasks", key: "tasks", label: "Tasks", fields: [] }],
        rules: [
          {
            id: "on-post",
            key: "on_post",
            label: "On post",
            trigger: { event: "message.posted" },
            steps: [{ id: "mark", action: { key: "topic.mark", input: {} } }],
          },
        ],
      });
      await kernel.bindCollection(context, "tasks", scoped.scope);
      await kernel.dispatchEvent(scoped, { event: "message.posted", payload: { text: "Hello" } });
      expect(seen).toEqual([scoped]);
      const reader = await kernel.createActor(context, { name: "Reader", kind: "user" });
      await kernel.addMembership(context, {
        actorId: reader.id,
        workspaceId: workspace.id,
        permissions: ["read"],
      });
      const reading = { ...scoped, actorId: reader.id };
      await expect(kernel.createRecord(reading, "tasks", {})).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await expect(kernel.bindCollection(reading, "tasks", null)).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await expect(
        kernel.bindCollection(context, "tasks", { kind: "topic", id: "" }),
      ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
      await kernel.bindCollection(context, "tasks", null);
      await expect(kernel.createRecord(context, "tasks", {})).resolves.toMatchObject({
        collectionId: "tasks",
      });
    } finally {
      await kernel.close();
    }
  });
});
