import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { Kernel } from "./kernel.ts";
import type { RecordPolicy } from "./record-policy.ts";

describe.each([
  ["Memory", () => new MemoryPersistenceAdapter()],
  ["SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite())],
] as const)("%s record policies", (_name, persistence) => {
  it("enforces one optional policy across CRUD, Views, Forms, Actions, and relations", async () => {
    const policy: RecordPolicy = {
      collectionId: "tasks",
      readFilter(context) {
        const scope = context.scope?.kind === "topic" ? context.scope.id : undefined;
        return scope ? { path: ["topic"], operator: "eq", value: scope } : { any: [] };
      },
      authorize({ context, operation, current, values }) {
        const scope = context.scope?.kind === "topic" ? context.scope.id : undefined;
        if (!scope) return false;
        if (operation === "create") return values?.topic === scope;
        if (current?.values.topic !== scope) return false;
        return operation !== "update" || values?.topic === scope;
      },
    };
    const kernel = await Kernel.open({
      persistence: persistence(),
      recordPolicies: [policy],
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Team",
        user: { name: "Jane" },
      });
      const root = { workspaceId: workspace.id, actorId: user.id };
      const alpha = { ...root, scope: { kind: "topic", id: "alpha" } };
      const beta = { ...root, scope: { kind: "topic", id: "beta" } };
      await kernel.applySpec(root, {
        ...workspace.spec,
        collections: [
          {
            id: "tasks",
            key: "tasks",
            label: "Tasks",
            fields: [{ id: "topic", key: "topic", label: "Topic", type: "text", required: true }],
          },
          {
            id: "links",
            key: "links",
            label: "Links",
            fields: [
              {
                id: "linked-task",
                key: "task",
                label: "Task",
                type: "reference",
                sourceId: "tasks",
              },
            ],
          },
        ],
        views: [{ id: "tasks-view", key: "tasks", label: "Tasks", source: "tasks", query: {} }],
        forms: [
          {
            id: "task-form",
            key: "new_task",
            label: "New task",
            mode: "create",
            collectionId: "tasks",
            fieldIds: ["topic"],
          },
        ],
      });
      const a = await kernel.createRecord(alpha, "tasks", { topic: "alpha" });
      const b = await kernel.createRecord(beta, "tasks", { topic: "beta" });
      await kernel.createRecord(beta, "links", { task: b.id });
      await expect(kernel.createRecord(alpha, "links", { task: b.id })).rejects.toMatchObject({
        code: ERROR_CODES.validationInvalidInput,
      });
      const related = await kernel.querySource(alpha, "links", {
        select: [{ path: ["linked-task", "topic"], as: "topic" }],
      });
      expect(related.rows.some((row) => row.values.topic === "beta")).toBe(false);
      const aggregate = await kernel.querySource(alpha, "tasks", {
        aggregate: {
          group: { path: ["topic"], as: "topic" },
          measures: [{ as: "count", operation: "count" }],
        },
      });
      expect(aggregate.rows[0]?.values.count).toBe(1);

      expect((await kernel.listRecords(alpha, "tasks")).map((record) => record.id)).toEqual([a.id]);
      expect((await kernel.queryView(beta, "tasks")).data.rows.map((row) => row.id)).toEqual([
        b.id,
      ]);
      expect(
        await kernel.executeAction(alpha, "records.list", { sourceId: "tasks" }),
      ).toMatchObject([{ id: a.id }]);
      await expect(kernel.getRecord(alpha, "tasks", b.id)).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await expect(kernel.createRecord(alpha, "tasks", { topic: "beta" })).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
      await expect(
        kernel.submitForm(alpha, "new_task", { values: { topic: "beta" } }),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      await expect(
        kernel.updateRecord(alpha, "tasks", a.id, { topic: "beta" }),
      ).rejects.toMatchObject({ code: ERROR_CODES.permissionDenied });
      await expect(kernel.deleteRecord(alpha, "tasks", b.id)).rejects.toMatchObject({
        code: ERROR_CODES.permissionDenied,
      });
    } finally {
      await kernel.close();
    }
  });

  it("requires no policy ceremony for ordinary Collections", async () => {
    const kernel = await Kernel.open({ persistence: persistence() });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Personal",
        user: { name: "Jane" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      await kernel.applySpec(context, {
        ...workspace.spec,
        collections: [{ id: "notes", key: "notes", label: "Notes", fields: [] }],
      });
      await expect(kernel.createRecord(context, "notes", {})).resolves.toMatchObject({
        collectionId: "notes",
      });
    } finally {
      await kernel.close();
    }
  });
});

describe("SQLite queryable record policy boundary", () => {
  it("rejects a list-read policy that cannot be composed into SQL", async () => {
    const kernel = await Kernel.open({
      persistence: new SqlitePersistenceAdapter(() => openNodeSqlite()),
      recordPolicies: [{ collectionId: "notes", authorize: () => true }],
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Space",
        user: { name: "Owner" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      await kernel.applySpec(context, {
        ...workspace.spec,
        collections: [{ id: "notes", key: "notes", label: "Notes", fields: [] }],
      });
      await expect(kernel.querySource(context, "notes", { limit: 20 })).rejects.toMatchObject({
        code: "SOURCE.CAPABILITY_UNSUPPORTED",
      });
      await expect(kernel.listRecords(context, "notes")).rejects.toMatchObject({
        code: "SOURCE.CAPABILITY_UNSUPPORTED",
      });
    } finally {
      await kernel.close();
    }
  });
});
