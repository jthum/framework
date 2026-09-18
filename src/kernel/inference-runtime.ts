import type { ErrorEnvelope } from "../errors/error.ts";
import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import type { JsonValue } from "../spec/model.ts";
import type { Actor, ExecutionContext } from "./model.ts";

export type InferenceMessage =
  | { readonly role: "user" | "assistant"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content?: string;
      readonly toolCalls: readonly InferenceToolCall[];
    }
  | {
      readonly role: "tool";
      readonly callId: string;
      readonly toolId: string;
      readonly output?: JsonValue;
      readonly error?: ErrorEnvelope;
    };

export type InferenceToolValueSchema =
  | { readonly type: "string"; readonly description?: string; readonly enum?: readonly string[] }
  | { readonly type: "number"; readonly description?: string }
  | { readonly type: "boolean"; readonly description?: string }
  | { readonly type: "json"; readonly description?: string }
  | {
      readonly type: "array";
      readonly description?: string;
      readonly items: InferenceToolValueSchema;
    }
  | InferenceToolInputSchema;

/** Small JSON-compatible schema vocabulary. Runtimes may translate it to their schema library. */
export interface InferenceToolInputSchema {
  readonly type: "object";
  readonly description?: string;
  readonly properties?: Readonly<Record<string, InferenceToolValueSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean;
}

export interface InferenceTool {
  /** Framework-stable identity. Runtimes may map it to a provider-safe function name. */
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly input: InferenceToolInputSchema;
}

export interface InferenceToolCall {
  readonly id: string;
  readonly toolId: string;
  readonly input: Readonly<Record<string, JsonValue>>;
}

export interface InferenceUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export interface ModelSelection {
  readonly configId?: string;
  readonly provider: string;
  readonly model: string;
  readonly credentialRef?: string;
  readonly settings?: Readonly<Record<string, JsonValue>>;
}

export type InferenceFinishReason = "stop" | "tool_calls" | "length" | "refusal" | "content_filter";

export type InferenceEvent =
  | { readonly type: "started" }
  | { readonly type: "step_started"; readonly step: number; readonly tools: readonly string[] }
  | { readonly type: "text_delta"; readonly step: number; readonly delta: string }
  | { readonly type: "structured_output"; readonly step: number; readonly output: JsonValue }
  | ({ readonly type: "tool_call"; readonly step: number } & InferenceToolCall)
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
  | { readonly type: "completed"; readonly output: JsonValue; readonly usage?: InferenceUsage }
  | { readonly type: "refused"; readonly reason?: string; readonly usage?: InferenceUsage }
  | { readonly type: "failed"; readonly error: ErrorEnvelope; readonly usage?: InferenceUsage }
  | { readonly type: "cancelled"; readonly usage?: InferenceUsage };

export interface InferenceInput {
  readonly messages: readonly InferenceMessage[];
  readonly instructions?: string;
  /** Model selection for User/System inference. Agent Actors use their persisted configuration. */
  readonly model?: ModelSelection;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

export interface InferenceToolContext {
  readonly execution: ExecutionContext;
  readonly actor: Actor;
  readonly messages: readonly InferenceMessage[];
  readonly step: number;
  readonly activeToolIds: ReadonlySet<string>;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
}

export interface ContextualInferenceTool extends InferenceTool {
  readonly availability?: "eager" | "discoverable";
  readonly keywords?: readonly string[];
  execute(
    input: Readonly<Record<string, JsonValue>>,
    context: InferenceToolContext,
  ): JsonValue | Promise<JsonValue>;
}

/** Trusted host extension for tools whose availability depends on the current step. */
export interface InferenceToolProvider {
  resolve(
    context: InferenceToolContext,
  ): readonly ContextualInferenceTool[] | Promise<readonly ContextualInferenceTool[]>;
}

/** A stable, executable snapshot. Its tools do not change during one model request. */
export interface InferenceToolSet {
  readonly tools: readonly InferenceTool[];
  execute(call: InferenceToolCall): Promise<JsonValue>;
}

/** Resolves contextual tools again at each model step. */
export interface InferenceToolGateway {
  resolve(context: InferenceToolContext): Promise<InferenceToolSet>;
}

export interface InferenceContext extends InferenceInput {
  readonly execution: ExecutionContext;
  readonly actor: Actor;
  readonly tools: InferenceToolGateway;
}

/** Framework's single integration boundary for a complete inference run. */
export interface InferenceRuntime {
  run(context: InferenceContext): AsyncIterable<InferenceEvent>;
}

export async function collectInferenceRun(
  events: AsyncIterable<InferenceEvent>,
): Promise<JsonValue> {
  let terminal: InferenceEvent | undefined;
  for await (const event of events) {
    if (terminal)
      throw invalidRuntime("InferenceRuntime emitted an event after its terminal event.");
    if (!["completed", "refused", "failed", "cancelled"].includes(event.type)) continue;
    terminal = event;
  }
  if (!terminal) throw invalidRuntime("InferenceRuntime ended without a terminal event.");
  if (terminal.type === "completed") return terminal.output;
  if (terminal.type === "failed") throw new FrameworkError(terminal.error);
  throw new FrameworkError({
    code:
      terminal.type === "refused" ? ERROR_CODES.inferenceRefused : ERROR_CODES.inferenceCancelled,
    message:
      terminal.type === "refused"
        ? (terminal.reason ?? "Inference was refused.")
        : "Inference run was cancelled.",
  });
}

function invalidRuntime(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.inferenceInvalidStream, message });
}
