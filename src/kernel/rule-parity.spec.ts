import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { RuleDefinition } from "../spec/model.ts";
import { LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

async function setup() {
  const effects: unknown[] = [];
  const kernel = await Kernel.open({
    persistence: new MemoryPersistenceAdapter(),
    environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
    clock: { now: () => "2026-10-20T00:00:00.000Z" },
    actions: [
      {
        key: "test.echo",
        run: ({ context, input }) => {
          effects.push({ actor: context.actorId, value: input.value });
          return input.value ?? null;
        },
      },
      {
        key: "test.write",
        run: () => {
          effects.push("write");
          return "not a number";
        },
      },
      {
        key: "test.undo",
        run: () => {
          effects.push("undo");
        },
      },
    ],
  });
  const root = await kernel.createRootWorkspace({ name: "Parity", user: { name: "Owner" } });
  const context = { workspaceId: root.workspace.id, actorId: root.user.id };
  const install = (rules: readonly RuleDefinition[]) =>
    kernel.applySpec(context, { ...root.workspace.spec, rules });
  return { kernel, context, effects, install };
}

describe("short and durable Rule semantics", () => {
  it("preserves Action authority, nested results, loops and trace order", async () => {
    const app = await setup();
    try {
      const nested: RuleDefinition = {
        id: "nested",
        key: "nested",
        label: "Nested",
        input: { value: { value: "number", required: true } },
        steps: [
          {
            id: "echo",
            action: { key: "test.echo", input: { value: { $ref: "vars.value" } }, as: "answer" },
          },
        ],
        result: { $ref: "vars.answer" },
      };
      await app.install([
        nested,
        {
          id: "root",
          key: "root",
          label: "Root",
          input: { items: { value: "array", required: true } },
          steps: [
            {
              id: "items",
              foreach: {
                source: { $ref: "vars.items" },
                steps: [
                  {
                    id: "invoke",
                    invoke: {
                      ruleId: nested.id,
                      input: { value: { $ref: "vars.item" } },
                      as: "value",
                    },
                  },
                ],
                collect: { as: "collected", value: { $ref: "vars.value" } },
              },
            },
            {
              id: "repeat",
              repeat: {
                times: 2,
                steps: [{ id: "set", compute: { assign: { last: { $ref: "vars.index" } } } }],
              },
            },
            {
              id: "gate",
              gate: {
                predicate: { op: "always" },
                pass: [{ id: "capture", action: { key: "test.echo", input: { value: "done" } } }],
              },
            },
          ],
          result: { items: { $ref: "vars.collected" }, last: { $ref: "vars.last" } },
        },
      ]);
      const short = await app.kernel.runRule(app.context, "root", { input: { items: [2, 4] } });
      const expectedEffects = [
        { actor: app.context.actorId, value: 2 },
        { actor: app.context.actorId, value: 4 },
        { actor: app.context.actorId, value: "done" },
      ];
      expect(short.result).toEqual({ items: [2, 4], last: 1 });
      expect(app.effects).toEqual(expectedEffects);
      app.effects.length = 0;
      const execution = await app.kernel.startRule(app.context, "root", {
        input: { items: [2, 4] },
      });
      const details = await app.kernel.getRuleExecutionDetails(app.context, execution.id);
      expect(details?.result).toEqual(short.result);
      expect(details?.trace.map(({ label: _label, ...trace }) => trace)).toEqual(short.trace);
      expect(app.effects).toEqual(expectedEffects);
    } finally {
      await app.kernel.close();
    }
  });

  it.each(["short", "durable"] as const)(
    "%s compensates an Action whose declared output fails",
    async (mode) => {
      const app = await setup();
      try {
        await app.install([
          {
            id: "root",
            key: "root",
            label: "Root",
            steps: [
              {
                id: "write",
                action: {
                  key: "test.write",
                  output: { type: "number" },
                  compensate: { key: "test.undo" },
                },
              },
            ],
          },
        ]);
        await expect(
          mode === "short"
            ? app.kernel.runRule(app.context, "root")
            : app.kernel.startRule(app.context, "root"),
        ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
        expect(app.effects).toEqual(["write", "undo"]);
      } finally {
        await app.kernel.close();
      }
    },
  );

  it.each(["short", "durable"] as const)(
    "%s preflights nested Rules in unreachable branches before effects",
    async (mode) => {
      const app = await setup();
      try {
        await app.install([
          {
            id: "nested",
            key: "nested",
            label: "Nested",
            steps: [{ id: "missing", action: { key: "not.installed" } }],
          },
          {
            id: "root",
            key: "root",
            label: "Root",
            steps: [
              { id: "write", action: { key: "test.write" } },
              {
                id: "gate",
                gate: {
                  predicate: { op: "always" },
                  fail: [{ id: "hidden", invoke: { ruleId: "nested" } }],
                },
              },
            ],
          },
        ]);
        await expect(
          mode === "short"
            ? app.kernel.runRule(app.context, "root")
            : app.kernel.startRule(app.context, "root"),
        ).rejects.toMatchObject({ code: ERROR_CODES.persistenceUnsupported });
        expect(app.effects).toEqual([]);
        expect(await app.kernel.listRuleExecutions(app.context)).toEqual([]);
      } finally {
        await app.kernel.close();
      }
    },
  );
});
