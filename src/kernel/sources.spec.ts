import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { PersistenceAdapter, PersistenceSession } from "../persistence/catalog.ts";
import { MemoryCatalogRepository, MemoryRecordStore } from "../persistence/memory.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import { Kernel } from "./kernel.ts";

describe("Source contract", () => {
  it("queries a local Collection and batches declared relationship traversal", async () => {
    expect.hasAssertions();
    const records = new TrackingRecordStore();
    const kernel = await Kernel.open({ persistence: memoryAdapter(records) });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const [clients, projects] = relationalCollections();
    await kernel.applySpec(context, { ...workspace.spec, collections: [clients, projects] });
    const acme = await kernel.createRecord(context, clients.key, { name: "Acme" });
    const beta = await kernel.createRecord(context, clients.key, { name: "Beta" });
    await kernel.createRecord(context, projects.key, {
      name: "Website",
      client: acme.id,
      status: "active",
    });
    await kernel.createRecord(context, projects.key, {
      name: "Campaign",
      client: beta.id,
      status: "active",
    });

    const descriptor = await kernel.getSource(context, "project");
    expect(descriptor?.capabilities).toMatchObject({ relations: true, suggestions: false });
    const result = await kernel.querySource(context, "project", {
      filter: { path: ["field-client", "field-client-name"], operator: "contains", value: "e" },
      sort: [{ path: ["field-client", "field-client-name"], direction: "desc" }],
      select: [
        { path: ["field-project-name"], as: "project_name" },
        { path: ["field-client", "field-client-name"], as: "client_name" },
      ],
    });
    expect(result.rows.map((row) => row.values)).toEqual([
      { project_name: "Campaign", client_name: "Beta" },
      { project_name: "Website", client_name: "Acme" },
    ]);
    expect(result.columns).toEqual([
      expect.objectContaining({ key: "project_name", label: "Name", type: "text" }),
      expect.objectContaining({ key: "client_name", label: "Name", type: "text" }),
    ]);
    const paged = await kernel.querySource(context, "project", { offset: 1, limit: 1 });
    expect(paged).toMatchObject({
      total: 2,
      rows: [expect.objectContaining({ id: expect.any(String) })],
    });
    expect(records.getManyCalls).toBe(1);
    await kernel.close();
  });

  it("rejects paths that are not declared reference traversal", async () => {
    expect.hasAssertions();
    const kernel = await Kernel.open({ persistence: memoryAdapter(new MemoryRecordStore()) });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Projects",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const collections = relationalCollections();
    await kernel.applySpec(context, { ...workspace.spec, collections });

    await expect(
      kernel.querySource(context, "project", {
        select: [{ path: ["field-project-name", "field-client-name"], as: "unrelated" }],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
    await kernel.close();
  });
});

class TrackingRecordStore extends MemoryRecordStore {
  getManyCalls = 0;

  override async getMany(
    workspaceId: string,
    collection: CollectionDefinition,
    recordIds: readonly string[],
  ): Promise<CollectionRecord[]> {
    this.getManyCalls += 1;
    return super.getMany(workspaceId, collection, recordIds);
  }
}

function memoryAdapter(records: MemoryRecordStore): PersistenceAdapter {
  const catalog = new MemoryCatalogRepository();
  return {
    kind: "memory-test",
    async open(): Promise<PersistenceSession> {
      return {
        catalog,
        records,
        async applyWorkspaceSpec(workspace) {
          const snapshot = records.snapshot();
          try {
            await records.materialize(workspace.id, workspace.spec.collections);
            await catalog.transaction((transaction) => transaction.updateWorkspace(workspace));
          } catch (error) {
            records.restore(snapshot);
            throw error;
          }
        },
        async close() {},
      };
    },
  };
}

function relationalCollections(): readonly [CollectionDefinition, CollectionDefinition] {
  return [
    {
      id: "collection-client",
      key: "client",
      label: "Client",
      fields: [{ id: "field-client-name", key: "name", label: "Name", type: "text" }],
    },
    {
      id: "collection-project",
      key: "project",
      label: "Project",
      fields: [
        { id: "field-project-name", key: "name", label: "Name", type: "text" },
        {
          id: "field-client",
          key: "client",
          label: "Client",
          type: "reference",
          collectionId: "collection-client",
        },
        { id: "field-status", key: "status", label: "Status", type: "text" },
      ],
    },
  ];
}
