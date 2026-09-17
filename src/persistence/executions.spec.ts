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
        rule: { id: "rule-one", key: "approval", label: "Approval", steps: [] },
        revision: 0,
        status: "waiting",
        checkpoint: { vars: { amount: 12 }, frames: [] },
        createdAt: "2026-09-17T00:00:00.000Z",
        updatedAt: "2026-09-17T00:00:00.000Z",
      };
      await session.executions.create(execution);
      expect(await session.executions.get("other", execution.id)).toBeNull();
      const loaded = (await session.executions.get(root.workspace.id, execution.id))!;
      (loaded.checkpoint as Record<string, unknown>).vars = { amount: 99 };
      expect(await session.executions.get(root.workspace.id, execution.id)).toEqual(execution);
      const next = { ...execution, revision: 1, status: "running" as const };
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
