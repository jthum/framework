import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { Clock, IdGenerator, IdKind } from "../kernel/defaults.ts";
import { Kernel } from "../kernel/kernel.ts";
import { catalogAdapterContract } from "../persistence/catalog.contract.ts";
import { recordStoreContract } from "../persistence/records.contract.ts";
import type { CollectionRecord } from "../persistence/records.ts";
import type { CollectionDefinition } from "../spec/model.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import { openNodeSqlite } from "./node.ts";

const temporaryDirectories: string[] = [];

catalogAdapterContract("SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite()));
recordStoreContract("SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite()));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("SQLite catalog adapter", () => {
  it("persists live Attachment bindings and revocation across sessions", async () => {
    expect.hasAssertions();
    const path = join(await makeTemporaryDirectory(), "attachments.sqlite");
    const first = await openKernel(path);
    const { workspace: root, user } = await first.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const origin = { workspaceId: root.id, actorId: user.id };
    const { workspace: app } = await first.createWorkspace(origin, { name: "CRM" });
    const target = { ...origin, workspaceId: app.id };
    await first.applySpec(origin, {
      ...root.spec,
      collections: [{ id: "contacts", key: "contact", label: "Contact", fields: [] }],
    });
    await first.applySpec(target, {
      ...app.spec,
      sources: [{ id: "shared-contacts", key: "contacts", label: "Contacts" }],
    });
    const attachment = await first.createAttachment(origin, {
      collectionKey: "contact",
      targetId: app.id,
      key: "contacts",
    });
    const record = await first.createRecord(origin, "contact", {});
    await first.close();
    const second = await openKernel(path);
    expect(await second.listAttachments(target)).toEqual([attachment]);
    expect(await second.listAttachedRecords(target, "contacts")).toEqual([record]);
    await second.revokeAttachment(origin, attachment.id);
    await second.close();
    const third = await openKernel(path);
    await expect(third.listAttachedRecords(target, "contacts")).rejects.toMatchObject({
      code: ERROR_CODES.resourceNotFound,
    });
    expect((await third.listAttachments(target))[0]?.revokedBy).toBe(user.id);
    await third.close();
  });
  it("closes a failed record-store initialization and preserves its error", async () => {
    expect.hasAssertions();
    const database = openNodeSqlite();
    const execute = database.execute.bind(database);
    const close = database.close.bind(database);
    const failure = new Error("Record-store initialization failed");
    vi.spyOn(database, "execute").mockImplementation(async (sql) => {
      if (sql.includes("framework_record_schemas")) throw failure;
      await execute(sql);
    });
    const closeSpy = vi.spyOn(database, "close").mockImplementation(async () => {
      await close();
      throw new Error("Cleanup failed too");
    });
    await expect(new SqlitePersistenceAdapter(() => database).open()).rejects.toBe(failure);
    expect(closeSpy).toHaveBeenCalledOnce();
    await expect(database.get("SELECT 1")).rejects.toThrow();
  });
  it("runs the kernel on a normalized SQLite catalog", async () => {
    expect.hasAssertions();
    const kernel = await openKernel(":memory:");
    const created = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane", email: "jane@example.com" },
    });
    const context = {
      workspaceId: created.workspace.id,
      actorId: created.user.id,
    };
    const { workspace } = await kernel.createWorkspace(context, { name: "Projects" });

    expect(created.workspace.rootId).toBe(created.workspace.id);
    expect((await kernel.listWorkspacesByRoot(context)).map((item) => item.name)).toEqual([
      "Acme",
      "Projects",
    ]);
    expect(await kernel.listMembershipsForActor(context, created.user.id)).toHaveLength(2);
    expect(workspace.spec).toMatchObject({ version: 2, key: "projects" });

    await kernel.close();
  });

  it("persists catalog state across kernel instances", async () => {
    expect.hasAssertions();
    const directory = await makeTemporaryDirectory();
    const path = join(directory, "catalog.sqlite");
    const first = await openKernel(path);
    const created = await first.createRootWorkspace({ name: "Acme", user: { name: "Jane" } });
    await first.close();

    const second = await openKernel(path);
    const context = { workspaceId: created.workspace.id, actorId: created.user.id };

    expect(await second.getWorkspace(context)).toEqual(created.workspace);
    expect(await second.listMembershipsForWorkspace(context)).toEqual(created.memberships);

    await second.close();
  });

  it("persists materialized Collections and records across sessions", async () => {
    expect.hasAssertions();
    const directory = await makeTemporaryDirectory();
    const path = join(directory, "records.sqlite");
    const collection: CollectionDefinition = {
      id: "collection-task",
      key: "task",
      label: "Task",
      fields: [{ id: "field-title", key: "title", label: "Title", type: "text" }],
    };
    const record: CollectionRecord = {
      id: "record-1",
      collectionId: collection.id,
      values: { title: "Persist me" },
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
      createdBy: "actor-1",
      updatedBy: "actor-1",
    };
    const first = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();
    await first.records.materialize("workspace-1", [collection]);
    await first.records.create("workspace-1", collection, record);
    await first.close();

    const second = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();

    expect(await second.records.list("workspace-1", collection)).toEqual([record]);
    await second.close();
  });

  it("rolls back an incomplete root Workspace bootstrap atomically", async () => {
    expect.hasAssertions();
    const database = openNodeSqlite();
    const persistence = new SqlitePersistenceAdapter(() => database);
    const kernel = await Kernel.open({ persistence, ids: constantIds, clock: fixedClock });

    await expect(
      kernel.createRootWorkspace({ name: "Acme", user: { name: "Jane" } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
    const session = await persistence.open();
    expect(await session.catalog.listRootWorkspaces()).toEqual([]);

    await kernel.close();
  });

  it("rejects an unknown catalog schema without migrating it", async () => {
    expect.hasAssertions();
    const database = openNodeSqlite();
    await database.execute("PRAGMA user_version = 99");
    const persistence = new SqlitePersistenceAdapter(() => database);

    await expect(persistence.open()).rejects.toMatchObject({
      code: ERROR_CODES.persistenceUnsupported,
      details: { actualVersion: 99, supportedVersion: 5 },
    });

    await expect(database.get("SELECT 1")).rejects.toThrow();
  });
});

async function openKernel(path: string): Promise<Kernel> {
  return Kernel.open({
    persistence: new SqlitePersistenceAdapter(() => openNodeSqlite(path)),
    ids: sequenceIds(),
    clock: fixedClock,
  });
}

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "framework-sqlite-"));
  temporaryDirectories.push(directory);
  return directory;
}

const fixedClock: Clock = {
  now: () => "2026-09-16T00:00:00.000Z",
};

const constantIds: IdGenerator = {
  create: () => "same-id",
};

function sequenceIds(): IdGenerator {
  let next = 0;
  return {
    create(kind: IdKind) {
      next += 1;
      return `${kind}-${next}`;
    },
  };
}
