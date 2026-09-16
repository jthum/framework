import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import type { Clock, IdGenerator, IdKind } from "../kernel/defaults.ts";
import { Kernel } from "../kernel/kernel.ts";
import { catalogAdapterContract } from "../persistence/catalog.contract.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import { openNodeSqlite } from "./node.ts";

const temporaryDirectories: string[] = [];

catalogAdapterContract("SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite()));

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("SQLite catalog adapter", () => {
  it("runs the kernel on a normalized SQLite catalog", async () => {
    expect.hasAssertions();
    const kernel = await openKernel(":memory:");
    const created = await kernel.createAccount({
      name: "Acme",
      user: { name: "Jane", email: "jane@example.com" },
    });
    const context = {
      accountId: created.account.id,
      workspaceId: created.sharedWorkspace.id,
      actorId: created.user.id,
    };
    const { workspace } = await kernel.createWorkspace(context, { name: "Projects" });

    expect(created.account.sharedWorkspaceId).toBe(created.sharedWorkspace.id);
    expect((await kernel.listWorkspaces(created.account.id)).map((item) => item.name)).toEqual([
      "Acme",
      "Projects",
    ]);
    expect(await kernel.listMembershipsForActor(created.user.id)).toHaveLength(2);
    expect(workspace.spec).toMatchObject({ version: 2, key: "projects" });

    await kernel.close();
  });

  it("persists catalog state across kernel instances", async () => {
    expect.hasAssertions();
    const directory = await makeTemporaryDirectory();
    const path = join(directory, "catalog.sqlite");
    const first = await openKernel(path);
    const created = await first.createAccount({ name: "Acme", user: { name: "Jane" } });
    await first.close();

    const second = await openKernel(path);

    expect(await second.getAccount(created.account.id)).toEqual(created.account);
    expect(await second.getWorkspace(created.sharedWorkspace.id)).toEqual(created.sharedWorkspace);
    expect(await second.listMembershipsForWorkspace(created.sharedWorkspace.id)).toEqual(
      created.memberships,
    );

    await second.close();
  });

  it("rolls back an incomplete account bootstrap atomically", async () => {
    expect.hasAssertions();
    const persistence = new SqlitePersistenceAdapter(() => openNodeSqlite());
    const kernel = await Kernel.open({ persistence, ids: constantIds, clock: fixedClock });

    await expect(
      kernel.createAccount({ name: "Acme", user: { name: "Jane" } }),
    ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
    expect(await kernel.listAccounts()).toEqual([]);

    await kernel.close();
  });

  it("rejects an unknown catalog schema without migrating it", async () => {
    expect.hasAssertions();
    const database = openNodeSqlite();
    await database.execute("PRAGMA user_version = 99");
    const persistence = new SqlitePersistenceAdapter(() => database);

    await expect(persistence.openCatalog()).rejects.toMatchObject({
      code: ERROR_CODES.persistenceUnsupported,
      details: { actualVersion: 99, supportedVersion: 1 },
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
