import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import type { JsonValue } from "../spec/model.ts";
import type { Actor, ExecutionContext } from "./model.ts";

export type AgentMessageRole = "user" | "assistant";

export interface AgentMessage {
  readonly role: AgentMessageRole;
  readonly content: string;
}

export type AgentToolValueSchema =
  | {
      readonly type: "string";
      readonly description?: string;
      readonly enum?: readonly string[];
    }
  | { readonly type: "number"; readonly description?: string }
  | { readonly type: "boolean"; readonly description?: string }
  | { readonly type: "json"; readonly description?: string }
  | {
      readonly type: "array";
      readonly description?: string;
      readonly items: AgentToolValueSchema;
    }
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
  /** Framework-stable tool identity. Adapters may map it to a provider-safe function name. */
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

export type AgentRunEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | ({ readonly type: "tool_call" } & AgentToolCall)
  | {
      readonly type: "tool_result";
      readonly callId: string;
      readonly toolId: string;
      readonly output: JsonValue;
    }
  | {
      readonly type: "completed";
      readonly output: JsonValue;
      readonly usage?: AgentUsage;
    };

export interface AgentRunInput {
  readonly messages: readonly AgentMessage[];
  readonly instructions?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

export interface AgentRuntimeRequest extends AgentRunInput {
  readonly context: ExecutionContext;
  readonly agent: Actor & { readonly kind: "agent" };
  readonly tools: readonly AgentTool[];
  readonly invokeTool: (
    toolId: string,
    input: Readonly<Record<string, JsonValue>>,
  ) => Promise<JsonValue>;
}

/** Provider-neutral model/tool loop. Provider SDKs belong in optional adapters. */
export interface AgentRuntime {
  run(request: AgentRuntimeRequest): AsyncIterable<AgentRunEvent>;
}

export async function collectAgentRun(events: AsyncIterable<AgentRunEvent>): Promise<JsonValue> {
  let completed: JsonValue | undefined;
  for await (const event of events) {
    if (event.type !== "completed") continue;
    if (completed !== undefined)
      throw invalidRuntime("AgentRuntime emitted more than one completed event.");
    completed = event.output;
  }
  if (completed === undefined)
    throw invalidRuntime("AgentRuntime ended without a completed event.");
  return completed;
}

function invalidRuntime(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.internalUnexpected, message });
}
