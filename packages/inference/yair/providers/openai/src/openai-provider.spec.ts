import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "@jthum/framework/errors";
import type { ModelEvent, ModelRequest } from "@jthum/yair";
import { openAI } from "./openai-provider.ts";

describe("OpenAIProvider", () => {
  it("translates streamed text, usage, and fragmented tool calls", async () => {
    let sentUrl: string | undefined;
    let sentInit: RequestInit | undefined;
    const provider = openAI({
      apiKey: "test-key",
      includeUsage: true,
      fetch: async (input, init) => {
        sentUrl = requestUrl(input);
        sentInit = init;
        return sseResponse([
          {
            choices: [
              {
                index: 0,
                delta: {
                  content: "Let me check. ",
                  reasoning_details: [
                    {
                      type: "reasoning.text",
                      id: "reasoning-1",
                      index: 0,
                      text: "I should ",
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  reasoning_details: [
                    {
                      type: "reasoning.text",
                      id: "reasoning-1",
                      index: 0,
                      text: "search.",
                    },
                  ],
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      function: { name: "search_", arguments: '{"query":' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { name: "tools", arguments: '"invoice"}' },
                    },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
          },
          {
            choices: [],
            usage: { prompt_tokens: 21, completion_tokens: 7, total_tokens: 28 },
          },
        ]);
      },
    });

    const events = await collect(provider.infer(request()));

    expect(sentUrl).toBe("https://api.openai.com/v1/chat/completions");
    expect(new Headers(sentInit?.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(requestBody(sentInit));
    expect(body).toMatchObject({
      model: "model-test",
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: "system", content: "Be useful." },
        { role: "user", content: "Find invoices" },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "search_tools",
            parameters: {
              type: "object",
              properties: { query: { type: "string" }, context: {} },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
      ],
    });
    expect(events).toEqual([
      { type: "reasoning_delta", delta: "I should " },
      { type: "text_delta", delta: "Let me check. " },
      { type: "reasoning_delta", delta: "search." },
      { type: "usage", usage: { inputTokens: 21, outputTokens: 7, totalTokens: 28 } },
      {
        type: "tool_call",
        id: "call_1",
        toolId: "search_tools",
        input: { query: "invoice" },
      },
      {
        type: "finished",
        reason: "tool_calls",
        providerState: {
          reasoning_details: [
            {
              type: "reasoning.text",
              id: "reasoning-1",
              index: 0,
              text: "I should search.",
            },
          ],
        },
      },
    ]);
  });

  it("supports custom endpoints, headers, credential resolution, and non-streaming responses", async () => {
    let sentUrl: string | undefined;
    let sentInit: RequestInit | undefined;
    const provider = openAI({
      baseUrl: "http://localhost:11434/v1/",
      stream: false,
      instructionRole: "developer",
      headers: { "x-provider": "local" },
      resolveApiKey: (reference) => (reference === "local-secret" ? "resolved-key" : undefined),
      fetch: async (input, init) => {
        sentUrl = requestUrl(input);
        sentInit = init;
        return Response.json({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: "Done", refusal: null },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 4, completion_tokens: 1, total_tokens: 5 },
        });
      },
    });

    const events = await collect(
      provider.infer({
        ...request(),
        tools: [],
        model: {
          provider: "local",
          model: "local-model",
          credentialRef: "local-secret",
          settings: { temperature: 0.2, stream: true, model: "cannot-override" },
        },
      }),
    );

    expect(sentUrl).toBe("http://localhost:11434/v1/chat/completions");
    const headers = new Headers(sentInit?.headers);
    expect(headers.get("authorization")).toBe("Bearer resolved-key");
    expect(headers.get("x-provider")).toBe("local");
    expect(JSON.parse(requestBody(sentInit))).toMatchObject({
      model: "local-model",
      stream: false,
      temperature: 0.2,
      messages: [
        { role: "developer", content: "Be useful." },
        { role: "user", content: "Find invoices" },
      ],
    });
    expect(events).toEqual([
      { type: "usage", usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } },
      { type: "text_delta", delta: "Done" },
      { type: "finished", reason: "stop" },
    ]);
  });

  it("separates tagged reasoning from visible content across stream chunks", async () => {
    const provider = openAI({
      defaultModel: "model-test",
      fetch: async () =>
        sseResponse([
          {
            choices: [
              {
                delta: { content: "<thi" },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: { content: "nk>Check carefully.</think>Visible " },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [{ delta: { content: "answer." }, finish_reason: "stop" }],
          },
        ]),
    });

    expect(await collect(provider.infer({ messages: [], tools: [] }))).toEqual([
      { type: "reasoning_delta", delta: "Check carefully." },
      { type: "text_delta", delta: "Visible " },
      { type: "text_delta", delta: "answer." },
      {
        type: "finished",
        reason: "stop",
        providerState: { reasoning_content: "Check carefully." },
      },
    ]);
  });

  it("normalizes provider errors and cancellation", async () => {
    const failed = openAI({
      defaultModel: "model-test",
      fetch: async () =>
        Response.json({ error: { message: "Capacity exhausted." } }, { status: 429 }),
    });
    const controller = new AbortController();
    controller.abort();
    const cancelled = openAI({
      defaultModel: "model-test",
      fetch: async (_input, init) => {
        if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        return Response.json({});
      },
    });

    expect(await collect(failed.infer({ messages: [], tools: [] }))).toEqual([
      {
        type: "failed",
        error: {
          code: ERROR_CODES.inferenceProviderError,
          message: "Capacity exhausted.",
          retryable: true,
          details: { status: 429 },
        },
      },
    ]);
    expect(
      await collect(cancelled.infer({ messages: [], tools: [], signal: controller.signal })),
    ).toEqual([{ type: "cancelled" }]);
  });

  it("replays tool conversations and preserves refusals", async () => {
    let sentBody: Record<string, unknown> | undefined;
    const provider = openAI({
      defaultModel: "model-test",
      stream: false,
      fetch: async (_input, init) => {
        sentBody = JSON.parse(requestBody(init));
        return Response.json({
          choices: [
            {
              index: 0,
              message: { role: "assistant", content: null, refusal: "I cannot do that." },
              finish_reason: "stop",
            },
          ],
        });
      },
    });

    const events = await collect(
      provider.infer({
        messages: [
          { role: "user", content: "Delete it" },
          {
            role: "assistant",
            providerState: {
              reasoning_details: [
                {
                  type: "reasoning.text",
                  id: "reasoning-delete",
                  index: 0,
                  text: "Delete it.",
                },
              ],
            },
            toolCalls: [{ id: "call_delete", toolId: "records.delete", input: { id: "one" } }],
          },
          {
            role: "tool",
            callId: "call_delete",
            toolId: "records.delete",
            error: { code: ERROR_CODES.permissionDenied, message: "Not allowed." },
          },
        ],
        tools: [],
      }),
    );

    expect(sentBody?.messages).toEqual([
      { role: "user", content: "Delete it" },
      {
        reasoning_details: [
          {
            type: "reasoning.text",
            id: "reasoning-delete",
            index: 0,
            text: "Delete it.",
          },
        ],
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_delete",
            type: "function",
            function: {
              name: "f_c0c0c9fe_records_delete",
              arguments: '{"id":"one"}',
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_delete",
        content: JSON.stringify({
          error: { code: ERROR_CODES.permissionDenied, message: "Not allowed." },
        }),
      },
    ]);
    expect(events).toEqual([{ type: "finished", reason: "refusal", message: "I cannot do that." }]);
  });

  it("reads non-streaming tool calls without stream-only indexes", async () => {
    const provider = openAI({
      defaultModel: "model-test",
      stream: false,
      fetch: async () =>
        Response.json({
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_search",
                    type: "function",
                    function: {
                      name: "search_tools",
                      arguments: '{"query":"invoice"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        }),
    });

    expect(await collect(provider.infer(request()))).toEqual([
      {
        type: "tool_call",
        id: "call_search",
        toolId: "search_tools",
        input: { query: "invoice" },
      },
      { type: "finished", reason: "tool_calls" },
    ]);
  });
});

function request(): ModelRequest {
  return {
    instructions: "Be useful.",
    messages: [{ role: "user", content: "Find invoices" }],
    model: { provider: "openai", model: "model-test" },
    tools: [
      {
        id: "search_tools",
        label: "Search tools",
        description: "Find relevant tools.",
        input: {
          type: "object",
          properties: { query: { type: "string" }, context: { type: "json" } },
          required: ["query"],
          additionalProperties: false,
        },
      },
    ],
  };
}

function sseResponse(chunks: readonly unknown[]): Response {
  const encoder = new TextEncoder();
  const payload = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  const split = Math.floor(payload.length / 2);
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(payload.slice(0, split)));
        controller.enqueue(encoder.encode(payload.slice(split)));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

async function collect(events: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const result: ModelEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("Expected a string request body.");
  return init.body;
}
