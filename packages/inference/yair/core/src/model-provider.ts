import type {
  ErrorEnvelope,
  JsonValue,
  InferenceFinishReason,
  InferenceMessage,
  InferenceTool,
  InferenceToolCall,
  InferenceUsage,
  ModelSelection,
} from "@jthum/framework";

export type ModelEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | { readonly type: "structured_output"; readonly output: JsonValue }
  | ({ readonly type: "tool_call" } & InferenceToolCall)
  | { readonly type: "usage"; readonly usage: InferenceUsage }
  | { readonly type: "finished"; readonly reason: InferenceFinishReason; readonly message?: string }
  | { readonly type: "failed"; readonly error: ErrorEnvelope }
  | { readonly type: "cancelled" };

export interface ModelRequest {
  readonly messages: readonly InferenceMessage[];
  readonly tools: readonly InferenceTool[];
  readonly model?: ModelSelection;
  readonly instructions?: string;
  readonly metadata?: Readonly<Record<string, JsonValue>>;
  readonly signal?: AbortSignal;
}

/** One provider/model request. Provider packages implement this YAIR-specific port. */
export interface ModelProvider {
  infer(request: ModelRequest): AsyncIterable<ModelEvent>;
}
