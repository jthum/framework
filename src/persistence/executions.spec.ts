import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { Kernel } from "../kernel/kernel.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import type { PersistenceAdapter } from "./catalog.ts";
import type { RuleExecution } from "./executions.ts";
import { MemoryPersistenceAdapter } from "./memory.ts";

for (const [name, create] of [
  ["Memory", () => new MemoryPersistenceAdapter()],
  ["SQLite", () => new SqlitePersistenceAdapter(() => openNodeSqlite())],
] as const)
  describe(`${name} durable checkpoints`, () => {
    it("isolates, detaches and atomically advances execution state", async () => {
      expect.hasAssertions();
      const adapter: PersistenceAdapter = create();
      const session = await adapter.open();
      const kernel = await Kernel.open({
        persistence: { kind: adapter.kind, open: async () => session },
      });
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const execution: RuleExecution = {
        id: "execution-one",
        context: { workspaceId: root.workspace.id, actorId: root.user.id },
        rule: {
          id: "rule-one",
          key: "approval",
          label: "Approval",
          steps: [{ id: "compute", compute: { assign: { total: 12, ready: true } } }],
        },
        revision: 0,
        status: "waiting",
        checkpoint: { vars: { amount: 12 }, frames: [] },
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z",
      };
      await session.executions.create(execution);
      await expect(session.executions.create(execution)).rejects.toMatchObject({
        code: ERROR_CODES.resourceConflict,
      });
      await expect(
        session.executions.create({ ...execution, id: "invalid-new", revision: 1 }),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      for (const [revision, expected] of [
        [0, 0],
        [2, 0],
        [1, -1],
        [1.5, 0],
        [Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER],
      ])
        await expect(
          session.executions.update({ ...execution, revision: revision! }, expected!),
        ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      for (const changed of [
        { context: { ...execution.context, workspaceId: "other" } },
        { rule: { ...execution.rule, label: "Changed definition" } },
        { createdAt: "2026-09-18T00:00:00.000Z" },
      ])
        await expect(
          session.executions.update({ ...execution, ...changed, revision: 1 }, 0),
        ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await session.executions.get("other", execution.id)).toBeNull();
      expect(await session.executions.list("other", root.user.id, 20, 0)).toEqual([]);
      expect(await session.executions.list(root.workspace.id, "other-actor", 20, 0)).toEqual([]);
      expect(await session.executions.list(root.workspace.id, root.user.id, 1, 0)).toEqual([
        execution,
      ]);
      expect(await session.executions.list(root.workspace.id, root.user.id, 1, 1)).toEqual([]);
      const loaded = (await session.executions.get(root.workspace.id, execution.id))!;
      (loaded.checkpoint as Record<string, unknown>).vars = { amount: 99 };
      expect(await session.executions.get(root.workspace.id, execution.id)).toEqual(execution);
      const next = {
        ...execution,
        // Equivalent snapshot with different object property insertion order.
        rule: {
          steps: [{ compute: { assign: { ready: true, total: 12 } }, id: "compute" }],
          label: "Approval",
          key: "approval",
          id: "rule-one",
        },
        revision: 1,
        status: "running" as const,
      };
      const results = await Promise.allSettled([
        session.executions.update(next, 0),
        session.executions.update(next, 0),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      await expect(
        session.executions.update(
          { ...next, revision: 2, context: { ...next.context, actorId: "other" } },
          1,
        ),
      ).rejects.toMatchObject({ code: ERROR_CODES.resourceConflict });
      expect(await session.executions.get(root.workspace.id, execution.id)).toEqual(next);
      await kernel.close();
    });
  });

it("recovers an exact SQLite checkpoint after closing and reopening the database", async () => {
  expect.hasAssertions();
  const directory = await mkdtemp(join(tmpdir(), "framework-execution-"));
  const path = join(directory, "catalog.db");
  const first = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();
  let firstClosed = false;
  try {
    const kernel = await Kernel.open({ persistence: { kind: "sqlite", open: async () => first } });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const execution: RuleExecution = {
      id: "saved-wait",
      context: { workspaceId: root.workspace.id, actorId: root.user.id },
      rule: { id: "approval", key: "approval", label: "Approval", steps: [] },
      revision: 0,
      status: "waiting",
      checkpoint: { vars: { amount: 12 }, frames: [{ stepId: "wait-one" }] },
      createdAt: "2026-09-17T00:00:00.000Z",
      updatedAt: "2026-09-17T00:00:00.000Z",
    };
    await first.executions.create(execution);
    await kernel.close();
    firstClosed = true;
    const second = await new SqlitePersistenceAdapter(() => openNodeSqlite(path)).open();
    try {
      expect(await second.executions.get(root.workspace.id, execution.id)).toEqual(execution);
      const resumed = { ...execution, revision: 1, status: "running" as const };
      await second.executions.update(resumed, 0);
      expect(await second.executions.get(root.workspace.id, execution.id)).toEqual(resumed);
      await expect(second.executions.update(resumed, 0)).rejects.toMatchObject({
        code: ERROR_CODES.resourceConflict,
      });
    } finally {
      await second.close();
    }
  } finally {
    if (!firstClosed) await first.close();
    await rm(directory, { recursive: true });
  }
});
