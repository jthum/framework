import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import type { PersistenceAdapter } from "./catalog.ts";
import type { CollectionRecord } from "./records.ts";

export function recordStoreContract(name: string, createAdapter: () => PersistenceAdapter): void {
  describe(`${name} RecordStore contract`, () => {
    it("applies a Collection schema and persists detached record values", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const collection = taskCollection();
      await persistence.records.applySchema("workspace-1", [collection]);
      const record = taskRecord(collection.id, "record-1", "Write tests");

      await persistence.records.create("workspace-1", collection, record);
      (record.values as { title: string }).title = "Changed outside the adapter";
      const firstRead = await persistence.records.get("workspace-1", collection, record.id);
      expect(firstRead?.values.title).toBe("Write tests");
      expect(
        await persistence.records.getMany("workspace-1", collection, [
          record.id,
          "missing",
          record.id,
        ]),
      ).toEqual([
        expect.objectContaining({ id: record.id, values: { title: "Write tests", priority: 1 } }),
        expect.objectContaining({ id: record.id, values: { title: "Write tests", priority: 1 } }),
      ]);

      if (!firstRead) throw new Error("Contract fixture Record was not persisted.");
      (firstRead.values as { title: string }).title = "Changed after reading";
      expect(
        (await persistence.records.get("workspace-1", collection, record.id))?.values.title,
      ).toBe("Write tests");

      await persistence.records.update("workspace-1", collection, {
        ...(await persistence.records.get("workspace-1", collection, record.id))!,
        values: { title: "Ship tests", priority: 2 },
        updatedAt: "2026-09-17T01:00:00.000Z",
      });
      expect(await persistence.records.list("workspace-1", collection)).toEqual([
        expect.objectContaining({ values: { title: "Ship tests", priority: 2 } }),
      ]);

      await persistence.records.delete("workspace-1", collection, record.id);
      expect(await persistence.records.get("workspace-1", collection, record.id)).toBeNull();
      await persistence.close();
    });

    it("isolates identical Collection definitions between Workspaces", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const collection = taskCollection();
      await persistence.records.applySchema("workspace-a", [collection]);
      await persistence.records.applySchema("workspace-b", [collection]);
      await persistence.records.create(
        "workspace-a",
        collection,
        taskRecord(collection.id, "record-1", "Private to A"),
      );

      expect(await persistence.records.list("workspace-a", collection)).toHaveLength(1);
      expect(await persistence.records.list("workspace-b", collection)).toEqual([]);
      await persistence.close();
    });

    it("lists records in stable creation-time and ID order", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const collection = taskCollection();
      await persistence.records.applySchema("workspace-1", [collection]);
      for (const record of [
        taskRecord(collection.id, "record-2", "Second lexical ID"),
        taskRecord(collection.id, "record-10", "First lexical ID"),
        {
          ...taskRecord(collection.id, "record-z", "Earlier"),
          createdAt: "2026-09-16T00:00:00.000Z",
        },
      ])
        await persistence.records.create("workspace-1", collection, record);

      expect(
        (await persistence.records.list("workspace-1", collection)).map((record) => record.id),
      ).toEqual(["record-z", "record-10", "record-2"]);
      await persistence.close();
    });

    it("preserves data through stable Collection and Field key renames", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const collection = taskCollection();
      await persistence.records.applySchema("workspace-1", [collection]);
      await persistence.records.create(
        "workspace-1",
        collection,
        taskRecord(collection.id, "record-1", "Keep me"),
      );
      const renamed: CollectionDefinition = {
        ...collection,
        key: "work_item",
        fields: [
          ...collection.fields.map((field) =>
            field.id === "field-title" ? { ...field, key: "summary" } : field,
          ),
          {
            id: "field-ready",
            key: "ready",
            label: "Ready",
            type: "boolean",
            default: false,
          },
        ],
      };

      await persistence.records.applySchema("workspace-1", [renamed]);

      expect(await persistence.records.get("workspace-1", renamed, "record-1")).toMatchObject({
        collectionId: collection.id,
        values: { summary: "Keep me", priority: 1, ready: false },
      });
      await persistence.close();
    });

    it("removes persisted data when a Collection leaves the Spec", async () => {
      expect.hasAssertions();
      const persistence = await createAdapter().open();
      const collection = taskCollection();
      await persistence.records.applySchema("workspace-1", [collection]);
      await persistence.records.create(
        "workspace-1",
        collection,
        taskRecord(collection.id, "record-1", "Delete me"),
      );

      await persistence.records.applySchema("workspace-1", []);

      await expect(persistence.records.list("workspace-1", collection)).rejects.toMatchObject({
        code: ERROR_CODES.resourceNotFound,
      });
      await persistence.close();
    });
  });
}

function taskCollection(): CollectionDefinition {
  return {
    id: "collection-task",
    key: "task",
    label: "Task",
    fields: [
      { id: "field-title", key: "title", label: "Title", type: "text", required: true },
      { id: "field-priority", key: "priority", label: "Priority", type: "number" },
    ],
  };
}

function taskRecord(
  collectionId: string,
  id: string,
  title: string,
): CollectionRecord & { values: { title: string; priority: number } } {
  return {
    id,
    collectionId,
    values: { title, priority: 1 },
    createdAt: "2026-09-17T00:00:00.000Z",
    updatedAt: "2026-09-17T00:00:00.000Z",
    createdBy: "actor-1",
    updatedBy: "actor-1",
  };
}
