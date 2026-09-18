import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type JsonValue, type Spec } from "../spec/model.ts";
import type { ActionDefinition } from "./action-registry.ts";
import {
  collectInferenceRun,
  type InferenceEvent,
  type InferenceRuntime,
  type InferenceContext,
} from "./inference-runtime.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

describe("InferenceRuntime", () => {
  it("projects opted-in Actions and Rules and executes tools through the Kernel", async () => {
    const runtime = new RecordingInferenceRuntime(async (context) => {
      const tools = await context.tools.resolve({
        execution: context.execution,
        actor: context.actor,
        messages: context.messages,
        step: 1,
        activeToolIds: new Set(["rule:rule-summarize"]),
        ...(context.metadata ? { metadata: context.metadata } : {}),
      });
      const created = await tools.execute({
        id: "call-create",
        toolId: "action:records.create",
        input: {
          sourceId: "collection-task",
          values: { "field-title": "Draft release notes" },
        },
      });
      const rule = await tools.execute({
        id: "call-rule",
        toolId: "rule:rule-summarize",
        input: { topic: "Release" },
      });
      return { created, rule };
    });
    const { kernel, owner, agent } = await bootstrap(runtime, [echoAction]);
    await kernel.applySpec(owner, agentSpec());

    const events = await kernel.runInference(agent, {
      messages: [{ role: "user", content: "Create a task and summarize the release." }],
      metadata: { requestId: "request-1" },
    });
    const output = await collectInferenceRun(events);

    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]?.actor).toMatchObject({ id: agent.actorId, kind: "agent" });
    expect(runtime.requests[0]?.execution).toEqual(agent);
    expect(runtime.requests[0]?.metadata).toEqual({ requestId: "request-1" });
    expect(runtime.requests[0]?.instructions).toBe("Help the team.");
    expect(runtime.requests[0]?.model).toMatchObject({
      provider: "test",
      model: "test-model",
    });
    const listed = await kernel.listInferenceTools(agent);
    expect(listed.map((tool) => tool.id)).toEqual(
      expect.arrayContaining([
        "action:sources.list",
        "action:views.list",
        "action:records.create",
        "action:records.get",
        "action:records.list",
        "action:records.update",
        "action:records.delete",
        "action:views.query",
        "action:views.snapshot",
        "action:tests.echo",
        "rule:rule-summarize",
      ]),
    );
    expect(listed.map((tool) => tool.id)).not.toContain("action:tests.hidden");
    expect(listed.map((tool) => tool.id)).not.toContain("rule:rule-ui-only");
    expect(listed.map((tool) => tool.id)).not.toContain("rule:rule-disabled");
    expect(listed.find((tool) => tool.id === "rule:rule-summarize")?.input).toEqual({
      type: "object",
      properties: { topic: { type: "string" } },
      required: ["topic"],
      additionalProperties: false,
    });
    expect(output).toMatchObject({
      created: { sourceId: "collection-task", title: "Draft release notes" },
      rule: { mode: "short", ruleId: "rule-summarize", status: "completed" },
    });
    await expect(kernel.listRecords(agent, "task")).resolves.toHaveLength(1);
    await kernel.close();
  });

  it("allows a User Actor while requiring an enabled runtime capability", async () => {
    const runtime = new RecordingInferenceRuntime(async (context) => ({
      actorId: context.actor.id,
      actorKind: context.actor.kind,
    }));
    const enabled = await bootstrap(runtime);
    await expect(
      collectInferenceRun(await enabled.kernel.runInference(enabled.owner, { messages: [] })),
    ).resolves.toEqual({ actorId: enabled.owner.actorId, actorKind: "user" });
    await enabled.kernel.close();

    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      inference: runtime,
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
    await expect(kernel.runInference(owner, { messages: [] })).rejects.toMatchObject({
      code: ERROR_CODES.environmentCapabilityUnavailable,
    });
    await kernel.close();
  });

  it("uses persisted Agent tool policy to narrow the dynamic catalog", async () => {
    const runtime = new RecordingInferenceRuntime(async (context) => {
      const set = await context.tools.resolve({
        execution: context.execution,
        actor: context.actor,
        messages: context.messages,
        step: 1,
        activeToolIds: new Set(),
      });
      return { tools: set.tools.map((tool) => tool.id) };
    });
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({
        ...LOCAL_BROWSER_ENVIRONMENT,
        inference: true,
      }),
      inference: runtime,
      actions: [echoAction],
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
    const created = await kernel.createAgent(owner, {
      name: "Focused assistant",
      instructions: "Only echo.",
      provider: "test",
      model: "small-model",
      permissions: ["read"],
      tools: { include: ["action:tests.echo"], search: false },
    });
    const agent = { ...owner, actorId: created.actor.id };

    await expect(
      collectInferenceRun(await kernel.runInference(agent, { messages: [] })),
    ).resolves.toEqual({
      tools: ["action:tests.echo"],
    });
    await expect(kernel.listInferenceTools(agent)).resolves.toEqual([
      expect.objectContaining({ id: "action:tests.echo" }),
    ]);
    await kernel.close();
  });

  it("keeps tool invocation inside the underlying authorization boundary", async () => {
    const runtime = new RecordingInferenceRuntime((context) =>
      context.tools
        .resolve({
          execution: context.execution,
          actor: context.actor,
          messages: context.messages,
          step: 1,
          activeToolIds: new Set(),
        })
        .then((tools) =>
          tools.execute({
            id: "call-create",
            toolId: "action:records.create",
            input: { sourceId: "collection-task", values: { "field-title": "Forbidden" } },
          }),
        ),
    );
    const { kernel, owner, agent, actorId } = await bootstrap(runtime);
    await kernel.applySpec(owner, agentSpec());
    await kernel.updateMembership(owner, {
      actorId,
      workspaceId: owner.workspaceId,
      permissions: ["read"],
    });

    const events = await kernel.runInference(agent, { messages: [] });
    await expect(collectInferenceRun(events)).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    await expect(kernel.listRecords(owner, "task")).resolves.toHaveLength(0);
    await kernel.close();
  });

  it("lets a Rule call the same runtime through an explicit Agent binding", async () => {
    const runtime = new RecordingInferenceRuntime(async (context) => ({
      actorId: context.actor.id,
      answer: "Ready",
    }));
    let agentId = "";
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({
        ...LOCAL_BROWSER_ENVIRONMENT,
        inference: true,
      }),
      inference: runtime,
      resolveActorBinding: async ({ binding }) => {
        if (binding !== "assistant") throw new Error(`Unexpected binding ${binding}`);
        return agentId;
      },
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
    const created = await kernel.createAgent(owner, {
      name: "Assistant",
      instructions: "Help the team.",
      provider: "test",
      model: "test-model",
    });
    const actor = created.actor;
    agentId = actor.id;
    await kernel.applySpec(owner, {
      ...createEmptySpec({ id: "spec-rule-agent", key: "rule_agent", label: "Rule agent" }),
      rules: [
        {
          id: "rule-ask-agent",
          key: "ask_agent",
          label: "Ask agent",
          steps: [
            {
              id: "step-ask-agent",
              action: {
                key: "inference.run",
                runAs: "assistant",
                as: "response",
                input: { messages: [{ role: "user", content: "Help me." }] },
              },
            },
          ],
        },
      ],
    });

    const run = await kernel.runRule(owner, "ask_agent");

    expect(run.vars.response).toEqual({ actorId: actor.id, answer: "Ready" });
    expect(runtime.requests[0]?.execution).toEqual({ ...owner, actorId: actor.id });
    await kernel.close();
  });

  it("rejects invalid runtime completion streams deterministically", async () => {
    async function* incomplete(): AsyncIterable<InferenceEvent> {
      yield { type: "text_delta", step: 1, delta: "hello" };
    }
    async function* duplicate(): AsyncIterable<InferenceEvent> {
      yield { type: "completed", output: "first" };
      yield { type: "completed", output: "second" };
    }
    await expect(collectInferenceRun(incomplete())).rejects.toMatchObject({
      code: ERROR_CODES.inferenceInvalidStream,
    });
    await expect(collectInferenceRun(duplicate())).rejects.toMatchObject({
      code: ERROR_CODES.inferenceInvalidStream,
    });
  });
});

class RecordingInferenceRuntime implements InferenceRuntime {
  readonly requests: InferenceContext[] = [];

  constructor(
    private readonly execute: (request: InferenceContext) => Promise<JsonValue> | JsonValue,
  ) {}

  async *run(context: InferenceContext): AsyncIterable<InferenceEvent> {
    this.requests.push(context);
    yield { type: "completed", output: await this.execute(context) };
  }
}

async function bootstrap(runtime: InferenceRuntime, actions: readonly ActionDefinition[] = []) {
  const kernel = await Kernel.open({
    persistence: new MemoryPersistenceAdapter(),
    environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, inference: true }),
    inference: runtime,
    actions: [
      ...actions,
      {
        key: "tests.hidden",
        run: () => ({ hidden: true }),
      },
    ],
  });
  const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
  const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
  const created = await kernel.createAgent(owner, {
    name: "Assistant",
    instructions: "Help the team.",
    provider: "test",
    model: "test-model",
    permissions: ["read", "create", "update", "delete", "manage"],
  });
  const actor = created.actor;
  return {
    kernel,
    owner,
    actorId: actor.id,
    agent: { ...owner, actorId: actor.id },
  };
}

const echoAction: ActionDefinition = {
  key: "tests.echo",
  tool: {
    label: "Echo",
    description: "Return a supplied value.",
    input: {
      type: "object",
      properties: { value: { type: "json" } },
      required: ["value"],
      additionalProperties: false,
    },
  },
  run: ({ input }) => input.value ?? null,
};

function agentSpec(): Spec {
  return {
    ...createEmptySpec({ id: "spec-agents", key: "agents", label: "Agents" }),
    collections: [
      {
        id: "collection-task",
        key: "task",
        label: "Task",
        fields: [{ id: "field-title", key: "title", label: "Title", type: "text" }],
      },
    ],
    rules: [
      {
        id: "rule-summarize",
        key: "summarize",
        label: "Summarize",
        description: "Summarize a topic.",
        expose: ["agent"],
        input: { topic: { value: "text", required: true } },
        steps: [{ id: "step-summary", compute: { assign: { summary: { $ref: "vars.topic" } } } }],
      },
      {
        id: "rule-ui-only",
        key: "ui_only",
        label: "UI only",
        expose: ["ui"],
        steps: [],
      },
      {
        id: "rule-disabled",
        key: "disabled",
        label: "Disabled",
        enabled: false,
        expose: ["agent"],
        steps: [],
      },
    ],
  };
}
