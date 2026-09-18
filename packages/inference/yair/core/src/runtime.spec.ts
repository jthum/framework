import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES, resourceNotFound } from "@jthum/framework/errors";
import {
  collectInferenceRun,
  type InferenceContext,
  type InferenceTool,
  type InferenceToolGateway,
  type InferenceToolSet,
  type JsonValue,
} from "@jthum/framework";
import type { ModelEvent, ModelProvider, ModelRequest } from "./model-provider.ts";
import { YairRuntime } from "./runtime.ts";

describe("YairRuntime", () => {
  it("resolves every step and activates tools discovered through search_tools", async () => {
    const provider = new ScriptedProvider((request, step) => {
      if (step === 1) {
        expect(request.tools.map((tool) => tool.id)).toEqual(["search_tools"]);
        return [
          { type: "tool_call", id: "find", toolId: "search_tools", input: { query: "summary" } },
          { type: "finished", reason: "tool_calls" },
        ];
      }
      if (step === 2) {
        expect(request.tools.map((tool) => tool.id)).toEqual(["summarize"]);
        return [
          { type: "tool_call", id: "summary", toolId: "summarize", input: {} },
          { type: "finished", reason: "tool_calls" },
        ];
      }
      expect(request.messages.at(-1)).toMatchObject({
        role: "tool",
        callId: "summary",
        output: { status: "completed" },
      });
      return [
        { type: "text_delta", delta: "Ready" },
        { type: "usage", usage: { inputTokens: 10, outputTokens: 2 } },
        { type: "finished", reason: "stop" },
      ];
    });
    const gateway: InferenceToolGateway = {
      async resolve(context) {
        if (context.step === 1)
          return toolSet([tool("search_tools")], () => ({
            query: "summary",
            tools: [{ id: "summarize", label: "Summarize", description: "Summarize." }],
          }));
        expect(context.activeToolIds.has("summarize")).toBe(true);
        return context.step === 2
          ? toolSet([tool("summarize")], () => ({ status: "completed" }))
          : toolSet([], () => null);
      },
    };

    const events = await collect(new YairRuntime(provider).run(runtimeContext(gateway)));

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
      messages: expect.arrayContaining([{ role: "assistant", content: "Ready" }]),
      usage: { inputTokens: 10, outputTokens: 2 },
    });
  });

  it("streams reasoning and preserves provider continuity across steps", async () => {
    const providerState = {
      reasoning_details: [{ type: "reasoning.text", id: "reasoning-1", text: "Use the tool." }],
    };
    const provider = new ScriptedProvider((request, step) => {
      if (step === 1)
        return [
          { type: "reasoning_delta", delta: "Use the tool." },
          { type: "tool_call", id: "call", toolId: "noop", input: {} },
          { type: "finished", reason: "tool_calls", providerState },
        ];
      expect(request.messages.at(-2)).toEqual({
        role: "assistant",
        toolCalls: [{ id: "call", toolId: "noop", input: {} }],
        providerState,
      });
      return [
        { type: "reasoning_delta", delta: "The tool finished." },
        { type: "text_delta", delta: "Done" },
        { type: "finished", reason: "stop", providerState },
      ];
    });

    const events = await collect(new YairRuntime(provider).run(runtimeContext()));

    expect(events.filter((event) => event.type === "reasoning_delta")).toEqual([
      { type: "reasoning_delta", step: 1, delta: "Use the tool." },
      { type: "reasoning_delta", step: 2, delta: "The tool finished." },
    ]);
    expect(events.at(-1)).toEqual({
      type: "completed",
      output: "Done",
      messages: [
        {
          role: "assistant",
          toolCalls: [{ id: "call", toolId: "noop", input: {} }],
          providerState,
        },
        { role: "tool", callId: "call", toolId: "noop", output: null },
        { role: "assistant", content: "Done", providerState },
      ],
    });

    const completed = events.at(-1);
    if (completed?.type !== "completed" || !completed.messages)
      throw new Error("Missing completed history.");
    const nextMessages = [...completed.messages, { role: "user" as const, content: "Continue" }];
    const nextProvider = new ScriptedProvider((request) => {
      expect(request.messages).toEqual(nextMessages);
      return [
        { type: "text_delta", delta: "Continued" },
        { type: "finished", reason: "stop" },
      ];
    });
    const next = await collect(
      new YairRuntime(nextProvider).run({ ...runtimeContext(), messages: nextMessages }),
    );
    expect(next.at(-1)).toMatchObject({ type: "completed", output: "Continued" });
  });

  it("feeds a tool removed before execution back to the model", async () => {
    const provider = new ScriptedProvider((request, step) =>
      step === 1
        ? [
            { type: "tool_call", id: "title", toolId: "set_title", input: { title: "Plan" } },
            { type: "finished", reason: "tool_calls" },
          ]
        : (expect(request.messages.at(-1)).toMatchObject({
            role: "tool",
            toolId: "set_title",
            error: { code: ERROR_CODES.resourceNotFound },
          }),
          [
            { type: "structured_output", output: { recovered: true } },
            { type: "finished", reason: "stop" },
          ]),
    );
    const gateway: InferenceToolGateway = {
      resolve: async () =>
        toolSet([tool("set_title")], () => {
          throw resourceNotFound("InferenceTool", "set_title");
        }),
    };

    const events = await collect(new YairRuntime(provider).run(runtimeContext(gateway)));

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_error", toolId: "set_title" }),
        expect.objectContaining({ type: "completed", output: { recovered: true } }),
      ]),
    );
  });

  it("executes calls from one model step sequentially in emitted order", async () => {
    const order: string[] = [];
    const provider = new ScriptedProvider((_request, step) =>
      step === 1
        ? [
            { type: "tool_call", id: "first-call", toolId: "first", input: {} },
            { type: "tool_call", id: "second-call", toolId: "second", input: {} },
            { type: "finished", reason: "tool_calls" },
          ]
        : [{ type: "finished", reason: "stop" }],
    );
    const gateway: InferenceToolGateway = {
      resolve: async () => ({
        tools: [tool("first"), tool("second")],
        async execute(call) {
          order.push(call.toolId);
          return { tool: call.toolId };
        },
      }),
    };

    await collectInferenceRun(new YairRuntime(provider).run(runtimeContext(gateway)));

    expect(order).toEqual(["first", "second"]);
    expect(provider.requests[1]?.messages.slice(-2)).toMatchObject([
      { role: "tool", callId: "first-call", output: { tool: "first" } },
      { role: "tool", callId: "second-call", output: { tool: "second" } },
    ]);
  });

  it("preserves refusal and cancellation terminals", async () => {
    const refused = new YairRuntime(
      new ScriptedProvider(() => [
        { type: "usage", usage: { inputTokens: 7, outputTokens: 1, totalTokens: 8 } },
        { type: "finished", reason: "refusal", message: "Request declined by provider policy." },
      ]),
    );
    const cancelled = new YairRuntime(new ScriptedProvider(() => [{ type: "cancelled" }]));

    await expect(collectInferenceRun(refused.run(runtimeContext()))).rejects.toMatchObject({
      code: ERROR_CODES.inferenceRefused,
      message: "Request declined by provider policy.",
    });
    await expect(collectInferenceRun(cancelled.run(runtimeContext()))).rejects.toMatchObject({
      code: ERROR_CODES.inferenceCancelled,
    });
  });

  it("rejects malformed provider terminals and enforces its step limit", async () => {
    const malformed = new YairRuntime(
      new ScriptedProvider(() => [
        { type: "tool_call", id: "unexpected", toolId: "noop", input: {} },
        { type: "finished", reason: "stop" },
      ]),
    );
    const looping = new YairRuntime(
      new ScriptedProvider(() => [
        { type: "tool_call", id: "again", toolId: "noop", input: {} },
        { type: "finished", reason: "tool_calls" },
      ]),
      { maxSteps: 1 },
    );

    await expect(collectInferenceRun(malformed.run(runtimeContext()))).rejects.toMatchObject({
      code: ERROR_CODES.inferenceInvalidStream,
    });
    await expect(collectInferenceRun(looping.run(runtimeContext()))).rejects.toMatchObject({
      code: ERROR_CODES.inferenceStepLimit,
    });
  });
});

class ScriptedProvider implements ModelProvider {
  readonly requests: ModelRequest[] = [];

  constructor(
    private readonly script: (request: ModelRequest, step: number) => readonly ModelEvent[],
  ) {}

  async *infer(request: ModelRequest): AsyncIterable<ModelEvent> {
    this.requests.push(structuredClone(request));
    yield* this.script(request, this.requests.length);
  }
}

function runtimeContext(
  tools: InferenceToolGateway = {
    resolve: async () => toolSet([tool("noop")], () => null),
  },
) {
  const execution = { workspaceId: "workspace-test", actorId: "actor-test" };
  return {
    execution,
    actor: {
      id: execution.actorId,
      kind: "user" as const,
      originId: execution.workspaceId,
      rootId: execution.workspaceId,
      name: "Test user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    messages: [],
    tools,
  } satisfies InferenceContext;
}

function tool(id: string): InferenceTool {
  return {
    id,
    label: id,
    description: `${id} test tool.`,
    input: { type: "object", additionalProperties: false },
  };
}

function toolSet(tools: readonly InferenceTool[], execute: () => JsonValue): InferenceToolSet {
  return { tools, execute: async () => execute() };
}

async function collect<T>(events: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const event of events) result.push(event);
  return result;
}
