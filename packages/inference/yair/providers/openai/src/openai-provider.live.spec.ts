import { describe, expect, it } from "vite-plus/test";
import {
  ERROR_CODES,
  FrameworkError,
  type InferenceContext,
  type InferenceEvent,
  type InferenceMessage,
  type InferenceTool,
  type InferenceToolGateway,
  type InferenceToolSet,
  type JsonValue,
} from "@jthum/framework";
import { yair } from "@jthum/yair";
import { openAI } from "./openai-provider.ts";

const apiKey = process.env.YAIR_OPENAI_API_KEY;
const model = process.env.YAIR_OPENAI_MODEL;
const liveIt = process.env.YAIR_LIVE === "1" && apiKey && model ? it : it.skip;
const expectReasoning = process.env.YAIR_OPENAI_EXPECT_REASONING === "1";

describe("OpenAIProvider live contract", () => {
  liveIt(
    "streams thinking and completes tool calls across conversation turns",
    async () => {
      const calls: { toolId: string; input: Readonly<Record<string, JsonValue>> }[] = [];
      const tools = fixedTools([markerTool], (toolId, input) => {
        calls.push({ toolId, input });
        return {
          marker: input.reference === "alpha-7" ? "marker-one-7q" : "marker-two-9z",
        };
      });
      const requests: Record<string, unknown>[] = [];
      const runtime = liveRuntime((request) => requests.push(request));
      const firstUser: InferenceMessage = {
        role: "user",
        content:
          "Use read_marker to retrieve the private marker for reference alpha-7. The marker is not knowable without the tool. Reply with the returned marker.",
      };
      const first = await collect(runtime.run(context([firstUser], tools, true)));
      const firstMessage = completedMessage(first);

      expect(calls).toEqual([{ toolId: "read_marker", input: { reference: "alpha-7" } }]);
      expect(first).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text_delta" }),
          expect.objectContaining({ type: "tool_call", toolId: "read_marker" }),
          expect.objectContaining({ type: "tool_result", output: { marker: "marker-one-7q" } }),
        ]),
      );
      if (expectReasoning) {
        expect(first).toEqual(
          expect.arrayContaining([expect.objectContaining({ type: "reasoning_delta" })]),
        );
        expect(requests.some(hasAssistantReasoning)).toBe(true);
      }
      expect(firstMessage.content).not.toContain("<think>");
      expect(firstMessage.content).toContain("marker-one-7q");

      const secondUser: InferenceMessage = {
        role: "user",
        content:
          "Now use read_marker to retrieve the different private marker for reference beta-9. Reply with the returned marker.",
      };
      const second = await collect(
        runtime.run(context([...completedMessages(first), secondUser], tools, true)),
      );
      const secondMessage = completedMessage(second);

      expect(calls).toEqual([
        { toolId: "read_marker", input: { reference: "alpha-7" } },
        { toolId: "read_marker", input: { reference: "beta-9" } },
      ]);
      expect(secondMessage.content).toContain("marker-two-9z");
    },
    120_000,
  );

  liveIt(
    "discovers a deferred tool and uses it on a later model step",
    async () => {
      let searched = false;
      let lookedUp = false;
      const gateway: InferenceToolGateway = {
        async resolve(toolContext): Promise<InferenceToolSet> {
          if (lookedUp)
            return {
              tools: [],
              async execute() {
                return null;
              },
            };
          if (!toolContext.activeToolIds.has("lookup_status"))
            return {
              tools: [searchTool],
              async execute(call) {
                expect(call.toolId).toBe("search_tools");
                searched = true;
                return {
                  query: call.input.query ?? "status",
                  tools: [
                    {
                      id: "lookup_status",
                      label: "Look up status",
                      description: "Look up the status for a reference.",
                    },
                  ],
                };
              },
            };
          return {
            tools: [lookupTool],
            async execute(call) {
              expect(call.toolId).toBe("lookup_status");
              lookedUp = true;
              return {
                reference:
                  typeof call.input.reference === "string" ? call.input.reference : "unknown",
                status: "ready",
              };
            },
          };
        },
      };
      const events = await collect(
        liveRuntime().run(
          context(
            [
              {
                role: "user",
                content:
                  "Find a tool for looking up reference order-7, use it, then tell me the returned status. Start by calling search_tools.",
              },
            ],
            gateway,
            true,
          ),
        ),
      );

      expect(searched).toBe(true);
      expect(lookedUp).toBe(true);
      expect(events.filter((event) => event.type === "tool_call")).toEqual([
        expect.objectContaining({ toolId: "search_tools" }),
        expect.objectContaining({ toolId: "lookup_status" }),
      ]);
      expect(completedMessage(events).content.toLowerCase()).toContain("ready");
    },
    120_000,
  );

  liveIt(
    "feeds a tool error back to the model and recovers",
    async () => {
      let executions = 0;
      const events = await collect(
        liveRuntime().run(
          context(
            [
              {
                role: "user",
                content:
                  "Call restricted_lookup exactly once with reference private-1. If it fails, do not retry; explain briefly that access was denied.",
              },
            ],
            fixedTools([restrictedTool], () => {
              executions += 1;
              throw new FrameworkError({
                code: ERROR_CODES.permissionDenied,
                message: "Access to this reference is denied.",
              });
            }),
            false,
          ),
        ),
      );

      expect(executions).toBe(1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_error", toolId: "restricted_lookup" }),
          expect.objectContaining({ type: "completed" }),
        ]),
      );
      expect(completedMessage(events).content.toLowerCase()).toMatch(/denied|cannot|unable/);
    },
    120_000,
  );
});

const markerTool: InferenceTool = {
  id: "read_marker",
  label: "Read marker",
  description: "Retrieve an opaque private marker for a reference. The marker cannot be inferred.",
  input: {
    type: "object",
    properties: { reference: { type: "string" } },
    required: ["reference"],
    additionalProperties: false,
  },
};

const searchTool: InferenceTool = {
  id: "search_tools",
  label: "Search tools",
  description: "Find a tool by describing the capability needed.",
  input: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
};

const lookupTool: InferenceTool = {
  id: "lookup_status",
  label: "Look up status",
  description: "Look up the current status for a reference.",
  input: {
    type: "object",
    properties: { reference: { type: "string" } },
    required: ["reference"],
    additionalProperties: false,
  },
};

const restrictedTool: InferenceTool = {
  id: "restricted_lookup",
  label: "Restricted lookup",
  description: "Look up a protected reference. This can return a permission error.",
  input: {
    type: "object",
    properties: { reference: { type: "string" } },
    required: ["reference"],
    additionalProperties: false,
  },
};

function liveRuntime(onRequest?: (request: Record<string, unknown>) => void) {
  return yair({
    provider: openAI({
      ...(process.env.YAIR_OPENAI_BASE_URL === undefined
        ? {}
        : { baseUrl: process.env.YAIR_OPENAI_BASE_URL }),
      ...(apiKey === undefined ? {} : { apiKey }),
      includeUsage: true,
      ...(onRequest === undefined
        ? {}
        : {
            fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
              if (typeof init?.body === "string") onRequest(JSON.parse(init.body));
              return globalThis.fetch(input, init);
            },
          }),
    }),
    maxSteps: 5,
  });
}

function hasAssistantReasoning(request: Record<string, unknown>): boolean {
  if (!Array.isArray(request.messages)) return false;
  return request.messages.some((message) => {
    if (!message || typeof message !== "object" || Array.isArray(message)) return false;
    const record = message as Record<string, unknown>;
    return (
      record.role === "assistant" &&
      (Array.isArray(record.reasoning_details) || typeof record.reasoning_content === "string")
    );
  });
}

function context(
  messages: readonly InferenceMessage[],
  tools: InferenceToolGateway,
  thinking: boolean,
): InferenceContext {
  const workspaceId = "workspace-live-test";
  const actorId = "actor-live-test";
  return {
    execution: { workspaceId, actorId },
    actor: {
      id: actorId,
      kind: "user",
      originId: workspaceId,
      rootId: workspaceId,
      name: "Live test user",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    instructions:
      "Follow the user's tool instructions exactly. Never invent tool results and never repeat a tool call after it returns an error.",
    messages,
    model: {
      provider: "openai-compatible",
      model: model ?? "live-test-model",
      settings: providerSettings(thinking),
    },
    tools,
  };
}

function providerSettings(thinking: boolean): Readonly<Record<string, JsonValue>> {
  const base = process.env.YAIR_OPENAI_SETTINGS;
  const reasoning = thinking ? process.env.YAIR_OPENAI_REASONING_SETTINGS : undefined;
  return { ...parseSettings(base), ...parseSettings(reasoning) };
}

function parseSettings(value: string | undefined): Record<string, JsonValue> {
  if (value === undefined) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Live provider settings must be a JSON object.");
  return parsed as Record<string, JsonValue>;
}

function fixedTools(
  tools: readonly InferenceTool[],
  execute: (toolId: string, input: Readonly<Record<string, JsonValue>>) => JsonValue,
): InferenceToolGateway {
  return {
    async resolve(toolContext) {
      return {
        tools: toolContext.step === 1 ? tools : [],
        async execute(call) {
          return execute(call.toolId, call.input);
        },
      };
    },
  };
}

function completedMessage(
  events: readonly InferenceEvent[],
): Extract<InferenceMessage, { role: "assistant" }> & { readonly content: string } {
  const message = completedMessages(events).at(-1);
  if (message?.role !== "assistant" || typeof message.content !== "string")
    throw new Error("Inference did not return a replayable assistant message.");
  return { ...message, content: message.content };
}

function completedMessages(events: readonly InferenceEvent[]): readonly InferenceMessage[] {
  const terminal = events.at(-1);
  expect(terminal).toMatchObject({ type: "completed" });
  if (terminal?.type !== "completed" || !terminal.messages)
    throw new Error(`Inference did not return replayable history: ${JSON.stringify(terminal)}`);
  return terminal.messages;
}

async function collect(events: AsyncIterable<InferenceEvent>): Promise<InferenceEvent[]> {
  const result: InferenceEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
