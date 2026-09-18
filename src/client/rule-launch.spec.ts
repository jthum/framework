import { describe, expect, it, vi } from "vite-plus/test";
import { Kernel } from "../kernel/kernel.ts";
import { LOCAL_BROWSER_ENVIRONMENT } from "../kernel/environment.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type RuleDefinition } from "../spec/model.ts";
import { requiresDurableExecution } from "../kernel/rule-compatibility.ts";
import { createWorkspaceClient } from "./workspace-client.ts";
import { launchRule } from "./rule-launch.ts";

describe("Rule launch routing", () => {
  it("keeps short runs lightweight and persists durable/nested runs with the bound Actor", async () => {
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
    });
    try {
      const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
      const client = await createWorkspaceClient(kernel, {
        workspaceId: root.workspace.id,
        actorId: root.user.id,
      });
      await client.applySpec({
        ...createEmptySpec({ id: "spec", key: "test", label: "Test" }),
        rules: [
          {
            id: "short",
            key: "short",
            label: "Short",
            input: { message: { value: "text" } },
            steps: [{ id: "copy", compute: { assign: { copied: { $ref: "vars.message" } } } }],
          },
          {
            id: "wait",
            key: "wait",
            label: "Wait",
            steps: [{ id: "delay", delay: { duration: "1h" } }],
          },
          {
            id: "nested",
            key: "nested",
            label: "Nested",
            steps: [{ id: "invoke", invoke: { ruleId: "wait" } }],
          },
        ],
      });
      expect(await launchRule(client, "short", { input: { message: "Hello" } })).toMatchObject({
        mode: "short",
        run: { vars: { copied: "Hello" }, actorId: root.user.id },
      });
      expect(await client.listRuleExecutions()).toEqual([]);
      for (const key of ["wait", "nested"]) {
        const result = await launchRule(client, key);
        expect(result).toMatchObject({
          mode: "durable",
          execution: { status: "waiting", actorId: root.user.id },
        });
      }
      expect(await client.listRuleExecutions()).toHaveLength(2);
      await expect(launchRule(client, "missing")).rejects.toMatchObject({
        code: "RESOURCE.NOT_FOUND",
      });
    } finally {
      await kernel.close();
    }
  });

  it("handles cyclic invocations and finds waits inside branches", () => {
    const a: RuleDefinition = {
      id: "a",
      key: "a",
      label: "A",
      steps: [{ id: "ab", invoke: { ruleId: "b" } }],
    };
    const b: RuleDefinition = {
      id: "b",
      key: "b",
      label: "B",
      steps: [{ id: "ba", invoke: { ruleId: "a" } }],
    };
    expect(requiresDurableExecution(a, [a, b])).toBe(false);
    const waiting = { ...b, steps: [...b.steps, { id: "delay", delay: { duration: 10 } }] };
    expect(requiresDurableExecution(a, [a, waiting])).toBe(true);
  });

  it("never falls back to a short run when durable execution is unavailable", async () => {
    const runRule = vi.fn();
    const startRule = vi.fn().mockRejectedValue(new Error("Durable execution disabled"));
    await expect(
      launchRule(
        {
          listRules: async () => [
            {
              id: "wait",
              key: "wait",
              label: "Wait",
              steps: [{ id: "delay", delay: { duration: 1 } }],
            },
          ],
          runRule,
          startRule,
        },
        "wait",
      ),
    ).rejects.toThrow("disabled");
    expect(runRule).not.toHaveBeenCalled();
  });
});
