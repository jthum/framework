import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { Kernel } from "../kernel/kernel.ts";
import { emptyScopeConfig } from "../kernel/scopes.ts";
import { catalogAdapterContract } from "../persistence/catalog.contract.ts";
import { recordStoreContract } from "../persistence/records.contract.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import type { SqliteConnection } from "./gateway.ts";
import { openNodeSqlite } from "./node.ts";
import type { ScopeDatabaseLocation } from "./scope-databases.ts";

const memoryAdapter = () =>
  new SqlitePersistenceAdapter(() => openNodeSqlite(), {
    scopeDatabases: { open: () => openNodeSqlite() },
  });
catalogAdapterContract("SQLite scoped layout", memoryAdapter);
recordStoreContract("SQLite scoped layout", memoryAdapter);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "framework-scope-routing-"));
  directories.push(directory);
  const catalogPath = join(directory, "catalog.db");
  const path = ({ workspaceId, scope }: ScopeDatabaseLocation) =>
    join(
      directory,
      `${Buffer.from(JSON.stringify([workspaceId, scope.kind, scope.id])).toString("hex")}.db`,
    );
  const open = vi.fn((location: ScopeDatabaseLocation) => openNodeSqlite(path(location)));
  const remove = vi.fn(async (location: ScopeDatabaseLocation) =>
    rm(path(location), { force: true }),
  );
  let failMetadata = false;
  const adapter = () =>
    new SqlitePersistenceAdapter(
      () => {
        const database = openNodeSqlite(catalogPath);
        const transaction = database.transaction.bind(database);
        database.transaction = (work) =>
          transaction((connection) => {
            const wrapped: SqliteConnection = {
              execute: (sql) => connection.execute(sql),
              get: (sql, parameters) => connection.get(sql, parameters),
              all: (sql, parameters) => connection.all(sql, parameters),
              run: async (sql, parameters) => {
                if (failMetadata && sql.startsWith("INSERT INTO scope_configs")) {
                  failMetadata = false;
                  throw new Error("Injected metadata failure");
                }
                await connection.run(sql, parameters);
              },
            };
            return work(wrapped);
          });
        return database;
      },
      { scopeDatabases: { open, remove } },
    );
  const kernel = await Kernel.open({ persistence: adapter() });
  const { workspace, user } = await kernel.createRootWorkspace({
    name: "Team",
    user: { name: "Jane" },
  });
  const root = { workspaceId: workspace.id, actorId: user.id };
  const alpha = { ...root, scope: { kind: "topic", id: "alpha" } };
  const beta = { ...root, scope: { kind: "topic", id: "beta" } };
  return {
    kernel,
    workspace,
    root,
    alpha,
    beta,
    path,
    catalogPath,
    adapter,
    open,
    remove,
    failMetadata: () => {
      failMetadata = true;
    },
  };
}

function notes(suffix: string) {
  return {
    id: `${suffix}-notes`,
    key: "notes",
    label: "Notes",
    fields: [{ id: `${suffix}-title`, key: "title", label: "Title", type: "text" as const }],
  };
}

describe("SQLite scope database routing", () => {
  it("references an explicitly attached root Collection from a child Workspace scope", async () => {
    const app = await fixture();
    try {
      await app.kernel.updateWorkspaceAccess(app.root, {
        members: ["read", "create", "update", "delete", "manage"],
        others: ["read"],
      });
      await app.kernel.applySpec(app.root, {
        ...app.workspace.spec,
        collections: [
          {
            id: "contacts",
            key: "contacts",
            label: "Contacts",
            fields: [{ id: "contact-name", key: "name", label: "Name", type: "text" }],
          },
        ],
      });
      const { workspace } = await app.kernel.createWorkspace(app.root, { name: "Billing" });
      const context = { ...app.root, workspaceId: workspace.id };
      const scoped = { ...context, scope: app.alpha.scope };
      await app.kernel.applySpec(context, {
        ...workspace.spec,
        sources: [{ id: "attached-contacts", key: "contacts", label: "Contacts" }],
      });
      const attachment = await app.kernel.createAttachment(app.root, {
        collectionKey: "contacts",
        targetId: workspace.id,
        sourceId: "attached-contacts",
      });
      await app.kernel.applyScopeConfig(scoped, {
        ...emptyScopeConfig(),
        collections: [
          {
            id: "invoices",
            key: "invoices",
            label: "Invoices",
            fields: [
              {
                id: "invoice-contact",
                key: "contact",
                label: "Contact",
                type: "reference",
                sourceId: "attached-contacts",
              },
            ],
          },
        ],
      });
      const contact = await app.kernel.createRecord(app.root, "contacts", { name: "Jane" });
      const invoice = await app.kernel.createRecord(scoped, "invoices", { contact: contact.id });
      expect(
        (
          await app.kernel.querySource(scoped, "invoices", {
            select: [{ path: ["invoice-contact", "contact-name"], as: "name" }],
          })
        ).rows,
      ).toEqual([{ id: invoice.id, values: { name: "Jane" } }]);
      await app.kernel.revokeAttachment(app.root, attachment.id);
      await expect(
        app.kernel.querySource(scoped, "invoices", {
          select: [{ path: ["invoice-contact", "contact-name"], as: "name" }],
        }),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceNotFound });
    } finally {
      await app.kernel.close();
    }
  });

  it("installs a scope-local View snapshot without putting its table in the catalog", async () => {
    const app = await fixture();
    try {
      const collection = notes("alpha");
      await app.kernel.applyScopeConfig(app.alpha, {
        ...emptyScopeConfig(),
        collections: [collection],
        views: [{ id: "note-view", key: "notes", label: "Notes", source: "notes", query: {} }],
      });
      await app.kernel.createRecord(app.alpha, "notes", { title: "Copy me" });
      await app.kernel.executeAction(app.alpha, "views.snapshot", {
        viewId: "note-view",
        label: "Copy",
        key: "copy",
      });
      expect((await app.kernel.listRecords(app.alpha, "copy"))[0]?.values.title).toBe("Copy me");
      expect((await app.kernel.getWorkspace(app.root))?.spec.collections).toEqual([]);
      const catalog = openNodeSqlite(app.catalogPath);
      try {
        expect(await catalog.all("SELECT collection_id FROM framework_record_schemas")).toEqual([]);
      } finally {
        await catalog.close();
      }
    } finally {
      await app.kernel.close();
    }
  });

  it("opens on demand, isolates siblings, traverses shared references, and preserves renames on reopen", async () => {
    const app = await fixture();
    let kernel = app.kernel;
    try {
      await kernel.getScopeConfig(app.alpha);
      await kernel.applyScopeConfig(app.alpha, {
        ...emptyScopeConfig(),
        pages: [{ id: "local-page", key: "home", label: "Home", layout: [] }],
      });
      expect(app.open).not.toHaveBeenCalled();
      const shared = {
        id: "people",
        key: "people",
        label: "People",
        fields: [{ id: "person-name", key: "name", label: "Name", type: "text" as const }],
      };
      await kernel.applySpec(app.root, { ...app.workspace.spec, collections: [shared] });
      const jane = await kernel.createRecord(app.root, "people", { name: "Jane" });
      const collection = {
        ...notes("alpha"),
        fields: [
          ...notes("alpha").fields,
          {
            id: "person",
            key: "person",
            label: "Person",
            type: "reference" as const,
            sourceId: "people",
          },
        ],
      };
      const config = { ...emptyScopeConfig(), collections: [collection] };
      await kernel.applyScopeConfig(app.alpha, config);
      await kernel.applyScopeConfig(app.beta, {
        ...emptyScopeConfig(),
        collections: [notes("beta")],
      });
      const a = await kernel.createRecord(app.alpha, "notes", { title: "Alpha", person: jane.id });
      const b = await kernel.createRecord(app.beta, "notes", { title: "Beta" });
      expect(
        (
          await kernel.querySource(app.alpha, "notes", {
            select: [{ path: ["person", "person-name"], as: "name" }],
          })
        ).rows,
      ).toEqual([{ id: a.id, values: { name: "Jane" } }]);
      await kernel.applySpec(app.root, {
        ...app.workspace.spec,
        collections: [{ ...shared, label: "Shared people" }],
      });
      await kernel.applyScopeConfig(app.alpha, {
        ...config,
        collections: [
          {
            ...collection,
            key: "memo",
            fields: collection.fields.map((field) =>
              field.id === "alpha-title" ? { ...field, key: "heading" } : field,
            ),
          },
        ],
      });
      await kernel.close();
      app.open.mockClear();
      kernel = await Kernel.open({ persistence: app.adapter() });
      expect(app.open).not.toHaveBeenCalled();
      expect((await kernel.getRecord(app.alpha, "memo", a.id))?.values).toEqual({
        heading: "Alpha",
        person: jane.id,
      });
      expect(await kernel.listRecords(app.beta, "notes")).toEqual([b]);
      expect(await kernel.listRecords(app.root, "people")).toEqual([jane]);
      const catalog = openNodeSqlite(app.catalogPath);
      try {
        expect(await catalog.all("SELECT collection_id FROM framework_record_schemas")).toEqual([
          { collection_id: "people" },
        ]);
      } finally {
        await catalog.close();
      }
      await kernel.deleteScopeConfig(app.alpha);
      await expect(
        access(app.path({ workspaceId: app.root.workspaceId, scope: app.alpha.scope })),
      ).rejects.toThrow();
      expect(await kernel.listRecords(app.beta, "notes")).toEqual([b]);
    } finally {
      await kernel.close();
    }
  });

  it("replays accepted schema and seeds after a metadata failure without duplicating data", async () => {
    const app = await fixture();
    await app.kernel.close();
    const session = await app.adapter().open();
    const collection = notes("alpha");
    const record: CollectionRecord = {
      id: "seed",
      collectionId: collection.id,
      values: { title: "Seeded" },
      createdBy: app.root.actorId,
      updatedBy: app.root.actorId,
      createdAt: "2026-09-18T00:00:00Z",
      updatedAt: "2026-09-18T00:00:00Z",
    };
    app.failMetadata();
    await expect(
      session.applyScopeConfig(
        app.workspace,
        app.alpha.scope,
        { ...emptyScopeConfig(), collections: [collection] },
        [{ collection, records: [record] }],
      ),
    ).rejects.toThrow("Injected metadata failure");
    expect(await session.scopes.get(app.root.workspaceId, app.alpha.scope)).toBeNull();
    await expect(session.records.list(app.root.workspaceId, collection)).rejects.toMatchObject({
      code: ERROR_CODES.resourceConflict,
    });
    await session.close();
    const recovered = await app.adapter().open();
    try {
      expect(
        (await recovered.scopes.get(app.root.workspaceId, app.alpha.scope))?.collections,
      ).toEqual([collection]);
      expect(await recovered.records.list(app.root.workspaceId, collection)).toEqual([record]);
    } finally {
      await recovered.close();
    }
    const again = await app.adapter().open();
    try {
      expect(await again.records.list(app.root.workspaceId, collection)).toEqual([record]);
    } finally {
      await again.close();
    }
  });

  it("finishes destructive schema changes on reopen and blocks reads while metadata is stale", async () => {
    const app = await fixture();
    const collection = {
      ...notes("alpha"),
      fields: [
        ...notes("alpha").fields,
        { id: "obsolete", key: "obsolete", label: "Obsolete", type: "text" as const },
      ],
    };
    await app.kernel.applyScopeConfig(app.alpha, {
      ...emptyScopeConfig(),
      collections: [collection],
    });
    const record = await app.kernel.createRecord(app.alpha, "notes", {
      title: "Keep",
      obsolete: "Remove",
    });
    app.failMetadata();
    await expect(
      app.kernel.applyScopeConfig(app.alpha, {
        ...emptyScopeConfig(),
        collections: [notes("alpha")],
      }),
    ).rejects.toThrow();
    await expect(app.kernel.getRecord(app.alpha, "notes", record.id)).rejects.toMatchObject({
      code: ERROR_CODES.resourceConflict,
    });
    await app.kernel.close();
    const kernel = await Kernel.open({ persistence: app.adapter() });
    try {
      expect((await kernel.getRecord(app.alpha, "notes", record.id))?.values).toEqual({
        title: "Keep",
      });
    } finally {
      await kernel.close();
    }
  });

  it("retries physical cleanup even if removal succeeded before reporting failure", async () => {
    const app = await fixture();
    await app.kernel.applyScopeConfig(app.alpha, {
      ...emptyScopeConfig(),
      collections: [notes("alpha")],
    });
    app.remove.mockImplementationOnce(async (location) => {
      await rm(app.path(location), { force: true });
      throw new Error("Interrupted cleanup");
    });
    await expect(app.kernel.deleteScopeConfig(app.alpha)).rejects.toThrow("Interrupted cleanup");
    await app.kernel.close();
    const kernel = await Kernel.open({ persistence: app.adapter() });
    try {
      expect(await kernel.getScopeConfig(app.alpha)).toEqual(emptyScopeConfig());
      await expect(
        access(app.path({ workspaceId: app.root.workspaceId, scope: app.alpha.scope })),
      ).rejects.toThrow();
      expect(app.remove).toHaveBeenCalledTimes(2);
    } finally {
      await kernel.close();
    }
  });

  it("rejects changing a persisted layout instead of silently looking in a different database", async () => {
    const app = await fixture();
    await app.kernel.close();
    await expect(
      new SqlitePersistenceAdapter(() => openNodeSqlite(app.catalogPath)).open(),
    ).rejects.toMatchObject({ code: ERROR_CODES.persistenceUnsupported });
    const singlePath = join(directories.at(-1)!, "single.db");
    const single = await new SqlitePersistenceAdapter(() => openNodeSqlite(singlePath)).open();
    await single.close();
    await expect(
      new SqlitePersistenceAdapter(() => openNodeSqlite(singlePath), {
        scopeDatabases: { open: () => openNodeSqlite() },
      }).open(),
    ).rejects.toMatchObject({ code: ERROR_CODES.persistenceUnsupported });
  });

  it("protects an existing scope when a callback aliases two locations to one file", async () => {
    const app = await fixture();
    await app.kernel.applyScopeConfig(app.alpha, {
      ...emptyScopeConfig(),
      collections: [notes("alpha")],
    });
    const record = await app.kernel.createRecord(app.alpha, "notes", { title: "Keep" });
    app.open.mockImplementationOnce(() =>
      openNodeSqlite(app.path({ workspaceId: app.root.workspaceId, scope: app.alpha.scope })),
    );
    await expect(
      app.kernel.applyScopeConfig(app.beta, {
        ...emptyScopeConfig(),
        collections: [notes("beta")],
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
    await app.kernel.close();
    const kernel = await Kernel.open({ persistence: app.adapter() });
    try {
      expect(await kernel.listRecords(app.alpha, "notes")).toEqual([record]);
      expect(await kernel.listRecords(app.beta, "notes")).toEqual([]);
    } finally {
      await kernel.close();
    }
  });

  it("removes all scope databases when deleting their owning Workspace", async () => {
    const app = await fixture();
    try {
      const { workspace } = await app.kernel.createWorkspace(app.root, { name: "App" });
      const context = { ...app.root, workspaceId: workspace.id };
      const alpha = { ...context, scope: app.alpha.scope };
      const beta = { ...context, scope: app.beta.scope };
      await app.kernel.applyScopeConfig(alpha, {
        ...emptyScopeConfig(),
        collections: [notes("alpha")],
      });
      await app.kernel.applyScopeConfig(beta, {
        ...emptyScopeConfig(),
        collections: [notes("beta")],
      });
      await app.kernel.deleteWorkspace(context);
      expect(app.remove).toHaveBeenCalledTimes(2);
      await expect(
        access(app.path({ workspaceId: workspace.id, scope: app.beta.scope })),
      ).rejects.toThrow();
    } finally {
      await app.kernel.close();
    }
  });
});
