import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import type { PersistenceAdapter } from "../persistence/catalog.ts";
import { createEmptySpec, type RuleDefinition, type RuleStep } from "../spec/model.ts";
import { SqlitePersistenceAdapter } from "../sqlite/catalog.ts";
import { openNodeSqlite } from "../sqlite/node.ts";
import { LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

const capture: RuleStep = { id: "capture", action: { key: "test.capture" } };
const delay: RuleStep = { id: "delay", delay: { duration: "1s" } };
const rule = (steps: readonly RuleStep[]): RuleDefinition => ({
  id: "rule-test",
  key: "test",
  label: "Test",
  steps,
});

async function setup(persistence: PersistenceAdapter = new MemoryPersistenceAdapter()) {
  let time = Date.parse("2026-09-17T00:00:00.000Z");
  let next = 0;
  const observed: string[] = [];
  const options: Parameters<typeof Kernel.open>[0] = {
    persistence,
    environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
    clock: { now: () => new Date(time).toISOString() },
    ids: { create: (kind) => `${kind}-${++next}` },
    actions: [
      {
        key: "test.capture",
        run: ({ context }) => {
          observed.push(context.actorId);
        },
      },
    ],
  };
  const kernel = await Kernel.open(options);
  const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
  const context = { workspaceId: root.workspace.id, actorId: root.user.id };
  const install = (rules: readonly RuleDefinition[]) =>
    kernel.applySpec(context, {
      ...createEmptySpec({ id: "spec-test", key: "test", label: "Test" }),
      rules,
    });
  return {
    kernel,
    root,
    context,
    options,
    observed,
    install,
    advance: () => {
      time += 1000;
    },
  };
}

describe("Durable Rules", () => {
  it("checkpoints the current-time binding across a durable wait", async () => {
    const app = await setup();
    await app.install([
      rule([delay, { id: "clock", compute: { assign: { now: { $ref: "meta.now" } } } }]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    app.advance();
    const resumed = await app.kernel.resumeRule(app.context, paused.id);
    expect(resumed.status).toBe("completed");
    const details = await app.kernel.getRuleExecutionDetails(app.context, paused.id);
    expect(details?.vars?.now).toBe("2026-09-17T00:00:00.000Z");
    await app.kernel.close();
  });
  it("claims a resumed wait before effects and never replays preceding Actions", async () => {
    const app = await setup();
    await app.install([rule([capture, delay, { ...capture, id: "after" }])]);
    const paused = await app.kernel.startRule(app.context, "test");
    expect(paused.status).toBe("waiting");
    expect(app.observed).toEqual([app.context.actorId]);
    await expect(app.kernel.resumeRule(app.context, paused.id)).rejects.toThrow("not due");
    app.advance();
    const results = await Promise.allSettled([
      app.kernel.resumeRule(app.context, paused.id),
      app.kernel.resumeRule(app.context, paused.id),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(app.observed).toEqual([app.context.actorId, app.context.actorId]);
    expect((await app.kernel.getRuleExecution(app.context, paused.id))?.status).toBe("completed");
  });

  it("uses immutable snapshots even after the live Rule is changed", async () => {
    const app = await setup();
    await app.install([rule([delay, capture])]);
    const paused = await app.kernel.startRule(app.context, "test");
    await app.install([rule([])]);
    app.advance();
    expect((await app.kernel.resumeRule(app.context, paused.id)).status).toBe("completed");
    expect(app.observed).toEqual([app.context.actorId]);
  });

  it("persists nested invocation and loop positions across multiple waits", async () => {
    const app = await setup();
    const nested: RuleDefinition = {
      id: "nested",
      key: "nested",
      label: "Nested",
      steps: [delay, capture],
    };
    await app.install([
      rule([
        {
          id: "loop",
          repeat: { times: 2, steps: [{ id: "invoke", invoke: { ruleId: "nested" } }] },
        },
      ]),
      nested,
    ]);
    let execution = await app.kernel.startRule(app.context, "test");
    app.advance();
    execution = await app.kernel.resumeRule(app.context, execution.id);
    expect(execution.status).toBe("waiting");
    app.advance();
    execution = await app.kernel.resumeRule(app.context, execution.id);
    expect(execution.status).toBe("completed");
    expect(app.observed).toEqual([app.context.actorId, app.context.actorId]);
  });

  it("matches signals and gives elapsed deadlines precedence over late signals", async () => {
    const app = await setup();
    await app.install([
      rule([
        { id: "wait", wait: { signal: "ready", timeout: "1s", as: "reply", onSignal: [capture] } },
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    await expect(
      app.kernel.resumeRule(app.context, paused.id, { signal: "wrong" }),
    ).rejects.toThrow("does not match");
    const complete = await app.kernel.resumeRule(app.context, paused.id, {
      signal: "ready",
      payload: { yes: true },
    });
    expect(complete.status).toBe("completed");
    expect(app.observed).toHaveLength(1);
    const late = await app.kernel.startRule(app.context, "test");
    app.advance();
    await app.kernel.resumeRule(app.context, late.id, { signal: "ready" });
    expect(app.observed).toHaveLength(1);
  });

  it("validates User responses, denies System, and preserves the initiating Actor", async () => {
    const app = await setup();
    const reviewer = await app.kernel.createActor(app.context, { kind: "user", name: "Reviewer" });
    await app.kernel.addMembership(app.context, {
      workspaceId: app.context.workspaceId,
      actorId: reviewer.id,
      permissions: ["read"],
    });
    await app.install([
      rule([
        {
          id: "approve",
          wait: {
            request: {
              actor: "reviewer",
              label: "Approve",
              fields: [
                {
                  id: "field-answer",
                  key: "answer",
                  label: "Answer",
                  type: "text",
                  required: true,
                },
              ],
            },
          },
        },
        capture,
      ]),
    ]);
    const kernel = await Kernel.open({
      ...app.options,
      resolveActorBinding: async () => reviewer.id,
    });
    const system = { ...app.context, actorId: app.root.system.id };
    const paused = await kernel.startRule(system, "test");
    const requests = paused.checkpoint.requests as unknown as { id: string }[];
    const id = requests[0]!.id;
    const assigned = { ...app.context, actorId: reviewer.id };
    await expect(
      kernel.respondToActorRequest(system, paused.id, id, { answer: "yes" }),
    ).rejects.toThrow("assigned User");
    await expect(kernel.respondToActorRequest(assigned, paused.id, id, {})).rejects.toThrow();
    await expect(kernel.getRuleExecution(assigned, paused.id)).rejects.toThrow();
    const response = await kernel.respondToActorRequest(assigned, paused.id, id, { answer: "yes" });
    expect(response.status).toBe("responded");
    expect(response).not.toHaveProperty("checkpoint");
    expect(app.observed).toEqual([app.root.system.id]);
    await expect(
      kernel.respondToActorRequest(assigned, paused.id, id, { answer: "yes" }),
    ).rejects.toThrow("not waiting");
  });

  it("rechecks authority rather than preserving permission in the checkpoint", async () => {
    const app = await setup();
    await app.install([rule([delay, capture])]);
    const paused = await app.kernel.startRule(app.context, "test");
    app.advance();
    const denied = await Kernel.open({
      ...app.options,
      authorizer: { authorize: async () => ({ allowed: false }) },
    });
    await expect(denied.resumeRule(app.context, paused.id)).rejects.toThrow();
    expect(app.observed).toHaveLength(0);
    expect((await app.kernel.getRuleExecution(app.context, paused.id))?.status).toBe("waiting");
  });

  it("fails closed for unsupported durable branches before performing Actions", async () => {
    const app = await setup();
    await app.install([
      rule([capture, { id: "parallel", parallel: { branches: [{ id: "branch", steps: [] }] } }]),
    ]);
    await expect(app.kernel.startRule(app.context, "test")).rejects.toThrow("not compatible");
    expect(app.observed).toHaveLength(0);
    const disabled = await Kernel.open({ ...app.options, environment: LOCAL_BROWSER_ENVIRONMENT });
    expect(() => disabled.startRule(app.context, "test")).toThrow("does not enable");
  });

  it("continues after a real SQLite close/reopen without replay", async () => {
    const directory = await mkdtemp(join(tmpdir(), "framework-durable-"));
    try {
      const app = await setup(
        new SqlitePersistenceAdapter(() => openNodeSqlite(join(directory, "catalog.db"))),
      );
      await app.install([
        rule([
          capture,
          { id: "approval", wait: { request: { label: "Approve", fields: [] } } },
          { ...capture, id: "after" },
        ]),
      ]);
      const paused = await app.kernel.startRule(app.context, "test");
      await app.kernel.close();
      app.advance();
      const reopened = await Kernel.open(app.options);
      try {
        const [request] = await reopened.listActorRequests(app.context, paused.id);
        await reopened.respondToActorRequest(app.context, paused.id, request!.id, {});
        const result = await reopened.getRuleExecution(app.context, paused.id);
        expect(result?.status).toBe("completed");
        expect(result?.context).toEqual(app.context);
        expect(app.observed).toEqual([app.context.actorId, app.context.actorId]);
      } finally {
        await reopened.close();
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  });

  it("expires User requests through the timeout branch", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "approval",
          wait: { timeout: "1s", request: { label: "Approve", fields: [] }, onTimeout: [capture] },
        },
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    const [request] = await app.kernel.listActorRequests(app.context, paused.id);
    app.advance();
    await expect(
      app.kernel.respondToActorRequest(app.context, paused.id, request!.id, {}),
    ).rejects.toThrow("expired");
    await app.kernel.resumeRule(app.context, paused.id);
    expect((await app.kernel.getActorRequest(app.context, paused.id, request!.id))?.status).toBe(
      "expired",
    );
    expect(app.observed).toHaveLength(1);
  });

  it("compensates a known Action failure and stores a terminal failure", async () => {
    const app = await setup();
    await app.install([
      rule([
        { id: "first", action: { key: "test.capture", compensate: { key: "test.capture" } } },
        delay,
        { id: "fail", action: { key: "test.fail" } },
      ]),
    ]);
    const kernel = await Kernel.open({
      ...app.options,
      actions: [
        ...app.options.actions!,
        {
          key: "test.fail",
          run: () => {
            throw new Error("known failure");
          },
        },
      ],
    });
    const paused = await kernel.startRule(app.context, "test");
    app.advance();
    await expect(kernel.resumeRule(app.context, paused.id)).rejects.toThrow("known failure");
    expect((await kernel.getRuleExecution(app.context, paused.id))?.status).toBe("failed");
    expect(app.observed).toHaveLength(2);
    await expect(kernel.resumeRule(app.context, paused.id)).rejects.toThrow("not waiting");
  });

  it("does not compensate or replay when a checkpoint write fails after an effect", async () => {
    const adapter = new MemoryPersistenceAdapter();
    const session = await adapter.open();
    let failWrites = false;
    const original = session.executions.update.bind(session.executions);
    session.executions.update = async (execution, revision) => {
      if (failWrites) throw new Error("storage offline");
      return original(execution, revision);
    };
    const app = await setup({ kind: "memory", open: async () => session });
    await app.install([
      rule([
        delay,
        { id: "effect", action: { key: "test.capture", compensate: { key: "test.capture" } } },
      ]),
    ]);
    const kernel = await Kernel.open({
      ...app.options,
      actions: [
        {
          key: "test.capture",
          run: () => {
            app.observed.push("effect");
            failWrites = true;
          },
        },
      ],
    });
    const paused = await kernel.startRule(app.context, "test");
    app.advance();
    await expect(kernel.resumeRule(app.context, paused.id)).rejects.toThrow("storage offline");
    expect(app.observed).toEqual(["effect"]);
    failWrites = false;
    expect((await kernel.getRuleExecution(app.context, paused.id))?.status).toBe("running");
    await expect(kernel.resumeRule(app.context, paused.id)).rejects.toThrow("not waiting");
    expect((await kernel.failRuleExecution(app.context, paused.id)).status).toBe("failed");
    expect(app.observed).toEqual(["effect"]);
  });

  it("rejects unsupported duration strings before earlier effects", async () => {
    const app = await setup();
    await app.install([rule([capture, { id: "delay", delay: { duration: "sometime" } }])]);
    await expect(app.kernel.startRule(app.context, "test")).rejects.toThrow("wait duration");
    expect(app.observed).toHaveLength(0);
  });
});
