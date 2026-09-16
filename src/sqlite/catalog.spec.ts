import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";
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
  it("runs the kernel on a normalized SQLite catalog", async () => {
    expect.hasAssertions();
    const kernel = await openKernel(":memory:");
    const created = await kernel.createRootWorkspace({
      name: "Acme",
      user: { name: "Jane", email: "jane@example.com" },
    });
    const context = {
      workspaceId: created.rootWorkspace.id,
      actorId: created.user.id,
    };
    const { workspace } = await kernel.createWorkspace(context, { name: "Projects" });

    expect(created.rootWorkspace.rootId).toBe(created.rootWorkspace.id);
    expect(
      (await kernel.listWorkspacesByRoot(created.rootWorkspace.id)).map((item) => item.name),
    ).toEqual(["Acme", "Projects"]);
    expect(await kernel.listMembershipsForActor(created.user.id)).toHaveLength(2);
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

    expect(await second.getWorkspace(created.rootWorkspace.id)).toEqual(created.rootWorkspace);
    expect(await second.listMembershipsForWorkspace(created.rootWorkspace.id)).toEqual(
      created.memberships,
    );

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
      createdByActorId: "actor-1",
      updatedByActorId: "actor-1",
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
    const persistence = new SqlitePersistenceAdapter(() => openNodeSqlite());
    const kernel = await Kernel.open({ persistence, ids: constantIds, clock: fixedClock });

    await expect(
      kernel.createRootWorkspace({ name: "Acme", user: { name: "Jane" } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
    expect(await kernel.listRootWorkspaces()).toEqual([]);

    await kernel.close();
  });

  it("rejects an unknown catalog schema without migrating it", async () => {
    expect.hasAssertions();
    const database = openNodeSqlite();
    await database.execute("PRAGMA user_version = 99");
    const persistence = new SqlitePersistenceAdapter(() => database);

    await expect(persistence.open()).rejects.toMatchObject({
      code: ERROR_CODES.persistenceUnsupported,
      details: { actualVersion: 99, supportedVersion: 3 },
    });

    await database.close();
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
