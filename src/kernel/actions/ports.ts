import type { CollectionDefinition, JsonValue, RuleDefinition, Spec } from "../../spec/model.ts";
import type { CollectionRecord } from "../../persistence/records.ts";
import type { CollectionSeed } from "../../persistence/catalog.ts";
import type { ExecutionContext, ScopeConfig, Workspace } from "../model.ts";
import type { AuthorizationRequest } from "../authorization.ts";
import type { Clock, IdGenerator } from "../defaults.ts";
import type { SourceService } from "../sources.ts";
import type { ViewService } from "../views.ts";
import type { InferenceEvent, InferenceInput } from "../inference-runtime.ts";
import type { RuleEvent } from "../rules.ts";

type Input = Readonly<Record<string, JsonValue>>;
type Publish = (event: RuleEvent) => Promise<void>;
interface SourceTarget {
  id: string;
  key: string;
  schema: CollectionDefinition;
}

/** Composition-only contracts. Each Action group receives only the subset it uses. */
export interface CoreActionPorts {
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly sources: Pick<SourceService, "list" | "describe" | "query">;
  readonly views: Pick<ViewService, "list" | "query" | "snapshot">;
  listRules(context: ExecutionContext): Promise<readonly RuleDefinition[]>;
  requireWorkspace(id: string): Promise<Workspace>;
  resolveWorkspace(context: ExecutionContext): Promise<Workspace>;
  applySpec(context: ExecutionContext, spec: Spec): Promise<Workspace>;
  getScopeConfig(context: ExecutionContext): Promise<ScopeConfig>;
  applyScopeConfigChange(
    context: ExecutionContext,
    config: ScopeConfig,
    seeds: readonly CollectionSeed[],
  ): Promise<ScopeConfig>;
  applySpecChange(
    context: ExecutionContext,
    spec: Spec,
    seeds: readonly CollectionSeed[],
  ): Promise<Workspace>;
  assertAuthorized(request: AuthorizationRequest): Promise<void>;
  collectionResource(
    context: ExecutionContext,
    collection: CollectionDefinition,
  ): AuthorizationRequest["resource"];
  assertReferences(
    context: ExecutionContext,
    collection: CollectionDefinition,
    values: Input,
  ): Promise<void>;
  createActionRecord(
    context: ExecutionContext,
    input: Input,
    publish: Publish,
  ): Promise<{ record: CollectionRecord; collection: CollectionDefinition }>;
  updateActionRecord(
    context: ExecutionContext,
    input: Input,
    publish: Publish,
  ): Promise<{ record: CollectionRecord; sourceId: string; schema: CollectionDefinition }>;
  actionRecordTarget(
    context: ExecutionContext,
    input: Input,
  ): Promise<{ source: SourceTarget; recordId: string }>;
  actionSource(context: ExecutionContext, input: Input): Promise<SourceTarget>;
  runInference(
    context: ExecutionContext,
    input: InferenceInput,
  ): Promise<AsyncIterable<InferenceEvent>>;
}
