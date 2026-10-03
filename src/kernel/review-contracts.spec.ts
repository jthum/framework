import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { assertValidSpec } from "../spec/validate.ts";
import type { RuleDefinition, SourceQueryDefinition } from "../spec/model.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { Kernel } from "./kernel.ts";
import { LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";

describe("reviewed runtime contracts", () => {
  it("rejects oversized checkpoints before creation and charges empty repeat iterations", async () => {
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
      ruleExecution: { maxSteps: 3, maxCheckpointBytes: 512 },
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Budgets",
        user: { name: "Owner" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      await kernel.applySpec(context, {
        ...workspace.spec,
        rules: [
          {
            id: "loop",
            key: "loop",
            label: "Loop",
            steps: [{ id: "repeat", repeat: { times: 3, steps: [] } }],
          },
          {
            id: "wait",
            key: "wait",
            label: "Wait",
            steps: [{ id: "pause", wait: { signal: "ready" } }],
          },
        ],
      });
      await expect(kernel.runRule(context, "loop")).rejects.toThrow("runtime limit of 3");
      await expect(kernel.startRule(context, "wait")).rejects.toMatchObject({
        code: ERROR_CODES.ruleCheckpointLimit,
      });
      expect(await kernel.listRuleExecutions(context)).toEqual([]);
    } finally {
      await kernel.close();
    }
  });
  it("bounds pages, preserves complete snapshots, and matches typed aggregates across providers", async () => {
    for (const persistence of [
      new MemoryPersistenceAdapter(),
      new SqlitePersistenceAdapter(() => openNodeSqlite()),
    ]) {
      const kernel = await Kernel.open({ persistence });
      try {
        const { workspace, user } = await kernel.createRootWorkspace({
          name: "2026 operations",
          user: { name: "Owner" },
        });
        const context = { workspaceId: workspace.id, actorId: user.id };
        const spec = {
          ...workspace.spec,
          collections: [
            {
              id: "data",
              key: "data",
              label: "Data",
              fields: [
                { id: "text", key: "text", label: "Text", type: "text" as const },
                { id: "active", key: "active", label: "Active", type: "boolean" as const },
                { id: "instant", key: "instant", label: "Instant", type: "datetime" as const },
              ],
            },
          ],
          views: [{ id: "all", key: "all", label: "All", source: "data" }],
        };
        assertValidSpec(spec);
        await kernel.applySpec(context, spec);
        for (let index = 0; index < 125; index++)
          await kernel.createRecord(context, "data", {
            text: index % 2 ? "1e1" : "not numeric",
            active: true,
            instant: "2026-01-01T00:00:00Z",
          });
        expect((await kernel.querySource(context, "data")).rows).toHaveLength(100);
        expect(
          (await kernel.queryView(context, "all", { limit: 25, offset: 100 })).data.rows,
        ).toHaveLength(25);
        await expect(kernel.querySource(context, "data", { limit: 1001 })).rejects.toMatchObject({
          code: ERROR_CODES.validationInvalidInput,
        });
        await expect(
          kernel.querySource(context, "data", {
            filter: { path: ["instant"], operator: "gte", value: "not a date" },
          }),
        ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
        expect(
          (
            await kernel.querySource(context, "data", {
              filter: { path: ["instant"], operator: "eq", value: "2026-01-01T00:00:00.000Z" },
            })
          ).total,
        ).toBe(125);
        const query: SourceQueryDefinition = {
          aggregate: {
            group: { path: ["active"], as: "active" },
            measures: [{ as: "sum", operation: "sum", path: ["text"] }],
          },
        };
        expect((await kernel.querySource(context, "data", query)).rows).toEqual([
          { id: "true", values: { active: true, sum: 620 } },
        ]);
        const snapshot = await kernel.executeAction(context, "views.snapshot", {
          viewId: "all",
          label: "Snapshot",
        });
        expect(snapshot).toMatchObject({ count: 125 });
      } finally {
        await kernel.close();
      }
    }
  });

  it("keeps opaque IDs and own variables safe through short and durable execution", async () => {
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
      actions: [
        {
          key: "test.fail",
          run: () => {
            throw new Error("protected database details");
          },
        },
      ],
    });
    try {
      const { workspace, user } = await kernel.createRootWorkspace({
        name: "Safe variables",
        user: { name: "Owner" },
      });
      const context = { workspaceId: workspace.id, actorId: user.id };
      const short: RuleDefinition = {
        id: "constructor",
        key: "short",
        label: "Short",
        steps: [
          {
            id: "assign",
            compute: { assign: JSON.parse('{"__proto__":{"value":7},"constructor":9}') },
          },
        ],
        result: { $ref: "vars.__proto__.value" },
      };
      const durable: RuleDefinition = {
        id: "__proto__",
        key: "durable",
        label: "Durable",
        steps: [
          { id: "invoke", invoke: { ruleId: "constructor", as: "result" } },
          { id: "pause", wait: { signal: "ready" } },
        ],
        result: { $ref: "vars.result" },
      };
      await kernel.applySpec(context, { ...workspace.spec, rules: [short, durable] });
      expect((await kernel.runRule(context, "short")).result).toBe(7);
      const waiting = await kernel.startRule(context, "durable");
      expect(waiting.status).toBe("waiting");
      expect(
        (await kernel.resumeRule(context, waiting.id, { signal: "ready" })).checkpoint,
      ).toMatchObject({ result: 7 });
      const error = await kernel
        .executeAction(context, "test.fail")
        .catch((fault: unknown) => fault);
      expect(error).toBeInstanceOf(FrameworkError);
      expect(error).toMatchObject({
        code: ERROR_CODES.internalUnexpected,
        errorId: expect.any(String),
        cause: expect.objectContaining({ message: "protected database details" }),
      });
      expect(JSON.stringify((error as FrameworkError).toEnvelope())).not.toContain(
        "protected database details",
      );
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      expect(() => assertValidSpec({ ...workspace.spec, meta: cyclic })).toThrow(FrameworkError);
      expect(() => assertValidSpec({ ...workspace.spec, meta: { date: new Date() } })).toThrow(
        FrameworkError,
      );
    } finally {
      await kernel.close();
    }
  });
});
