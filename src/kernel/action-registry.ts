import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import type { JsonValue } from "../spec/model.ts";
import type { ExecutionContext } from "./model.ts";
import type { RuleEvent } from "./rules.ts";
import type { SourceRow } from "./sources.ts";
import type { InferenceToolInputSchema } from "./inference-runtime.ts";
import type { RuntimeAction } from "./workspace-config.ts";

export type ActionOrigin =
  | { readonly kind: "call" }
  | { readonly kind: "rule"; readonly ruleId: string; readonly stepId: string };

export interface ActionRuntime {
  createRecord(
    context: ExecutionContext,
    collectionKey: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  getRecord(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
  ): Promise<CollectionRecord | null>;
  listRecords(context: ExecutionContext, collectionKey: string): Promise<CollectionRecord[]>;
  updateRecord(
    context: ExecutionContext,
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  deleteRecord(context: ExecutionContext, collectionKey: string, recordId: string): Promise<void>;
  getSourceRecord(
    context: ExecutionContext,
    sourceKey: string,
    recordId: string,
  ): Promise<SourceRow | null>;
  updateSourceRecord(
    context: ExecutionContext,
    sourceKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  deleteSourceRecord(context: ExecutionContext, sourceKey: string, recordId: string): Promise<void>;
}

export interface ActionExecution {
  readonly context: ExecutionContext;
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly runtime: ActionRuntime;
  readonly origin: ActionOrigin;
  readonly publish: (event: RuleEvent) => Promise<void>;
  /** Delegate through the same Actor, authorization, and bounded execution state. */
  readonly callAction: (
    key: string,
    input?: Readonly<Record<string, JsonValue>>,
  ) => Promise<JsonValue>;
  /** Resolve a setting in this Workspace; only trusted executors receive this function. */
  readonly getSetting: (key: string) => Promise<JsonValue | null>;
}

/** A host-supplied executor for one runtime Action implementation kind. */
export interface RuntimeActionExecutor {
  readonly kind: string;
  run(
    action: RuntimeAction,
    execution: ActionExecution,
  ): JsonValue | void | Promise<JsonValue | void>;
}

export interface ActionDefinition {
  /** Immutable semantic contract key, for example `records.create`. */
  readonly key: string;
  /** Optional opt-in metadata for projecting this Action as an Inference tool. */
  readonly tool?: {
    readonly label: string;
    readonly description: string;
    readonly input: InferenceToolInputSchema;
    /** Discoverable tools are activated through `search_tools` instead of sent on every step. */
    readonly availability?: "eager" | "discoverable";
    readonly keywords?: readonly string[];
  };
  readonly run: (execution: ActionExecution) => JsonValue | void | Promise<JsonValue | void>;
}

/** Runtime-owned executable Actions. The portable Spec stores only their semantic keys. */
export class ActionRegistry {
  private readonly definitions = new Map<string, ActionDefinition>();

  constructor(definitions: readonly ActionDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ActionDefinition): void {
    const key = requiredKey(definition.key, "Action");
    if (this.definitions.has(key)) throw resourceConflict(`Action ${key} is already registered.`);
    this.definitions.set(key, { ...definition, key });
  }

  has(key: string): boolean {
    return this.definitions.has(key);
  }

  keys(): ReadonlySet<string> {
    return new Set(this.definitions.keys());
  }

  list(): readonly ActionDefinition[] {
    return [...this.definitions.values()];
  }

  async run(key: string, execution: ActionExecution): Promise<JsonValue | null> {
    const definition = this.definitions.get(key);
    if (!definition)
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: `The ${key} Action is not installed in this runtime.`,
        details: { action: key },
      });
    return (await definition.run(execution)) ?? null;
  }
}

function requiredKey(value: string, kind: string): string {
  const key = value.trim();
  if (!key) throw resourceConflict(`${kind} key is required.`);
  return key;
}
