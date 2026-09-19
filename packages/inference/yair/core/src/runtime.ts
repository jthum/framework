import type { ErrorEnvelope, JsonValue } from "@jthum/framework";
import { ERROR_CODES, FrameworkError } from "@jthum/framework/errors";
import type {
  InferenceContext,
  InferenceEvent,
  InferenceRuntime,
  InferenceToolCall,
  InferenceUsage,
} from "@jthum/framework/kernel";
import type { ModelProvider } from "./model-provider.ts";

export interface YairOptions {
  readonly provider: ModelProvider;
  readonly maxSteps?: number;
}

export function yair(options: YairOptions): InferenceRuntime {
  return new YairRuntime(options.provider, options);
}

/** YAIR's sequential, dynamically resolved inference and tool loop. */
export class YairRuntime implements InferenceRuntime {
  private readonly provider: ModelProvider;
  private readonly maxSteps: number;

  constructor(provider: ModelProvider, options: Omit<YairOptions, "provider"> = {}) {
    this.provider = provider;
    this.maxSteps = options.maxSteps ?? 12;
    if (!Number.isInteger(this.maxSteps) || this.maxSteps < 1)
      throw new FrameworkError({
        code: ERROR_CODES.validationInvalidInput,
        message: "maxSteps must be a positive integer.",
      });
  }

  async *run(context: InferenceContext): AsyncIterable<InferenceEvent> {
    yield { type: "started" };
    try {
      yield* this.runSteps(context);
    } catch (error) {
      yield { type: "failed", error: errorEnvelope(error) };
    }
  }

  private async *runSteps(context: InferenceContext): AsyncIterable<InferenceEvent> {
    const messages = context.messages.map((message) => structuredClone(message));
    const activeToolIds = new Set<string>();
    let usage: InferenceUsage | undefined;

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

      const calls: InferenceToolCall[] = [];
      let text = "";
      let structured: JsonValue | undefined;
      let finish: Extract<InferenceEvent, { type: "step_finished" }>["reason"] | undefined;
      let finishMessage: string | undefined;
      let providerState: Readonly<Record<string, JsonValue>> | undefined;
      let terminal = false;

      for await (const event of this.provider.infer({
        messages,
        tools: toolSet.tools,
        ...(context.model === undefined ? {} : { model: structuredClone(context.model) }),
        ...(context.instructions === undefined ? {} : { instructions: context.instructions }),
        ...(context.metadata === undefined ? {} : { metadata: context.metadata }),
        ...(context.signal === undefined ? {} : { signal: context.signal }),
      })) {
        if (terminal)
          throw invalidRuntime("ModelProvider emitted an event after a terminal event.");
        switch (event.type) {
          case "reasoning_delta":
            yield { type: "reasoning_delta", step, delta: event.delta };
            break;
          case "text_delta":
            text += event.delta;
            yield { type: "text_delta", step, delta: event.delta };
            break;
          case "structured_output":
            if (structured !== undefined)
              throw invalidRuntime("ModelProvider emitted more than one structured output.");
            structured = structuredClone(event.output);
            yield { type: "structured_output", step, output: structuredClone(event.output) };
            break;
          case "tool_call":
            if (calls.some((call) => call.id === event.id))
              throw invalidRuntime(`ModelProvider reused tool call ID ${event.id}.`);
            const offeredTool = toolSet.tools.find((tool) => tool.id === event.toolId);
            const call = {
              ...cloneCall(event),
              ...(offeredTool?.name === undefined ? {} : { toolName: offeredTool.name }),
            };
            calls.push(call);
            yield { type: "tool_call", step, ...call };
            break;
          case "usage":
            usage = addUsage(usage, event.usage);
            break;
          case "finished":
            terminal = true;
            finish = event.reason;
            finishMessage = event.message;
            providerState = event.providerState;
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
        throw invalidRuntime("ModelProvider ended without a terminal event.");
      if (finish !== "tool_calls" && calls.length > 0)
        throw invalidRuntime(
          `ModelProvider emitted tool calls but finished the step with ${finish}.`,
        );
      yield { type: "step_finished", step, reason: finish };
      if (finish === "refusal" || finish === "content_filter") {
        yield {
          type: "refused",
          ...(finishMessage === undefined ? {} : { reason: finishMessage }),
          ...(usage ? { usage } : {}),
        };
        return;
      }
      const assistantMessage = {
        role: "assistant" as const,
        content: text,
        ...(providerState === undefined ? {} : { providerState: structuredClone(providerState) }),
      };
      if (finish !== "tool_calls") {
        yield {
          type: "completed",
          output: structured ?? text,
          messages: structuredClone([...messages, assistantMessage]),
          ...(usage ? { usage } : {}),
        };
        return;
      }
      if (calls.length === 0)
        throw invalidRuntime('ModelProvider finished with "tool_calls" but emitted no tool calls.');

      messages.push({
        role: "assistant",
        ...(text ? { content: text } : {}),
        toolCalls: calls,
        ...(providerState === undefined ? {} : { providerState: structuredClone(providerState) }),
      });
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
        code: ERROR_CODES.inferenceStepLimit,
        message: `Inference run exceeded its ${this.maxSteps}-step limit.`,
      },
      ...(usage ? { usage } : {}),
    };
  }
}

function cloneCall(call: InferenceToolCall): InferenceToolCall {
  return {
    id: call.id,
    toolId: call.toolId,
    ...(call.toolName === undefined ? {} : { toolName: call.toolName }),
    input: structuredClone(call.input),
  };
}

function addUsage(current: InferenceUsage | undefined, next: InferenceUsage): InferenceUsage {
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
  usage: InferenceUsage | undefined,
): Extract<InferenceEvent, { type: typeof type }> {
  return { type, ...(usage ? { usage } : {}) } as Extract<InferenceEvent, { type: typeof type }>;
}

function errorEnvelope(error: unknown): ErrorEnvelope {
  if (error instanceof FrameworkError) return error.toEnvelope();
  return {
    code: ERROR_CODES.internalUnexpected,
    message: error instanceof Error ? error.message : "Tool execution failed.",
  };
}

function activateDiscoveredTools(
  call: InferenceToolCall,
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
  return new FrameworkError({ code: ERROR_CODES.inferenceInvalidStream, message });
}
