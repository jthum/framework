import { describe, expect, it } from "vite-plus/test";
import type {
  InferenceContext,
  InferenceEvent,
  InferenceTool,
  InferenceToolGateway,
} from "@jthum/framework";
import { yair } from "@jthum/yair";
import { openAI } from "./openai-provider.ts";

const apiKey = process.env.MINIMAX_API_KEY;
const liveIt = process.env.YAIR_LIVE === "1" && apiKey ? it : it.skip;

describe("OpenAIProvider live contract", () => {
  liveIt(
    "completes a MiniMax model-tool-model round trip through YAIR",
    async () => {
      let executions = 0;
      const runtime = yair({
        provider: openAI({
          baseUrl: process.env.YAIR_OPENAI_BASE_URL ?? "https://api.minimax.io/v1",
          ...(apiKey === undefined ? {} : { apiKey }),
          includeUsage: true,
        }),
        maxSteps: 3,
      });

      const events = await collect(
        runtime.run(
          context({
            async resolve() {
              return {
                tools: [additionTool],
                async execute(call) {
                  executions += 1;
                  expect(call.toolId).toBe("calculate_sum");
                  expect(call.input).toEqual({ left: 19, right: 23 });
                  return { result: 42 };
                },
              };
            },
          }),
        ),
      );

      const terminal = events.at(-1);
      expect(executions).toBe(1);
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "tool_call", toolId: "calculate_sum" }),
          expect.objectContaining({ type: "tool_result", output: { result: 42 } }),
        ]),
      );
      expect(terminal).toMatchObject({ type: "completed" });
      expect(terminal?.type === "completed" ? JSON.stringify(terminal.output) : "").toContain("42");
    },
    120_000,
  );
});

const additionTool: InferenceTool = {
  id: "calculate_sum",
  label: "Calculate sum",
  description: "Add exactly two numbers and return their sum.",
  input: {
    type: "object",
    properties: {
      left: { type: "number" },
      right: { type: "number" },
    },
    required: ["left", "right"],
    additionalProperties: false,
  },
};

function context(tools: InferenceToolGateway): InferenceContext {
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
      "You are a deterministic tool-loop test. You must use the available tool for arithmetic. After receiving its result, answer with the numeric result.",
    messages: [
      {
        role: "user",
        content:
          "Call calculate_sum exactly once with left 19 and right 23. After the tool result, reply with the result 42.",
      },
    ],
    model: {
      provider: "minimax",
      model: process.env.YAIR_OPENAI_MODEL ?? "MiniMax-M3",
      settings: { temperature: 0 },
    },
    tools,
  };
}

async function collect(events: AsyncIterable<InferenceEvent>): Promise<InferenceEvent[]> {
  const result: InferenceEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
