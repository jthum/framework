import type {
  ErrorEnvelope,
  InferenceFinishReason,
  InferenceMessage,
  InferenceTool,
  InferenceToolInputSchema,
  InferenceToolValueSchema,
  JsonValue,
} from "@jthum/framework";
import { ERROR_CODES } from "@jthum/framework/errors";
import type { ModelEvent, ModelProvider, ModelRequest } from "@jthum/yair";

type MaybePromise<T> = T | Promise<T>;

export interface OpenAIProviderOptions {
  /** API root containing `/chat/completions`. */
  readonly baseUrl?: string;
  readonly apiKey?: string;
  readonly resolveApiKey?: (credentialRef: string | undefined) => MaybePromise<string | undefined>;
  readonly headers?: Readonly<Record<string, string>>;
  readonly defaultModel?: string;
  /** Streaming is enabled by default. Disable it for a compatible endpoint without SSE support. */
  readonly stream?: boolean;
  /** Request usage in the final stream chunk. Disabled by default for broader compatibility. */
  readonly includeUsage?: boolean;
  /** `system` is the most widely supported instruction role among compatible providers. */
  readonly instructionRole?: "system" | "developer";
  readonly fetch?: typeof globalThis.fetch;
}

/** Create a YAIR provider for OpenAI or an OpenAI-compatible Chat Completions endpoint. */
export function openAI(options: OpenAIProviderOptions = {}): ModelProvider {
  return new OpenAIProvider(options);
}

export class OpenAIProvider implements ModelProvider {
  private readonly baseUrl: string;
  private readonly fetch: typeof globalThis.fetch;

  constructor(private readonly options: OpenAIProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetch = options.fetch ?? globalThis.fetch;
    if (!this.fetch) throw new Error("OpenAIProvider requires a fetch implementation.");
  }

  async *infer(request: ModelRequest): AsyncIterable<ModelEvent> {
    try {
      const response = await this.request(request);
      if (!response.ok) {
        yield { type: "failed", error: await responseError(response) };
        return;
      }
      if (this.options.stream === false) {
        yield* readCompletion(await response.json(), request);
        return;
      }
      if (!response.body) {
        yield { type: "failed", error: providerError("Provider returned an empty stream.") };
        return;
      }
      yield* readCompletionStream(response.body, request);
    } catch (error) {
      if (request.signal?.aborted || isAbortError(error)) {
        yield { type: "cancelled" };
        return;
      }
      yield {
        type: "failed",
        error: providerError(error instanceof Error ? error.message : "Provider request failed."),
      };
    }
  }

  private async request(request: ModelRequest): Promise<Response> {
    const model = request.model?.model ?? this.options.defaultModel;
    if (!model) throw new Error("An OpenAI-compatible model must be selected.");
    const resolvedApiKey = this.options.resolveApiKey
      ? await this.options.resolveApiKey(request.model?.credentialRef)
      : undefined;
    const apiKey = resolvedApiKey ?? this.options.apiKey;
    const headers = new Headers(this.options.headers);
    headers.set("content-type", "application/json");
    if (apiKey && !headers.has("authorization")) headers.set("authorization", `Bearer ${apiKey}`);

    const tools = toolNames(request);
    const stream = this.options.stream !== false;
    const settings = request.model?.settings ?? {};
    const body: Record<string, JsonValue> = {
      ...settings,
      model,
      messages: toMessages(request, tools, this.options.instructionRole ?? "system"),
      stream,
      n: 1,
    };
    if (request.tools.length > 0) {
      body.tools = request.tools.map((tool) => toTool(tool, tools));
      if (settings.tool_choice === undefined) body.tool_choice = "auto";
    }
    if (stream && this.options.includeUsage) body.stream_options = { include_usage: true };

    return this.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
  }
}

interface ToolNames {
  readonly byId: ReadonlyMap<string, string>;
  readonly byName: ReadonlyMap<string, string>;
}

function toolNames(request: ModelRequest): ToolNames {
  const ids = new Set(request.tools.map((tool) => tool.id));
  for (const message of request.messages) {
    if (message.role === "assistant" && "toolCalls" in message)
      for (const call of message.toolCalls) ids.add(call.toolId);
    if (message.role === "tool") ids.add(message.toolId);
  }
  const byId = new Map<string, string>();
  const byName = new Map<string, string>();
  for (const id of [...ids].sort()) {
    const name = providerToolName(id);
    const collision = byName.get(name);
    if (collision && collision !== id)
      throw new Error(`Tool IDs ${collision} and ${id} map to the same provider name.`);
    byId.set(id, name);
    byName.set(name, id);
  }
  return { byId, byName };
}

function providerToolName(id: string): string {
  const readable = id.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";
  return `f_${fnv1a(id)}_${readable}`.slice(0, 64);
}

function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function toMessages(
  request: ModelRequest,
  names: ToolNames,
  instructionRole: "system" | "developer",
): JsonValue[] {
  const messages: JsonValue[] = [];
  if (request.instructions) messages.push({ role: instructionRole, content: request.instructions });
  return messages.concat(request.messages.map((message) => toMessage(message, names)));
}

function toMessage(message: InferenceMessage, names: ToolNames): JsonValue {
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "assistant") {
    if (!("toolCalls" in message)) return { role: "assistant", content: message.content };
    return {
      role: "assistant",
      content: message.content ?? null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: requiredToolName(names, call.toolId),
          arguments: JSON.stringify(call.input),
        },
      })),
    };
  }
  if (!("callId" in message)) throw new Error("Unsupported inference message role.");
  return {
    role: "tool",
    tool_call_id: message.callId,
    content: JSON.stringify(message.error ? { error: message.error } : (message.output ?? null)),
  };
}

function toTool(tool: InferenceTool, names: ToolNames): JsonValue {
  return {
    type: "function",
    function: {
      name: requiredToolName(names, tool.id),
      description: tool.description,
      parameters: toJsonSchema(tool.input),
    },
  };
}

function toJsonSchema(schema: InferenceToolInputSchema | InferenceToolValueSchema): JsonValue {
  if (schema.type === "json") return schema.description ? { description: schema.description } : {};
  if (schema.type === "array")
    return {
      type: "array",
      ...(schema.description === undefined ? {} : { description: schema.description }),
      items: toJsonSchema(schema.items),
    };
  if (schema.type === "object")
    return {
      type: "object",
      ...(schema.description === undefined ? {} : { description: schema.description }),
      properties: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => [key, toJsonSchema(value)]),
      ),
      ...(schema.required === undefined ? {} : { required: [...schema.required] }),
      ...(schema.additionalProperties === undefined
        ? {}
        : { additionalProperties: schema.additionalProperties }),
    };
  return {
    type: schema.type,
    ...(schema.description === undefined ? {} : { description: schema.description }),
    ...(schema.type === "string" && schema.enum !== undefined ? { enum: [...schema.enum] } : {}),
  };
}

function requiredToolName(names: ToolNames, id: string): string {
  const name = names.byId.get(id);
  if (!name) throw new Error(`No provider name exists for tool ${id}.`);
  return name;
}

async function* readCompletionStream(
  body: ReadableStream<Uint8Array>,
  request: ModelRequest,
): AsyncIterable<ModelEvent> {
  const names = toolNames(request);
  const calls = new Map<number, ToolCallParts>();
  let finish: InferenceFinishReason | undefined;
  let finishMessage: string | undefined;
  for await (const data of sseData(body)) {
    if (data === "[DONE]") break;
    const chunk = asObject(JSON.parse(data));
    const usage = readUsage(chunk.usage);
    if (usage) yield { type: "usage", usage };
    const choice = firstChoice(chunk.choices);
    if (!choice) continue;
    const delta = asObject(choice.delta);
    if (typeof delta.content === "string" && delta.content) {
      yield { type: "text_delta", delta: delta.content };
    }
    if (typeof delta.refusal === "string") finishMessage = (finishMessage ?? "") + delta.refusal;
    collectToolCalls(delta.tool_calls, calls);
    if (typeof choice.finish_reason === "string") finish = mapFinishReason(choice.finish_reason);
  }
  yield* finishCompletion(calls, names, finish, finishMessage);
}

async function* readCompletion(value: unknown, request: ModelRequest): AsyncIterable<ModelEvent> {
  const completion = asObject(value);
  const usage = readUsage(completion.usage);
  if (usage) yield { type: "usage", usage };
  const choice = firstChoice(completion.choices);
  if (!choice) throw new Error("Provider response contained no completion choice.");
  const message = asObject(choice.message);
  if (typeof message.content === "string" && message.content)
    yield { type: "text_delta", delta: message.content };
  const calls = new Map<number, ToolCallParts>();
  collectToolCalls(message.tool_calls, calls);
  const finish =
    typeof choice.finish_reason === "string" ? mapFinishReason(choice.finish_reason) : undefined;
  const refusal = typeof message.refusal === "string" ? message.refusal : undefined;
  yield* finishCompletion(calls, toolNames(request), finish, refusal);
}

interface ToolCallParts {
  id: string;
  name: string;
  arguments: string;
}

function collectToolCalls(value: unknown, calls: Map<number, ToolCallParts>): void {
  if (!Array.isArray(value)) return;
  for (const [position, item] of value.entries()) {
    const part = asObject(item);
    const index = typeof part.index === "number" ? part.index : position;
    const current = calls.get(index) ?? { id: "", name: "", arguments: "" };
    const fn = asObject(part.function);
    if (typeof part.id === "string") current.id += part.id;
    if (typeof fn.name === "string") current.name += fn.name;
    if (typeof fn.arguments === "string") current.arguments += fn.arguments;
    calls.set(index, current);
  }
}

function* finishCompletion(
  calls: ReadonlyMap<number, ToolCallParts>,
  names: ToolNames,
  finish: InferenceFinishReason | undefined,
  finishMessage: string | undefined,
): Iterable<ModelEvent> {
  if (!finish) throw new Error("Provider response ended without a finish reason.");
  const reason = finishMessage && finish === "stop" ? "refusal" : finish;
  for (const [, call] of [...calls].sort(([left], [right]) => left - right)) {
    const toolId = names.byName.get(call.name);
    if (!call.id || !toolId)
      throw new Error(`Provider returned an unknown tool call ${call.name}.`);
    const input = JSON.parse(call.arguments || "{}");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error(`Tool ${toolId} returned non-object arguments.`);
    yield { type: "tool_call", id: call.id, toolId, input };
  }
  yield { type: "finished", reason, ...(finishMessage ? { message: finishMessage } : {}) };
}

function mapFinishReason(value: string): InferenceFinishReason {
  if (
    value === "stop" ||
    value === "tool_calls" ||
    value === "length" ||
    value === "content_filter"
  )
    return value;
  if (value === "refusal") return "refusal";
  throw new Error(`Provider returned unsupported finish reason ${value}.`);
}

function readUsage(value: unknown) {
  const usage = asObject(value);
  const inputTokens = numberOrUndefined(usage.prompt_tokens);
  const outputTokens = numberOrUndefined(usage.completion_tokens);
  const totalTokens = numberOrUndefined(usage.total_tokens);
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined)
    return undefined;
  return {
    ...(inputTokens === undefined ? {} : { inputTokens }),
    ...(outputTokens === undefined ? {} : { outputTokens }),
    ...(totalTokens === undefined ? {} : { totalTokens }),
  };
}

function firstChoice(value: unknown): Record<string, unknown> | undefined {
  return Array.isArray(value) && value.length > 0 ? asObject(value[0]) : undefined;
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function* sseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  const consume = function* (line: string): Iterable<string> {
    if (line === "") {
      if (data.length > 0) yield data.join("\n");
      data = [];
    } else if (line.startsWith("data:")) {
      data.push(line.slice(5).replace(/^ /, ""));
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      yield* consume(line);
      newline = buffer.indexOf("\n");
    }
    if (done) break;
  }
  if (buffer) yield* consume(buffer.replace(/\r$/, ""));
  yield* consume("");
}

async function responseError(response: Response): Promise<ErrorEnvelope> {
  let message = `Provider request failed with HTTP ${response.status}.`;
  try {
    const body = asObject(await response.json());
    const error = asObject(body.error);
    if (typeof error.message === "string") message = error.message;
  } catch {
    // Preserve the status-based message for non-JSON compatible endpoints.
  }
  return providerError(message, response.status === 429 || response.status >= 500, response.status);
}

function providerError(message: string, retryable?: boolean, status?: number): ErrorEnvelope {
  return {
    code: ERROR_CODES.inferenceProviderError,
    message,
    ...(retryable === undefined ? {} : { retryable }),
    ...(status === undefined ? {} : { details: { status } }),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
