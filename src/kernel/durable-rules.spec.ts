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

async function setup(
  persistence: PersistenceAdapter = new MemoryPersistenceAdapter(),
  durableRuleExecution = true,
) {
  let time = Date.parse("2026-09-17T00:00:00.000Z");
  let next = 0;
  const observed: string[] = [];
  const options: Parameters<typeof Kernel.open>[0] = {
    persistence,
    environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution },
    clock: { now: () => new Date(time).toISOString() },
    ids: { create: (kind) => `${kind}-${++next}` },
    actions: [
      {
        key: "test.capture",
        run: ({ context }) => {
          observed.push(context.actorId);
        },
      },
      {
        key: "test.publish",
        async run({ publish }) {
          await publish({ event: "test.happened", payload: { source: "action" } });
        },
      },
      {
        key: "test.fail",
        run: () => {
          throw new Error("Review failed");
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
  it("joins any after one branch fails and another succeeds", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "review",
          parallel: {
            join: "any",
            branches: [
              {
                id: "first",
                steps: [
                  { id: "first-wait", wait: { request: { label: "First", fields: [] } } },
                  { id: "fail", action: { key: "test.fail" } },
                ],
              },
              {
                id: "second",
                steps: [
                  { id: "second-wait", wait: { request: { label: "Second", fields: [] } } },
                  { id: "success", compute: { assign: { verdict: "approved" } } },
                ],
              },
            ],
          },
        },
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    const requests = await app.kernel.listActorRequests(app.context, paused.id);
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[0]!.id, {});
    const partial = await app.kernel.getRuleExecutionDetails(app.context, paused.id);
    expect(partial?.status).toBe("waiting");
    expect(partial?.branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ branchId: "first", status: "failed" }),
        expect.objectContaining({ branchId: "second", status: "waiting" }),
      ]),
    );
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[1]!.id, {});
    expect((await app.kernel.getRuleExecutionDetails(app.context, paused.id))?.vars).toMatchObject({
      second: { verdict: "approved" },
    });
    await app.kernel.close();
  });

  it("fails join-all and cancels requests still pending in other branches", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "reviews",
          parallel: {
            branches: [
              {
                id: "first",
                steps: [
                  { id: "first-wait", wait: { request: { label: "First", fields: [] } } },
                  { id: "fail", action: { key: "test.fail" } },
                ],
              },
              {
                id: "second",
                steps: [{ id: "second-wait", wait: { request: { label: "Second", fields: [] } } }],
              },
            ],
          },
        },
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    const requests = await app.kernel.listActorRequests(app.context, paused.id);
    await expect(
      app.kernel.respondToActorRequest(app.context, paused.id, requests[0]!.id, {}),
    ).rejects.toThrow("Review failed");
    expect((await app.kernel.getRuleExecution(app.context, paused.id))?.status).toBe("failed");
    expect(
      (await app.kernel.getActorRequest(app.context, paused.id, requests[1]!.id))?.status,
    ).toBe("cancelled");
    await app.kernel.close();
  });
  it("fans out dynamic parallel requests and gathers responses in input order", async () => {
    const app = await setup();
    await app.install([
      {
        ...rule([
          {
            id: "each",
            foreach: {
              source: { $ref: "vars.reviewers" },
              mode: "parallel",
              concurrency: 2,
              as: "reviewer",
              collect: {
                as: "reviews",
                value: { actor: { $ref: "vars.reviewer" }, answer: { $ref: "vars.answer" } },
              },
              steps: [
                { id: "ask", wait: { request: { label: "Review", fields: [] }, as: "answer" } },
              ],
            },
          },
        ]),
        input: { reviewers: { value: "array", required: true } },
        result: { $ref: "vars.reviews" },
      },
    ]);
    const paused = await app.kernel.startRule(app.context, "test", {
      input: { reviewers: ["one", "two", "three"] },
    });
    expect((await app.kernel.getRuleExecutionDetails(app.context, paused.id))?.waits).toHaveLength(
      2,
    );
    const requests = await app.kernel.listActorRequests(app.context, paused.id);
    expect(requests).toHaveLength(2);
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[1]!.id, {});
    const expanded = await app.kernel.listActorRequests(app.context, paused.id);
    expect(expanded).toHaveLength(3);
    await app.kernel.respondToActorRequest(app.context, paused.id, expanded[2]!.id, {});
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[0]!.id, {});
    const result = await app.kernel.getRuleExecutionDetails(app.context, paused.id);
    expect(result?.status).toBe("completed");
    expect(result?.result).toEqual([
      { actor: "one", answer: {} },
      { actor: "two", answer: {} },
      { actor: "three", answer: {} },
    ]);
    await app.kernel.close();
  });

  it("targets one of several pending signals by wait ID", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "parallel",
          parallel: {
            branches: [
              { id: "left", steps: [{ id: "left-wait", wait: { signal: "ready", as: "reply" } }] },
              {
                id: "right",
                steps: [{ id: "right-wait", wait: { signal: "ready", as: "reply" } }],
              },
            ],
          },
        },
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    const waits = (await app.kernel.getRuleExecutionDetails(app.context, paused.id))!.waits!;
    await expect(
      app.kernel.resumeRule(app.context, paused.id, { signal: "ready" }),
    ).rejects.toThrow("exactly one");
    await app.kernel.resumeRule(app.context, paused.id, {
      waitId: waits[1]!.id,
      signal: "ready",
      payload: { side: "right" },
    });
    expect((await app.kernel.getRuleExecution(app.context, paused.id))?.status).toBe("waiting");
    await app.kernel.resumeRule(app.context, paused.id, {
      waitId: waits[0]!.id,
      signal: "ready",
      payload: { side: "left" },
    });
    expect((await app.kernel.getRuleExecutionDetails(app.context, paused.id))?.vars).toMatchObject({
      left: { reply: { side: "left" } },
      right: { reply: { side: "right" } },
    });
    await app.kernel.close();
  });
  it("joins parallel reviews before a bounded approval and revision loop", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "revision",
          repeat: {
            times: 3,
            until: { op: "context.equals", left: { $ref: "vars.approval.approved" }, value: true },
            steps: [
              {
                id: "reviews",
                parallel: {
                  branches: [
                    { id: "seo", steps: [{ id: "seo-review", action: { key: "test.capture" } }] },
                    {
                      id: "brand",
                      steps: [{ id: "brand-review", action: { key: "test.capture" } }],
                    },
                  ],
                },
              },
              {
                id: "approval",
                wait: {
                  request: {
                    label: "Approve draft",
                    fields: [
                      {
                        id: "approved",
                        key: "approved",
                        label: "Approved",
                        type: "boolean",
                        required: true,
                      },
                    ],
                  },
                  as: "approval",
                },
              },
            ],
          },
        },
      ]),
    ]);
    let execution = await app.kernel.startRule(app.context, "test");
    expect(execution.status).toBe("waiting");
    expect(app.observed).toHaveLength(2);
    for (const approved of [false, true]) {
      const requests = await app.kernel.listActorRequests(app.context, execution.id);
      const pending = requests.find((request) => request.status === "pending");
      expect(pending).toBeDefined();
      await app.kernel.respondToActorRequest(app.context, execution.id, pending!.id, { approved });
      execution = (await app.kernel.getRuleExecution(app.context, execution.id))!;
    }
    expect(execution.status).toBe("completed");
    expect(app.observed).toHaveLength(4);
    await app.kernel.close();
  });
  it("automatically starts a durable subscription when an Action publishes its Event", async () => {
    const app = await setup();
    await app.install([
      {
        ...rule([delay, capture]),
        trigger: { event: "test.happened" },
      },
    ]);

    await app.kernel.executeAction(app.context, "test.publish");

    const [execution] = await app.kernel.listRuleExecutions(app.context);
    expect(execution).toMatchObject({
      actorId: app.context.actorId,
      rule: { id: "rule-test", key: "test" },
      status: "waiting",
    });
    expect(app.observed).toEqual([]);
    app.advance();
    await app.kernel.resumeRule(app.context, execution!.id);
    expect(app.observed).toEqual([app.context.actorId]);
    await app.kernel.close();
  });

  it("reports whether Event subscriptions used the short or durable runner", async () => {
    const app = await setup();
    await app.install([
      { ...rule([capture]), id: "rule-short", key: "short", trigger: { event: "mixed" } },
      { ...rule([delay]), id: "rule-durable", key: "durable", trigger: { event: "mixed" } },
    ]);

    const delivered = await app.kernel.dispatchEvent(app.context, { event: "mixed" });

    expect(delivered).toEqual([
      expect.objectContaining({ mode: "short", ruleId: "rule-short", status: "completed" }),
      expect.objectContaining({ mode: "durable", ruleId: "rule-durable", status: "waiting" }),
    ]);
    await app.kernel.close();
  });

  it("rejects a durable subscription before running any matching subscriber when disabled", async () => {
    const app = await setup(new MemoryPersistenceAdapter(), false);
    await app.install([
      { ...rule([capture]), id: "rule-short", key: "short", trigger: { event: "mixed" } },
      { ...rule([delay]), id: "rule-durable", key: "durable", trigger: { event: "mixed" } },
    ]);

    await expect(app.kernel.dispatchEvent(app.context, { event: "mixed" })).rejects.toMatchObject({
      code: "PERSISTENCE.UNSUPPORTED",
    });
    expect(app.observed).toEqual([]);
    expect(await app.kernel.listRuleExecutions(app.context)).toEqual([]);
    await app.kernel.close();
  });

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
  it("publishes a declared result after durable execution completes", async () => {
    const app = await setup();
    await app.install([
      {
        ...rule([delay, { id: "value", compute: { assign: { answer: "done" } } }]),
        result: { $ref: "vars.answer" },
      },
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    expect(
      (await app.kernel.getRuleExecutionDetails(app.context, paused.id))?.result,
    ).toBeUndefined();
    app.advance();
    await app.kernel.resumeRule(app.context, paused.id);
    expect((await app.kernel.getRuleExecutionDetails(app.context, paused.id))?.result).toBe("done");
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

  it("keeps independent parallel requests and joins only after both replies", async () => {
    const app = await setup();
    await app.install([
      rule([
        {
          id: "parallel",
          parallel: {
            branches: [
              {
                id: "first",
                steps: [
                  {
                    id: "first-ask",
                    wait: { request: { label: "First review", fields: [] }, as: "answer" },
                  },
                  { id: "first-done", compute: { assign: { verdict: "first" } } },
                ],
              },
              {
                id: "second",
                steps: [
                  {
                    id: "second-ask",
                    wait: { request: { label: "Second review", fields: [] }, as: "answer" },
                  },
                  { id: "second-done", compute: { assign: { verdict: "second" } } },
                ],
              },
            ],
          },
        },
        capture,
      ]),
    ]);
    const paused = await app.kernel.startRule(app.context, "test");
    expect(paused.status).toBe("waiting");
    const details = await app.kernel.getRuleExecutionDetails(app.context, paused.id);
    expect(details?.waits).toHaveLength(2);
    const requests = await app.kernel.listActorRequests(app.context, paused.id);
    expect(requests).toHaveLength(2);
    expect(app.observed).toHaveLength(0);
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[1]!.id, {});
    expect((await app.kernel.getRuleExecution(app.context, paused.id))?.status).toBe("waiting");
    expect(app.observed).toHaveLength(0);
    await app.kernel.respondToActorRequest(app.context, paused.id, requests[0]!.id, {});
    const completed = await app.kernel.getRuleExecutionDetails(app.context, paused.id);
    expect(completed?.status).toBe("completed");
    expect(completed?.vars).toMatchObject({
      first: { verdict: "first" },
      second: { verdict: "second" },
    });
    expect(app.observed).toHaveLength(1);
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
          {
            id: "reviews",
            parallel: {
              branches: [
                {
                  id: "first",
                  steps: [
                    { id: "first-request", wait: { request: { label: "First", fields: [] } } },
                  ],
                },
                {
                  id: "second",
                  steps: [
                    { id: "second-request", wait: { request: { label: "Second", fields: [] } } },
                  ],
                },
              ],
            },
          },
          { ...capture, id: "after" },
        ]),
      ]);
      const paused = await app.kernel.startRule(app.context, "test");
      await app.kernel.close();
      app.advance();
      const reopened = await Kernel.open(app.options);
      try {
        const requests = await reopened.listActorRequests(app.context, paused.id);
        expect(requests).toHaveLength(2);
        await reopened.respondToActorRequest(app.context, paused.id, requests[1]!.id, {});
        expect((await reopened.getRuleExecution(app.context, paused.id))?.status).toBe("waiting");
        await reopened.respondToActorRequest(app.context, paused.id, requests[0]!.id, {});
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
    const kernel = await Kernel.open(app.options);
    const paused = await kernel.startRule(app.context, "test");
    app.advance();
    await expect(kernel.resumeRule(app.context, paused.id)).rejects.toThrow("Review failed");
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
