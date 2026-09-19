import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { Kernel } from "../kernel/kernel.ts";
import type { RecordPolicy } from "../kernel/record-policy.ts";
import { emptyScopeConfig } from "../kernel/scopes.ts";
import { catalogAdapterContract } from "../persistence/catalog.contract.ts";
import { recordStoreContract } from "../persistence/records.contract.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import { SqliteRecordStore } from "./records.ts";
import type { SqliteConnection } from "./gateway.ts";
import { openNodeSqlite } from "./node.ts";
import type { ScopeDatabaseLocation, WorkspaceDatabaseLocation } from "./database-routing.ts";

const memoryAdapter = () =>
  new SqlitePersistenceAdapter(() => openNodeSqlite(), {
    scopeDatabases: { open: () => openNodeSqlite() },
  });
catalogAdapterContract("SQLite scoped layout", memoryAdapter);
recordStoreContract("SQLite scoped layout", memoryAdapter);
const workspaceAdapter = () =>
  new SqlitePersistenceAdapter(() => openNodeSqlite(), {
    workspaceDatabases: { open: () => openNodeSqlite() },
  });
catalogAdapterContract("SQLite Workspace layout", workspaceAdapter);
recordStoreContract("SQLite Workspace layout", workspaceAdapter);

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(
  workspaces = false,
  separateScopes = true,
  recordPolicies: readonly RecordPolicy[] = [],
) {
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
  const workspacePath = ({ workspaceId }: WorkspaceDatabaseLocation) =>
    join(directory, `workspace-${Buffer.from(workspaceId).toString("hex")}.db`);
  const openWorkspace = vi.fn((location: WorkspaceDatabaseLocation) =>
    openNodeSqlite(workspacePath(location)),
  );
  const removeWorkspace = vi.fn(async (location: WorkspaceDatabaseLocation) =>
    rm(workspacePath(location), { force: true }),
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
                if (
                  failMetadata &&
                  (sql.startsWith("INSERT INTO scope_configs") ||
                    sql.startsWith("UPDATE workspaces"))
                ) {
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
      {
        ...(separateScopes ? { scopeDatabases: { open, remove } } : {}),
        ...(workspaces
          ? { workspaceDatabases: { open: openWorkspace, remove: removeWorkspace } }
          : {}),
      },
    );
  const kernel = await Kernel.open({ persistence: adapter(), recordPolicies });
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
    workspacePath,
    openWorkspace,
    removeWorkspace,
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

describe("SQLite record database routing", () => {
  it("rejects a cross-database relationship query when the files have no attachable names", async () => {
    const kernel = await Kernel.open({ persistence: memoryAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Memory routing",
      user: { name: "Owner" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    const scoped = { ...context, scope: { kind: "topic", id: "one" } };
    try {
      await kernel.applySpec(context, {
        ...workspace.spec,
        collections: [
          {
            id: "contacts",
            key: "contacts",
            label: "Contacts",
            fields: [{ id: "contact-name", key: "name", label: "Name", type: "text" }],
          },
        ],
      });
      await kernel.applyScopeConfig(scoped, {
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
                sourceId: "contacts",
              },
            ],
          },
        ],
      });
      const contact = await kernel.createRecord(context, "contacts", { name: "Jane" });
      await kernel.createRecord(scoped, "invoices", { contact: contact.id });
      await expect(
        kernel.querySource(scoped, "invoices", {
          filter: { path: ["invoice-contact", "contact-name"], operator: "eq", value: "Jane" },
        }),
      ).rejects.toMatchObject({ code: "SOURCE.CAPABILITY_UNSUPPORTED" });
    } finally {
      await kernel.close();
    }
  });

  it("references an explicitly attached root Collection from a child Workspace scope", async () => {
    let restrictContacts = false;
    const app = await fixture(true, true, [
      {
        collectionId: "contacts",
        readFilter: () =>
          restrictContacts
            ? { path: ["contact-name"], operator: "eq", value: "Jane" }
            : { all: [] },
        authorize: () => true,
      },
    ]);
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
      const other = await app.kernel.createRecord(app.root, "contacts", { name: "Alice" });
      const invoice = await app.kernel.createRecord(scoped, "invoices", { contact: contact.id });
      await app.kernel.createRecord(scoped, "invoices", { contact: other.id });
      expect(
        (
          await app.kernel.querySource(scoped, "invoices", {
            select: [{ path: ["invoice-contact", "contact-name"], as: "name" }],
          })
        ).rows,
      ).toEqual(expect.arrayContaining([{ id: invoice.id, values: { name: "Jane" } }]));
      const list = vi.spyOn(SqliteRecordStore.prototype, "list").mockImplementation(() => {
        throw new Error("Cross-database View queries must not load the Collection.");
      });
      const related = await (async () => {
        try {
          const result = await app.kernel.querySource(scoped, "invoices", {
            filter: { path: ["invoice-contact", "contact-name"], operator: "contains", value: "e" },
            sort: [{ path: ["invoice-contact", "contact-name"], direction: "desc" }],
            select: [{ path: ["invoice-contact", "contact-name"], as: "name" }],
            limit: 1,
          });
          expect(list).not.toHaveBeenCalled();
          return result;
        } finally {
          list.mockRestore();
        }
      })();
      expect(related.total).toBe(2);
      expect(related.rows).toEqual([{ id: invoice.id, values: { name: "Jane" } }]);
      const grouped = await app.kernel.querySource(scoped, "invoices", {
        aggregate: {
          group: {
            path: ["invoice-contact"],
            as: "contact",
          },
          measures: [{ as: "count", operation: "count" }],
          sort: [{ key: "contact", direction: "asc" }],
        },
      });
      expect(grouped.rows.map((row) => row.values)).toEqual([
        { contact: "Alice", count: 1 },
        { contact: "Jane", count: 1 },
      ]);
      restrictContacts = true;
      const restricted = await app.kernel.querySource(scoped, "invoices", {
        filter: { path: ["invoice-contact", "contact-name"], operator: "notEmpty" },
        sort: [{ path: ["invoice-contact", "contact-name"], direction: "desc" }],
      });
      expect(restricted.total).toBe(1);
      expect(restricted.rows).toEqual([expect.objectContaining({ id: invoice.id })]);
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

describe("SQLite Workspace databases", () => {
  it("keeps root and child records in distinct files and out of the catalog across reopen", async () => {
    const app = await fixture(true);
    let kernel = app.kernel;
    try {
      expect(app.openWorkspace).not.toHaveBeenCalled();
      const collection = notes("shared-definition");
      await kernel.applySpec(app.root, { ...app.workspace.spec, collections: [collection] });
      const rootRecord = await kernel.createRecord(app.root, "notes", { title: "Root" });
      const { workspace } = await kernel.createWorkspace(app.root, { name: "App" });
      const child = { ...app.root, workspaceId: workspace.id };
      await kernel.applySpec(child, { ...workspace.spec, collections: [collection] });
      const childRecord = await kernel.createRecord(child, "notes", { title: "Child" });
      const catalog = openNodeSqlite(app.catalogPath);
      try {
        expect(await catalog.all("SELECT collection_id FROM framework_record_schemas")).toEqual([]);
        expect((await catalog.all("SELECT id FROM workspaces")).length).toBe(2);
      } finally {
        await catalog.close();
      }
      expect(app.workspacePath(app.root)).not.toBe(app.workspacePath(child));
      await kernel.close();
      app.openWorkspace.mockClear();
      kernel = await Kernel.open({ persistence: app.adapter() });
      expect(app.openWorkspace).not.toHaveBeenCalled();
      expect(await kernel.listRecords(app.root, "notes")).toEqual([rootRecord]);
      expect(await kernel.listRecords(child, "notes")).toEqual([childRecord]);
      await kernel.deleteWorkspace(child);
      await expect(access(app.workspacePath(child))).rejects.toThrow();
      expect(await kernel.listRecords(app.root, "notes")).toEqual([rootRecord]);
    } finally {
      await kernel.close();
    }
  });

  it("can co-locate scope records with their Workspace without dropping sibling or shared tables", async () => {
    const app = await fixture(true, false);
    let kernel = app.kernel;
    try {
      await kernel.applySpec(app.root, {
        ...app.workspace.spec,
        collections: [{ id: "people", key: "people", label: "People", fields: [] }],
      });
      const person = await kernel.createRecord(app.root, "people", {});
      await kernel.applyScopeConfig(app.alpha, {
        ...emptyScopeConfig(),
        collections: [notes("alpha")],
      });
      await kernel.applyScopeConfig(app.beta, {
        ...emptyScopeConfig(),
        collections: [notes("beta")],
      });
      const record = await kernel.createRecord(app.beta, "notes", { title: "Sibling" });
      await kernel.deleteScopeConfig(app.alpha);
      await kernel.applySpec(app.root, {
        ...app.workspace.spec,
        collections: [{ id: "people", key: "persons", label: "People", fields: [] }],
      });
      expect(await kernel.listRecords(app.beta, "notes")).toEqual([record]);
      expect(await kernel.listRecords(app.root, "persons")).toEqual([person]);
      expect(app.open).not.toHaveBeenCalled();
      expect(app.openWorkspace).toHaveBeenCalledTimes(1);
      await kernel.close();
      kernel = await Kernel.open({ persistence: app.adapter() });
      expect(await kernel.listRecords(app.beta, "notes")).toEqual([record]);
      await kernel.deleteScopeConfig(app.beta);
      expect(await kernel.listRecords(app.root, "persons")).toEqual([person]);
    } finally {
      await kernel.close();
    }
  });

  it("recovers a Workspace schema rename after metadata publication fails", async () => {
    const app = await fixture(true);
    const collection = notes("alpha");
    await app.kernel.applySpec(app.root, { ...app.workspace.spec, collections: [collection] });
    const record = await app.kernel.createRecord(app.root, "notes", { title: "Retain" });
    app.failMetadata();
    await expect(
      app.kernel.applySpec(app.root, {
        ...app.workspace.spec,
        collections: [
          { ...collection, key: "memo", fields: [{ ...collection.fields[0]!, key: "heading" }] },
        ],
      }),
    ).rejects.toThrow("Injected metadata failure");
    await expect(app.kernel.listRecords(app.root, "notes")).rejects.toMatchObject({
      code: ERROR_CODES.resourceConflict,
    });
    await app.kernel.close();
    const kernel = await Kernel.open({ persistence: app.adapter() });
    try {
      expect((await kernel.getRecord(app.root, "memo", record.id))?.values).toEqual({
        heading: "Retain",
      });
    } finally {
      await kernel.close();
    }
  });

  it("replays Workspace seeds and event subscriptions together", async () => {
    const app = await fixture(true);
    await app.kernel.close();
    const session = await app.adapter().open();
    const collection = notes("global");
    const record: CollectionRecord = {
      id: "seed",
      collectionId: collection.id,
      values: { title: "Seed" },
      createdBy: app.root.actorId,
      updatedBy: app.root.actorId,
      createdAt: "2026-09-18T00:00:00Z",
      updatedAt: "2026-09-18T00:00:00Z",
    };
    app.failMetadata();
    await expect(
      session.applyWorkspaceSpec(
        {
          ...app.workspace,
          spec: {
            ...app.workspace.spec,
            collections: [collection],
            rules: [
              {
                id: "rule",
                key: "on_post",
                label: "On post",
                trigger: { event: "message.posted" },
                steps: [],
              },
            ],
          },
        },
        [{ collection, records: [record] }],
      ),
    ).rejects.toThrow();
    await session.close();
    const recovered = await app.adapter().open();
    try {
      expect(await recovered.records.list(app.root.workspaceId, collection)).toEqual([record]);
      expect(
        await recovered.subscriptions.match(app.root.workspaceId, undefined, "message.posted"),
      ).toEqual([{ workspaceId: app.root.workspaceId, event: "message.posted", ruleId: "rule" }]);
    } finally {
      await recovered.close();
    }
  });

  it("finishes Workspace and scope cleanup after interrupted Workspace file removal", async () => {
    const app = await fixture(true);
    const { workspace } = await app.kernel.createWorkspace(app.root, { name: "App" });
    const child = { ...app.root, workspaceId: workspace.id };
    await app.kernel.applySpec(child, { ...workspace.spec, collections: [notes("child")] });
    await app.kernel.applyScopeConfig(
      { ...child, scope: app.alpha.scope },
      { ...emptyScopeConfig(), collections: [{ ...notes("scope"), key: "local_notes" }] },
    );
    app.removeWorkspace.mockImplementationOnce(async (location) => {
      await rm(app.workspacePath(location), { force: true });
      throw new Error("Interrupted Workspace cleanup");
    });
    await expect(app.kernel.deleteWorkspace(child)).rejects.toThrow();
    await app.kernel.close();
    const kernel = await Kernel.open({ persistence: app.adapter() });
    try {
      expect((await kernel.listChildWorkspaces(app.root)).length).toBe(0);
      await expect(access(app.workspacePath(child))).rejects.toThrow();
      await expect(
        access(app.path({ workspaceId: child.workspaceId, scope: app.alpha.scope })),
      ).rejects.toThrow();
    } finally {
      await kernel.close();
    }
  });
});
