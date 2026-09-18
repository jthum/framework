import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type JsonValue, type Spec } from "../spec/model.ts";
import type { ActionDefinition } from "./action-registry.ts";
import {
  collectAgentRun,
  type AgentEvent,
  type AgentRuntime,
  type AgentContext,
  type InferenceAdapter,
  type InferenceEvent,
  type InferenceInput,
} from "./agent-runtime.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import { Kernel } from "./kernel.ts";

describe("AgentRuntime", () => {
  it("projects opted-in Actions and Rules and executes tools through the Kernel", async () => {
    const runtime = new RecordingAgentRuntime(async (context) => {
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

    const events = await kernel.runAgent(agent, {
      messages: [{ role: "user", content: "Create a task and summarize the release." }],
      metadata: { requestId: "request-1" },
    });
    const output = await collectAgentRun(events);

    expect(runtime.requests).toHaveLength(1);
    expect(runtime.requests[0]?.actor).toMatchObject({ id: agent.actorId, kind: "agent" });
    expect(runtime.requests[0]?.execution).toEqual(agent);
    expect(runtime.requests[0]?.metadata).toEqual({ requestId: "request-1" });
    expect(runtime.requests[0]?.instructions).toBe("Help the team.");
    expect(runtime.requests[0]?.model).toMatchObject({
      provider: "test",
      model: "test-model",
    });
    const listed = await kernel.listAgentTools(agent);
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
    const runtime = new RecordingAgentRuntime(async (context) => ({
      actorId: context.actor.id,
      actorKind: context.actor.kind,
    }));
    const enabled = await bootstrap(runtime);
    await expect(
      collectAgentRun(await enabled.kernel.runAgent(enabled.owner, { messages: [] })),
    ).resolves.toEqual({ actorId: enabled.owner.actorId, actorKind: "user" });
    await enabled.kernel.close();

    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      agentRuntime: runtime,
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
    await expect(kernel.runAgent(owner, { messages: [] })).rejects.toMatchObject({
      code: ERROR_CODES.environmentCapabilityUnavailable,
    });
    await kernel.close();
  });

  it("uses persisted Agent tool policy to narrow the dynamic catalog", async () => {
    const runtime = new RecordingAgentRuntime(async (context) => {
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
      environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, agentRuntime: true }),
      agentRuntime: runtime,
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

    await expect(collectAgentRun(await kernel.runAgent(agent, { messages: [] }))).resolves.toEqual({
      tools: ["action:tests.echo"],
    });
    await expect(kernel.listAgentTools(agent)).resolves.toEqual([
      expect.objectContaining({ id: "action:tests.echo" }),
    ]);
    await kernel.close();
  });

  it("keeps tool invocation inside the underlying authorization boundary", async () => {
    const runtime = new RecordingAgentRuntime((context) =>
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

    const events = await kernel.runAgent(agent, { messages: [] });
    await expect(collectAgentRun(events)).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
    });
    await expect(kernel.listRecords(owner, "task")).resolves.toHaveLength(0);
    await kernel.close();
  });

  it("lets a Rule call the same runtime through an explicit Agent binding", async () => {
    const runtime = new RecordingAgentRuntime(async (context) => ({
      actorId: context.actor.id,
      answer: "Ready",
    }));
    let agentId = "";
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, agentRuntime: true }),
      agentRuntime: runtime,
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
                key: "agents.run",
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
    async function* incomplete(): AsyncIterable<AgentEvent> {
      yield { type: "text_delta", step: 1, delta: "hello" };
    }
    async function* duplicate(): AsyncIterable<AgentEvent> {
      yield { type: "completed", output: "first" };
      yield { type: "completed", output: "second" };
    }
    await expect(collectAgentRun(incomplete())).rejects.toMatchObject({
      code: ERROR_CODES.agentInvalidStream,
    });
    await expect(collectAgentRun(duplicate())).rejects.toMatchObject({
      code: ERROR_CODES.agentInvalidStream,
    });
  });

  it("uses the default tool loop and activates tools found through search_tools", async () => {
    const inference = new ScriptedInference((input, step) => {
      if (step === 1) {
        expect(input.tools.map((tool) => tool.id)).toContain("search_tools");
        expect(input.tools.map((tool) => tool.id)).not.toContain("rule:rule-summarize");
        return [
          { type: "tool_call", id: "find", toolId: "search_tools", input: { query: "summarize" } },
          { type: "finished", reason: "tool_calls" },
        ];
      }
      if (step === 2) {
        expect(input.tools.map((tool) => tool.id)).toContain("rule:rule-summarize");
        return [
          {
            type: "tool_call",
            id: "summarize",
            toolId: "rule:rule-summarize",
            input: { topic: "Release" },
          },
          { type: "finished", reason: "tool_calls" },
        ];
      }
      expect(input.messages.at(-1)).toMatchObject({
        role: "tool",
        callId: "summarize",
        output: { status: "completed" },
      });
      return [
        { type: "text_delta", delta: "Ready" },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
        { type: "finished", reason: "stop" },
      ];
    });
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, agentRuntime: true }),
      inference,
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };
    await kernel.applySpec(owner, agentSpec());

    const events = await collect(await kernel.runAgent(owner, { messages: [] }));

    expect(events.map((event) => event.type)).toEqual([
      "started",
      "step_started",
      "tool_call",
      "step_finished",
      "tool_result",
      "step_started",
      "tool_call",
      "step_finished",
      "tool_result",
      "step_started",
      "text_delta",
      "step_finished",
      "completed",
    ]);
    expect(events.at(-1)).toEqual({
      type: "completed",
      output: "Ready",
      usage: { inputTokens: 10, outputTokens: 2 },
    });
    await kernel.close();
  });

  it("resolves contextual host tools for every step and rejects a tool removed before execution", async () => {
    let resolutions = 0;
    const inference = new ScriptedInference((input, step) =>
      step === 1
        ? [
            { type: "tool_call", id: "title", toolId: "set_title", input: { title: "Plan" } },
            { type: "finished", reason: "tool_calls" },
          ]
        : [
            { type: "structured_output", output: { recovered: true } },
            { type: "finished", reason: "stop" },
          ],
    );
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, agentRuntime: true }),
      inference,
      agentTools: [
        {
          resolve: () => {
            resolutions += 1;
            if (resolutions > 1) return [];
            return [
              {
                id: "set_title",
                label: "Set title",
                description: "Set the title once.",
                input: { type: "object", properties: { title: { type: "string" } } },
                execute: () => ({ saved: true }),
              },
            ];
          },
        },
      ],
    });
    const root = await kernel.createRootWorkspace({ name: "Space", user: { name: "Jane" } });
    const owner = { workspaceId: root.workspace.id, actorId: root.user.id };

    const events = await collect(await kernel.runAgent(owner, { messages: [] }));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_error", toolId: "set_title" }),
        expect.objectContaining({ type: "completed", output: { recovered: true } }),
      ]),
    );
    expect(inference.requests[1]?.messages.at(-1)).toMatchObject({
      role: "tool",
      toolId: "set_title",
      error: { code: ERROR_CODES.resourceNotFound },
    });
    await kernel.close();
  });
});

class ScriptedInference implements InferenceAdapter {
  readonly requests: InferenceInput[] = [];

  constructor(
    private readonly script: (input: InferenceInput, step: number) => readonly InferenceEvent[],
  ) {}

  async *infer(input: InferenceInput): AsyncIterable<InferenceEvent> {
    this.requests.push(structuredClone(input));
    yield* this.script(input, this.requests.length);
  }
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}

class RecordingAgentRuntime implements AgentRuntime {
  readonly requests: AgentContext[] = [];

  constructor(
    private readonly execute: (request: AgentContext) => Promise<JsonValue> | JsonValue,
  ) {}

  async *run(context: AgentContext): AsyncIterable<AgentEvent> {
    this.requests.push(context);
    yield { type: "completed", output: await this.execute(context) };
  }
}

async function bootstrap(runtime: AgentRuntime, actions: readonly ActionDefinition[] = []) {
  const kernel = await Kernel.open({
    persistence: new MemoryPersistenceAdapter(),
    environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, agentRuntime: true }),
    agentRuntime: runtime,
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
