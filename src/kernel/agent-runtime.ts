import type { ErrorEnvelope } from "../errors/error.ts";
import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import type { JsonValue } from "../spec/model.ts";
import type { Actor, ExecutionContext } from "./model.ts";

export type AgentMessage =
  | { readonly role: "user" | "assistant"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content?: string;
      readonly toolCalls: readonly AgentToolCall[];
    }
  | {
      readonly role: "tool";
      readonly callId: string;
      readonly toolId: string;
      readonly output?: JsonValue;
      readonly error?: ErrorEnvelope;
    };

export type AgentToolValueSchema =
  | { readonly type: "string"; readonly description?: string; readonly enum?: readonly string[] }
  | { readonly type: "number"; readonly description?: string }
  | { readonly type: "boolean"; readonly description?: string }
  | { readonly type: "json"; readonly description?: string }
  | { readonly type: "array"; readonly description?: string; readonly items: AgentToolValueSchema }
  | AgentToolInputSchema;

/** Small JSON-compatible schema vocabulary. Adapters may translate it to their schema library. */
export interface AgentToolInputSchema {
  readonly type: "object";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, AgentToolValueSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface AgentTool {
  /** Framework-stable identity. Adapters may map it to a provider-safe function name. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly input: AgentToolInputSchema;
}

export interface AgentToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Readonly<Record<string, JsonValue>>;
}

export interface AgentUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type InferenceFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "content_filter";

/** Events emitted by one provider/model request. */
export type InferenceEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "structured_output"; readonly output: JsonValue }
  | ({ readonly type: "tool_call" } & AgentToolCall)
  | { readonly type: "usage"; readonly usage: AgentUsage }
  | { readonly type: "finished"; readonly reason: InferenceFinishReason }
  | { readonly type: "failed"; readonly error: ErrorEnvelope }
  | { readonly type: "cancelled" };

export interface InferenceInput {
  readonly messages: readonly AgentMessage[];
  readonly tools: readonly AgentTool[];
  readonly instructions?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

/** One inference step. Provider libraries belong behind this small port. */
export interface InferenceAdapter {
  infer(input: InferenceInput): AsyncIterable<InferenceEvent>;
}

export type AgentEvent =
  | { readonly type: "started" }
  | { readonly type: "step_started"; readonly step: number; readonly tools: readonly string[] }
  | { readonly type: "text_delta"; readonly step: number; readonly delta: string }
  | { readonly type: "structured_output"; readonly step: number; readonly output: JsonValue }
  | ({ readonly type: "tool_call"; readonly step: number } & AgentToolCall)
  | {
      readonly type: "tool_result";
      readonly step: number;
      readonly callId: string;
      readonly toolId: string;
      readonly output: JsonValue;
    }
  | {
      readonly type: "tool_error";
      readonly step: number;
      readonly callId: string;
      readonly toolId: string;
      readonly error: ErrorEnvelope;
    }
  | {
      readonly type: "step_finished";
      readonly step: number;
      readonly reason: InferenceFinishReason;
    }
  | { readonly type: "completed"; readonly output: JsonValue; readonly usage?: AgentUsage }
  | { readonly type: "refused"; readonly usage?: AgentUsage }
  | { readonly type: "failed"; readonly error: ErrorEnvelope; readonly usage?: AgentUsage }
  | { readonly type: "cancelled"; readonly usage?: AgentUsage };

export interface AgentInput {
  readonly messages: readonly AgentMessage[];
  readonly instructions?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

export interface AgentToolContext {
  readonly execution: ExecutionContext;
  readonly actor: Actor;
  readonly messages: readonly AgentMessage[];
  readonly step: number;
  readonly activeToolIds: ReadonlySet<string>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ContextualAgentTool extends AgentTool {
  readonly availability?: "eager" | "discoverable";
  readonly keywords?: readonly string[];
  execute(
    input: Readonly<Record<string, JsonValue>>,
    context: AgentToolContext,
  ): JsonValue | Promise<JsonValue>;
}

/** Trusted host extension for tools whose availability depends on the current step. */
export interface AgentToolProvider {
  resolve(
    context: AgentToolContext,
  ): readonly ContextualAgentTool[] | Promise<readonly ContextualAgentTool[]>;
}

/** A stable, executable snapshot. Its tools do not change during one inference request. */
export interface AgentToolSet {
  readonly tools: readonly AgentTool[];
  execute(call: AgentToolCall): Promise<JsonValue>;
}

/** Resolves contextual tools again at each model step. */
export interface AgentToolGateway {
  resolve(context: AgentToolContext): Promise<AgentToolSet>;
}

export interface AgentContext extends AgentInput {
  readonly execution: ExecutionContext;
  readonly actor: Actor;
  readonly tools: AgentToolGateway;
}

/** Coordinates a complete turn. Custom orchestration libraries may implement this port directly. */
export interface AgentRuntime {
  run(context: AgentContext): AsyncIterable<AgentEvent>;
}

export interface DefaultAgentRuntimeOptions {
  readonly maxSteps?: number;
}

/** Default sequential tool loop built on a one-step InferenceAdapter. */
export class DefaultAgentRuntime implements AgentRuntime {
  private readonly maxSteps: number;

  constructor(
    private readonly inference: InferenceAdapter,
    options: DefaultAgentRuntimeOptions = {},
  ) {
    this.maxSteps = options.maxSteps ?? 12;
    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1)
      throw new FrameworkError({
        code: ERROR_CODES.validationInvalidInput,
        message: "maxSteps must be a positive integer.",
      });
  }

  async *run(context: AgentContext): AsyncIterable<AgentEvent> {
    yield { type: "started" };
    try {
      yield* this.runSteps(context);
    } catch (error) {
      yield { type: "failed", error: errorEnvelope(error) };
    }
  }

  private async *runSteps(context: AgentContext): AsyncIterable<AgentEvent> {
    const messages = context.messages.map((message) => structuredClone(message));
    const activeToolIds = new Set<string>();
    let usage: AgentUsage | undefined;

    for (let step = 1; step <= this.maxSteps; step += 1) {
      if (context.signal?.aborted) {
        yield terminalWithUsage("cancelled", usage);
        return;
      }
      const toolSet = await context.tools.resolve({
        execution: context.execution,
        actor: context.actor,
        messages,
        step,
        activeToolIds,
        ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
      });
      yield { type: "step_started", step, tools: toolSet.tools.map((tool) => tool.id) };

      const calls: AgentToolCall[] = [];
      let text = "";
      let structured: JsonValue | undefined;
      let finish: InferenceFinishReason | undefined;
      let terminal = false;

      for await (const event of this.inference.infer({
        messages,
        tools: toolSet.tools,
        ...(context.instructions === undefined ? {} : { instructions: context.instructions }),
        ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })) {
        if (terminal)
          throw invalidRuntime("InferenceAdapter emitted an event after a terminal event.");
        switch (event.type) {
          case "text_delta":
            text += event.delta;
            yield { type: "text_delta", step, delta: event.delta };
            break;
          case "structured_output":
            structured = structuredClone(event.output);
            yield { type: "structured_output", step, output: structuredClone(event.output) };
            break;
          case "tool_call":
            calls.push(cloneCall(event));
            yield { type: "tool_call", step, ...cloneCall(event) };
            break;
          case "usage":
            usage = addUsage(usage, event.usage);
            break;
          case "finished":
            terminal = true;
            finish = event.reason;
            break;
          case "failed":
            terminal = true;
            yield {
              type: "failed",
              error: structuredClone(event.error),
              ...(usage ? { usage } : {}),
            };
            return;
          case "cancelled":
            terminal = true;
            yield terminalWithUsage("cancelled", usage);
            return;
        }
      }

      if (!terminal || !finish)
        throw invalidRuntime("InferenceAdapter ended without a terminal event.");
      yield { type: "step_finished", step, reason: finish };
      if (finish === "refusal" || finish === "content_filter") {
        yield terminalWithUsage("refused", usage);
        return;
      }
      if (finish !== "tool_calls") {
        yield { type: "completed", output: structured ?? text, ...(usage ? { usage } : {}) };
        return;
      }
      if (calls.length === 0)
        throw invalidRuntime(
          'InferenceAdapter finished with "tool_calls" but emitted no tool calls.',
        );

      messages.push({ role: "assistant", ...(text ? { content: text } : {}), toolCalls: calls });
      for (const call of calls) {
        try {
          const output = await toolSet.execute(call);
          activateDiscoveredTools(call, output, activeToolIds);
          messages.push({ role: "tool", callId: call.id, toolId: call.toolId, output });
          yield { type: "tool_result", step, callId: call.id, toolId: call.toolId, output };
        } catch (error) {
          const envelope = errorEnvelope(error);
          messages.push({ role: "tool", callId: call.id, toolId: call.toolId, error: envelope });
          yield { type: "tool_error", step, callId: call.id, toolId: call.toolId, error: envelope };
        }
      }
    }

    yield {
      type: "failed",
      error: {
        code: ERROR_CODES.internalUnexpected,
        message: `Agent turn exceeded its ${this.maxSteps}-step limit.`,
      },
      ...(usage ? { usage } : {}),
    };
  }
}

export async function collectAgentRun(events: AsyncIterable<AgentEvent>): Promise<JsonValue> {
  let terminal: AgentEvent | undefined;
  for await (const event of events) {
    if (terminal) throw invalidRuntime("AgentRuntime emitted an event after its terminal event.");
    if (!["completed", "refused", "failed", "cancelled"].includes(event.type)) continue;
    terminal = event;
  }
  if (!terminal) throw invalidRuntime("AgentRuntime ended without a terminal event.");
  if (terminal.type === "completed") return terminal.output;
  if (terminal.type === "failed") throw new FrameworkError(terminal.error);
  throw new FrameworkError({
    code: ERROR_CODES.internalUnexpected,
    message: terminal.type === "refused" ? "Inference was refused." : "Agent run was cancelled.",
  });
}

function cloneCall(call: AgentToolCall): AgentToolCall {
  return { id: call.id, toolId: call.toolId, input: structuredClone(call.input) };
}

function addUsage(current: AgentUsage | undefined, next: AgentUsage): AgentUsage {
  return {
    ...(current?.inputTokens === undefined && next.inputTokens === undefined
      ? {}
      : { inputTokens: (current?.inputTokens ?? 0) + (next.inputTokens ?? 0) }),
    ...(current?.outputTokens === undefined && next.outputTokens === undefined
      ? {}
      : { outputTokens: (current?.outputTokens ?? 0) + (next.outputTokens ?? 0) }),
    ...(current?.totalTokens === undefined && next.totalTokens === undefined
      ? {}
      : { totalTokens: (current?.totalTokens ?? 0) + (next.totalTokens ?? 0) }),
  };
}

function terminalWithUsage(
  type: "refused" | "cancelled",
  usage: AgentUsage | undefined,
): Extract<AgentEvent, { type: typeof type }> {
  return { type, ...(usage ? { usage } : {}) } as Extract<AgentEvent, { type: typeof type }>;
}

function errorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof FrameworkError) return error.toEnvelope();
  return {
    code: ERROR_CODES.internalUnexpected,
    message: error instanceof Error ? error.message : "Tool execution failed.",
  };
}

function activateDiscoveredTools(
  call: AgentToolCall,
  output: JsonValue,
  activeToolIds: Set<string>,
): void {
  if (
    call.toolId !== "search_tools" ||
    !output ||
    typeof output !== "object" ||
    Array.isArray(output)
  )
    return;
  const tools = output.tools;
  if (!Array.isArray(tools)) return;
  for (const tool of tools) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) continue;
    if (typeof tool.id === "string") activeToolIds.add(tool.id);
  }
}

function invalidRuntime(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.internalUnexpected, message });
}
