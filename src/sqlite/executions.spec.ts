import { describe, expect, it, vi } from "vite-plus/test";
import { Kernel } from "../kernel/kernel.ts";
import type { RuleExecution } from "../persistence/executions.ts";
import { SqlitePersistenceAdapter } from "./catalog.ts";
import { openNodeSqlite } from "./node.ts";

describe("SQLite execution history", () => {
  it("reads indexed scalar summaries without selecting or parsing checkpoints", async () => {
    const database = openNodeSqlite();
    const session = await new SqlitePersistenceAdapter(() => database).open();
    const kernel = await Kernel.open({
      persistence: { kind: "sqlite", open: async () => session },
    });
    try {
      const root = await kernel.createRootWorkspace({ name: "History", user: { name: "Owner" } });
      const execution: RuleExecution = {
        id: "large",
        context: { workspaceId: root.workspace.id, actorId: root.user.id },
        rule: { id: "rule", key: "large_rule", label: "Large rule", steps: [] },
        revision: 0,
        status: "waiting",
        checkpoint: { context: "x".repeat(256_000) },
        createdAt: "2026-10-20T00:00:00.000Z",
        updatedAt: "2026-10-20T00:00:00.000Z",
      };
      await session.executions.create(execution);
      const queries = vi.spyOn(database, "all");
      const parse = vi.spyOn(JSON, "parse");
      try {
        const result = await session.executions.list(root.workspace.id, root.user.id, 20, 0);
        expect(result).toEqual([
          {
            id: execution.id,
            actorId: root.user.id,
            rule: { id: "rule", key: "large_rule", label: "Large rule" },
            status: execution.status,
            createdAt: execution.createdAt,
            updatedAt: execution.updatedAt,
          },
        ]);
        expect(parse).not.toHaveBeenCalled();
        expect(queries).toHaveBeenCalledTimes(1);
        const [sql, parameters] = queries.mock.calls[0]!;
        expect(sql).not.toMatch(/execution_json|json_extract|SELECT\s+\*/i);
        const plan = await database.all<{ detail: string }>(
          `EXPLAIN QUERY PLAN ${sql}`,
          parameters,
        );
        expect(plan.some((row) => /USING INDEX rule_executions_history/.test(row.detail))).toBe(
          true,
        );
        expect(plan.some((row) => /TEMP B-TREE/.test(row.detail))).toBe(false);
      } finally {
        queries.mockRestore();
        parse.mockRestore();
      }
      expect(await session.executions.get(root.workspace.id, execution.id)).toEqual(execution);
    } finally {
      await kernel.close();
    }
  });
});
