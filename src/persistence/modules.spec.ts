import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { Kernel } from "../kernel/kernel.ts";
import { MemoryPersistenceAdapter } from "./memory.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import {
  entityAnd,
  entityEqual,
  entityField,
  entityValue,
  type EntityId,
  type EntityRow,
  type ModuleSchema,
  type ModuleTransaction,
} from "./modules.ts";

const schema = {
  id: "documents",
  requires: ["transactions", "joins", "unions", "aggregates", "latest", "traversal", "sampling"],
  entities: {
    folders: { fields: { title: { type: "text" } } },
    entries: {
      fields: {
        folderId: { type: "id", references: { entity: "folders" } },
        parentId: { type: "id", optional: true, references: { entity: "entries" } },
        title: { type: "text" },
        revision: { type: "number", generated: "sequence" },
        enabled: { type: "boolean" },
        payload: { type: "json" },
        "owner.name": { type: "text", optional: true },
        tag: { type: "text", optional: true },
      },
      indexes: [{ fields: ["folderId", "revision"] }, { fields: ["tag"], unique: true }],
    },
    links: {
      fields: {
        retainedId: {
          type: "id",
          optional: true,
          references: { entity: "entries", onDelete: "setNull" },
        },
        removedId: {
          type: "id",
          optional: true,
          references: { entity: "entries", onDelete: "cascade" },
        },
        key: { type: "text", optional: true },
      },
      indexes: [{ fields: ["key"], unique: true }],
    },
  },
} satisfies ModuleSchema;
const closing: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(closing.splice(0).map((close) => close()));
});

for (const [name, create] of Object.entries({
  memory: () => new MemoryPersistenceAdapter(),
  sqlite: () => new SqlitePersistenceAdapter(() => openNodeSqlite()),
}))
  describe(`${name} host module persistence`, () => {
    async function setup() {
      const kernel = await Kernel.open({ persistence: create() });
      const close = () => kernel.close();
      closing.push(close);
      const root = await kernel.createRootWorkspace({ name: "Home", user: { name: "Jane" } });
      const actorId = root.user.id;
      const { workspace } = await kernel.createWorkspace(
        { workspaceId: root.workspace.id, actorId },
        { name: "Child" },
      );
      const module = await kernel.openModuleStorage(schema);
      const store = module.workspace(workspace.id);
      await store.insert("folders", { id: "folder", title: "Folder" });
      return { kernel, module, store, workspace, actorId, close };
    }
    const input = (tag: string, extra: object = {}) => ({
      folderId: "folder",
      title: tag,
      enabled: true,
      payload: null,
      tag,
      ...extra,
    });
    it("resets only the selected development module, including references, and accepts a fresh incompatible declaration", async () => {
      const { kernel, workspace, actorId, store } = await setup();
      const entry = await store.insert("entries", input("old"));
      await store.insert("links", { key: "retained", retainedId: entry.id });
      const other = (
        await kernel.openModuleStorage({
          id: "other",
          entities: { notes: { fields: { body: { type: "text" } } } },
        })
      ).workspace(workspace.id);
      const note = await other.insert<{ id: EntityId; body: string }>("notes", { body: "Keep me" });
      const changed = {
        id: schema.id,
        entities: { ...schema.entities, folders: { fields: { name: { type: "text" } } } },
      } satisfies ModuleSchema;
      await expect(kernel.openModuleStorage(changed)).rejects.toMatchObject({
        code: "RESOURCE.CONFLICT",
        details: { moduleId: schema.id, entity: "folders", recovery: "reset_module" },
      });
      await kernel.resetModuleStorage(schema.id);
      await kernel.resetModuleStorage(schema.id);
      const fresh = (await kernel.openModuleStorage(changed)).workspace(workspace.id);
      expect(await fresh.query({ from: "folders" })).toEqual([]);
      await fresh.insert("folders", { name: "Fresh" });
      expect(await other.get("notes", note.id)).toMatchObject({ body: "Keep me" });
      expect(await kernel.getWorkspace({ workspaceId: workspace.id, actorId })).toMatchObject({
        id: workspace.id,
      });
    });

    it("registers additional entities atomically without modifying existing schemas or data", async () => {
      const { kernel, workspace, store } = await setup();
      const before = await store.insert("entries", input("before"));
      const expanded: ModuleSchema = {
        ...schema,
        entities: {
          ...schema.entities,
          notes: {
            fields: {
              entryId: {
                type: "id",
                optional: true,
                references: { entity: "entries", onDelete: "setNull" },
              },
              body: { type: "text" },
            },
          },
        },
      };
      const next = (await kernel.openModuleStorage(expanded)).workspace(workspace.id);
      expect(await next.get("entries", before.id as number)).toEqual(before);
      const note = await next.insert("notes", { entryId: before.id, body: "Note" });
      await store.delete("entries", before.id as number);
      expect(await next.get("notes", note.id as number)).toEqual({
        id: note.id,
        workspaceId: workspace.id,
        body: "Note",
      });
      await kernel.openModuleStorage(expanded);
      await expect(kernel.openModuleStorage(schema)).rejects.toMatchObject({
        code: "RESOURCE.CONFLICT",
      });
      await expect(
        kernel.openModuleStorage({
          ...expanded,
          entities: { ...expanded.entities, notes: { fields: { renamed: { type: "text" } } } },
        }),
      ).rejects.toMatchObject({ code: "RESOURCE.CONFLICT" });
      expect(await next.get("notes", note.id as number)).toMatchObject({ body: "Note" });
    });

    it("preserves native identity, typed/nested data and Workspace isolation across all operations", async () => {
      const { module, store } = await setup();
      const first = await store.insert(
        "entries",
        input("one", { owner: { name: "Jane" }, payload: { arbitrary: [3, "3"] } }),
      );
      expect(typeof first.id).toBe("number");
      const second = await store.insert("entries", input("two", { id: String(first.id) }));
      expect(second.id).toBe(String(first.id));
      expect(await store.get("entries", first.id as number)).toEqual(first);
      expect(await store.get("entries", second.id as string)).toEqual(second);
      const other = module.workspace("other");
      expect(await other.get("entries", first.id as number)).toBeNull();
      await expect(other.insert("entries", input("bad"))).rejects.toMatchObject({
        code: "RESOURCE.CONFLICT",
      });
      const changed = await store.update("entries", first.id as number, {
        owner: null,
        enabled: false,
      });
      expect(changed.owner).toBeUndefined();
      expect(changed.enabled).toBe(false);
      await expect(
        store.update("entries", first.id as number, { workspaceId: "other" }),
      ).rejects.toMatchObject({ code: "VALIDATION.INVALID_INPUT" });
      expect(
        await store.query({ from: "entries", where: entityEqual("id", second.id as string) }),
      ).toEqual([second]);
    });

    it("rolls back batches and concurrent claims, expires transaction handles and retains provider sequences", async () => {
      const { store } = await setup();
      let escaped: ModuleTransaction | undefined;
      await expect(
        store.transaction(async (tx) => {
          escaped = tx;
          await tx.insertMany("entries", [input("unique"), input("unique")]);
        }),
      ).rejects.toMatchObject({ code: "RESOURCE.CONFLICT" });
      expect(await store.query({ from: "entries" })).toEqual([]);
      await expect(escaped!.query({ from: "entries" })).rejects.toMatchObject({
        code: "VALIDATION.INVALID_INPUT",
      });
      const row = await store.insert("entries", input("claim"));
      const claim = (owner: string) =>
        store.transaction(async (tx) => {
          const existing = await tx.get<EntityRow>("entries", row.id as number);
          if (existing!.owner) throw new Error("Already claimed");
          await tx.update("entries", row.id as number, { owner: { name: owner } });
        });
      const results = await Promise.allSettled([claim("A"), claim("B")]);
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      await store.delete("entries", row.id as number);
      const next = await store.insert("entries", input("next"));
      expect(Number(next.revision)).toBeGreaterThan(Number(row.revision));
    });

    it("executes latest-per-group, joins, aggregation, union ordering and sparse sampling before limits", async () => {
      const { store } = await setup();
      await store.insertMany(
        "entries",
        Array.from({ length: 12 }, (_, index) =>
          input(`tag-${index}`, { title: `title-${index % 3}`, enabled: index % 2 === 0 }),
        ),
      );
      const orderBy = [{ expression: entityField("revision"), direction: "desc" as const }];
      const latest = await store.query({ from: "entries", latestBy: ["title"], orderBy, limit: 2 });
      expect(latest.map((row) => row.revision)).toEqual([12, 11]);
      const summaries = await store.query({
        from: "entries",
        joins: [
          {
            entity: "folders",
            as: "folder",
            on: { op: "eq", left: entityField("folderId"), right: entityField("id", "folder") },
          },
        ],
        select: { folder: entityField("title", "folder") },
        groupBy: [entityField("title", "folder")],
        aggregate: {
          count: { op: "count" },
          enabled: { op: "count", where: entityEqual("enabled", true) },
        },
      });
      expect(summaries).toEqual([{ folder: "Folder", count: 12, enabled: 6 }]);
      const latestTwo = await store.query({
        from: "entries",
        latestBy: ["title"],
        limitPerGroup: 2,
        orderBy,
      });
      expect(latestTwo.map((row) => row.revision)).toEqual([12, 11, 10, 9, 8, 7]);
      const union = await store.query({
        union: [
          {
            from: "entries",
            where: entityEqual("enabled", true),
            select: { title: entityField("title"), rank: entityField("revision") },
          },
          { from: "folders", select: { title: entityField("title"), rank: entityValue(20) } },
        ],
        orderBy: [{ expression: entityField("rank"), direction: "desc" }],
        limit: 2,
      });
      expect(union.map((row) => row.rank)).toEqual([20, 11]);
      const landmarks = await store.query({
        from: "entries",
        orderBy: [{ expression: entityField("revision") }],
        sample: 5,
        select: { id: entityField("id"), excerpt: { slice: entityField("title"), length: 5 } },
      });
      expect(landmarks.map((row) => row.ordinal)).toEqual([0, 3, 6, 8, 11]);
      expect(landmarks.every((row) => row.total === 12 && row.excerpt === "title")).toBe(true);
    });

    it("traverses nested/self references without cycles and cleans module data with its Workspace", async () => {
      const { kernel, module, store, workspace, actorId, close } = await setup();
      const root = await store.insert("entries", input("root"));
      const child = await store.insert("entries", input("child", { parentId: root.id }));
      const leaf = await store.insert("entries", input("leaf", { parentId: child.id }));
      await store.update("entries", root.id as number, { parentId: leaf.id });
      const path = await store.query({
        from: "entries",
        traverse: {
          parentField: "parentId",
          roots: [leaf.id as number],
          direction: "ancestors",
          includeRoots: true,
        },
        select: { id: entityField("id"), depth: entityField("depth", "traversal") },
        orderBy: [{ expression: entityField("depth", "traversal") }],
      });
      expect(path.map((row) => row.id)).toEqual([leaf.id, child.id, root.id]);
      const counts = await store.query({
        from: "entries",
        traverse: { parentField: "parentId", roots: [root.id as number], direction: "descendants" },
        where: entityAnd(entityEqual("enabled", true), {
          op: "gt",
          left: entityField("depth", "traversal"),
          right: entityValue(0),
        }),
        aggregate: { count: { op: "count" } },
      });
      expect(counts).toEqual([{ count: 2 }]);
      await kernel.deleteWorkspace({ workspaceId: workspace.id, actorId });
      expect(await module.workspace(workspace.id).query({ from: "entries" })).toEqual([]);
      await kernel.close();
      closing.splice(closing.indexOf(close), 1);
      await expect(store.query({ from: "entries" })).rejects.toMatchObject({
        code: "VALIDATION.INVALID_INPUT",
      });
    });

    it("enforces nullable uniqueness/upsert and reference deletion atomically without losing Workspace identity", async () => {
      const { store } = await setup();
      const root = await store.insert("entries", input("root"));
      const child = await store.insert("entries", input("child", { parentId: root.id }));
      const retained = await store.upsert("links", ["key"], { retainedId: root.id });
      expect((await store.upsert("links", ["key"], { retainedId: child.id })).id).toBe(retained.id);
      await expect(store.insert("links", {})).rejects.toMatchObject({
        code: "RESOURCE.CONFLICT",
      });
      await store.update("links", retained.id as number, { retainedId: root.id });
      const removed = await store.insert("links", {
        key: "cascade",
        retainedId: root.id,
        removedId: root.id,
      });
      await expect(store.delete("entries", root.id as number)).rejects.toMatchObject({
        code: "RESOURCE.CONFLICT",
      });
      expect((await store.get("links", retained.id as number))!.retainedId).toBe(root.id);
      await store.update("entries", child.id as number, { parentId: null });
      await store.delete("entries", root.id as number);
      expect(await store.get("links", removed.id as number)).toBeNull();
      expect(await store.get("links", retained.id as number)).toEqual({
        id: retained.id,
        workspaceId: retained.workspaceId,
      });
    });
  });

it("reopens SQLite module schemas and data without host DDL, preserving native IDs and provider sequence allocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "framework-module-"));
  const path = join(directory, "catalog.sqlite");
  let session = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();
  try {
    const store = (await session.modules.open(schema)).workspace("workspace");
    await store.insert("folders", { id: 1, title: "One" });
    await store.insert("folders", { id: "1", title: "String one" });
    const entry = await store.insert("entries", {
      folderId: 1,
      title: "Entry",
      enabled: false,
      payload: null,
      tag: "entry",
    });
    await session.close();
    session = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();
    const reordered = {
      ...schema,
      entities: Object.fromEntries(Object.entries(schema.entities).reverse()),
    };
    const reopened = (await session.modules.open(reordered)).workspace("workspace");
    expect(await reopened.get("entries", entry.id as number)).toEqual(entry);
    expect((await reopened.get("folders", 1))!.title).toBe("One");
    expect((await reopened.get("folders", "1"))!.title).toBe("String one");
    const next = await reopened.insert("entries", {
      folderId: 1,
      title: "Next",
      enabled: true,
      payload: { arbitrary: true },
      tag: "next",
    });
    expect(Number(next.revision)).toBeGreaterThan(Number(entry.revision));
    await expect(
      session.modules.open({
        ...schema,
        entities: { ...schema.entities, folders: { fields: { renamed: { type: "text" } } } },
      }),
    ).rejects.toMatchObject({ code: "RESOURCE.CONFLICT" });
  } finally {
    await session.close();
    await rm(directory, { recursive: true });
  }
});
