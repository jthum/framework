import type { FormSubmission, SubmitFormInput } from "../kernel/forms.ts";
import type { InferenceEvent, InferenceInput, InferenceTool } from "../kernel/inference-runtime.ts";
import type {
  AgentBootstrap,
  ConfigureAgentInput,
  CreateAgentInput,
  CreateModelConfigInput,
  UpdateModelConfigInput,
} from "../kernel/agent-config.ts";
import type { Kernel, UpdateActorInput } from "../kernel/kernel.ts";
import type {
  ActorRequest,
  ResumeRuleInput,
  RuleExecutionDetails,
  RuleExecutionSummary,
} from "../kernel/durable-rules.ts";
import type {
  Actor,
  AgentConfig,
  ExecutionContext,
  ModelConfig,
  Workspace,
} from "../kernel/model.ts";
import type { RunRuleInput, RuleRun } from "../kernel/rules.ts";
import type { JsonValue, RuleDefinition } from "../spec/model.ts";

/** Transport-neutral durable operations. Components receive this, never a Kernel or database. */
export interface RuleExecutionClient {
  listRuleExecutions(limit?: number, offset?: number): Promise<readonly RuleExecutionSummary[]>;
  getRuleExecutionDetails(id: string): Promise<RuleExecutionDetails | null>;
  startRule(key: string, input?: RunRuleInput): Promise<RuleExecutionDetails>;
  resumeRule(id: string, input?: ResumeRuleInput): Promise<RuleExecutionDetails>;
  failRuleExecution(id: string): Promise<RuleExecutionDetails>;
  listActorRequests(executionId: string): Promise<readonly ActorRequest[]>;
  respondToActorRequest(
    executionId: string,
    requestId: string,
    values: Readonly<Record<string, JsonValue>>,
  ): Promise<ActorRequest>;
}

/** Context-bound inference operations using the bound Actor's current authority. */
export interface InferenceClient {
  listInferenceTools(): Promise<readonly InferenceTool[]>;
  runInference(input: InferenceInput): Promise<AsyncIterable<InferenceEvent>>;
}

/** Context-bound management operations for Agent settings surfaces. */
export interface AgentManagementClient {
  listAgents(): Promise<readonly Actor[]>;
  createAgent(input: CreateAgentInput): Promise<AgentBootstrap>;
  getAgentConfig(actorId: string): Promise<AgentConfig | null>;
  configureAgent(actorId: string, input: ConfigureAgentInput): Promise<AgentConfig>;
  listModelConfigs(): Promise<readonly ModelConfig[]>;
  getModelConfig(id: string): Promise<ModelConfig | null>;
  createModelConfig(input: CreateModelConfigInput): Promise<ModelConfig>;
  updateModelConfig(id: string, input: UpdateModelConfigInput): Promise<ModelConfig>;
  deleteModelConfig(id: string): Promise<void>;
}
import type { SourceDescriptor, SourceResult, SourceRow } from "../kernel/sources.ts";
import type { ViewQueryResult } from "../kernel/views.ts";
import type { CollectionRecord, RecordValues } from "../persistence/records.ts";
import { resourceNotFound } from "../errors/error.ts";
import type {
  FormDefinition,
  PageDefinition,
  SourceQueryDefinition,
  Spec,
  ViewDefinition,
  ViewQueryInput,
} from "../spec/model.ts";

/**
 * Context-bound operations consumed by interface code.
 *
 * A browser host can bind this directly to an in-process Kernel. A server or remote host can
 * implement the same contract over its transport without exposing Kernel lifecycle to the UI.
 */
export interface WorkspaceClient
  extends RuleExecutionClient, InferenceClient, AgentManagementClient {
  getWorkspace(): Promise<Workspace>;
  getActor(id: string): Promise<Actor | null>;
  updateActor(id: string, input: UpdateActorInput): Promise<Actor>;
  applySpec(spec: Spec): Promise<Workspace>;
  listRules(): Promise<readonly RuleDefinition[]>;
  /** Published Action Events run matching short Rules through the same authorization spine. */
  executeAction(key: string, input?: Readonly<Record<string, JsonValue>>): Promise<JsonValue>;
  /** Synchronous workflows; use startRule for durable waits and User requests. */
  runRule(key: string, input?: RunRuleInput): Promise<RuleRun>;

  createRecord(collectionKey: string, values: RecordValues): Promise<CollectionRecord>;
  getRecord(collectionKey: string, recordId: string): Promise<CollectionRecord | null>;
  listRecords(collectionKey: string): Promise<CollectionRecord[]>;
  updateRecord(
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord>;
  deleteRecord(collectionKey: string, recordId: string): Promise<void>;

  listSources(): Promise<SourceDescriptor[]>;
  getSource(key: string): Promise<SourceDescriptor | null>;
  querySource(key: string, query?: SourceQueryDefinition): Promise<SourceResult>;
  getSourceRecord(key: string, id: string): Promise<SourceRow | null>;

  listViews(): Promise<readonly ViewDefinition[]>;
  getView(key: string): Promise<ViewDefinition | null>;
  queryView(key: string, input?: ViewQueryInput): Promise<ViewQueryResult>;
  previewView(view: ViewDefinition, input?: ViewQueryInput): Promise<ViewQueryResult>;

  listForms(): Promise<readonly FormDefinition[]>;
  getForm(key: string): Promise<FormDefinition | null>;
  submitForm(key: string, input: SubmitFormInput): Promise<FormSubmission>;

  listPages(): Promise<readonly PageDefinition[]>;
  getPage(key: string): Promise<PageDefinition | null>;
}

/** Binds one validated execution context without taking ownership of the Kernel. */
export async function createWorkspaceClient(
  kernel: Kernel,
  context: ExecutionContext,
): Promise<WorkspaceClient> {
  const resolved = await kernel.resolveContext(context);
  return new LocalWorkspaceClient(kernel, resolved);
}

class LocalWorkspaceClient implements WorkspaceClient {
  constructor(
    private readonly kernel: Kernel,
    private readonly context: ExecutionContext,
  ) {}

  getActor(id: string) {
    return this.kernel.getActor(this.context, id);
  }

  updateActor(id: string, input: UpdateActorInput) {
    return this.kernel.updateActor(this.context, id, input);
  }

  listInferenceTools() {
    return this.kernel.listInferenceTools(this.context);
  }

  runInference(input: InferenceInput) {
    return this.kernel.runInference(this.context, input);
  }

  async listAgents() {
    return (await this.kernel.listActorsByOrigin(this.context)).filter(
      (actor) => actor.kind === "agent",
    );
  }

  createAgent(input: CreateAgentInput) {
    return this.kernel.createAgent(this.context, input);
  }

  getAgentConfig(actorId: string) {
    return this.kernel.getAgentConfig(this.context, actorId);
  }

  configureAgent(actorId: string, input: ConfigureAgentInput) {
    return this.kernel.configureAgent(this.context, actorId, input);
  }

  listModelConfigs() {
    return this.kernel.listModelConfigs(this.context);
  }

  getModelConfig(id: string) {
    return this.kernel.getModelConfig(this.context, id);
  }

  createModelConfig(input: CreateModelConfigInput) {
    return this.kernel.createModelConfig(this.context, input);
  }

  updateModelConfig(id: string, input: UpdateModelConfigInput) {
    return this.kernel.updateModelConfig(this.context, id, input);
  }

  deleteModelConfig(id: string) {
    return this.kernel.deleteModelConfig(this.context, id);
  }

  async listRules(): Promise<readonly RuleDefinition[]> {
    return (await this.getWorkspace()).spec.rules;
  }
  executeAction(key: string, input?: Readonly<Record<string, JsonValue>>) {
    return this.kernel.executeAction(this.context, key, input);
  }
  runRule(key: string, input?: RunRuleInput) {
    return this.kernel.runRule(this.context, key, input);
  }
  listRuleExecutions(limit?: number, offset?: number) {
    return this.kernel.listRuleExecutions(this.context, limit, offset);
  }
  getRuleExecutionDetails(id: string) {
    return this.kernel.getRuleExecutionDetails(this.context, id);
  }
  async startRule(key: string, input?: RunRuleInput) {
    const execution = await this.kernel.startRule(this.context, key, input);
    return this.requireDetails(execution.id);
  }
  async resumeRule(id: string, input?: ResumeRuleInput) {
    await this.kernel.resumeRule(this.context, id, input);
    return this.requireDetails(id);
  }
  async failRuleExecution(id: string) {
    await this.kernel.failRuleExecution(this.context, id);
    return this.requireDetails(id);
  }
  listActorRequests(executionId: string) {
    return this.kernel.listActorRequests(this.context, executionId);
  }
  respondToActorRequest(
    executionId: string,
    requestId: string,
    values: Readonly<Record<string, JsonValue>>,
  ) {
    return this.kernel.respondToActorRequest(this.context, executionId, requestId, values);
  }
  private async requireDetails(id: string): Promise<RuleExecutionDetails> {
    const execution = await this.getRuleExecutionDetails(id);
    if (!execution) throw resourceNotFound("RuleExecution", id);
    return execution;
  }

  async getWorkspace(): Promise<Workspace> {
    const workspace = await this.kernel.getWorkspace(this.context);
    if (!workspace) throw resourceNotFound("Workspace", this.context.workspaceId);
    return workspace;
  }

  applySpec(spec: Spec): Promise<Workspace> {
    return this.kernel.applySpec(this.context, spec);
  }

  createRecord(collectionKey: string, values: RecordValues): Promise<CollectionRecord> {
    return this.kernel.createRecord(this.context, collectionKey, values);
  }

  getRecord(collectionKey: string, recordId: string): Promise<CollectionRecord | null> {
    return this.kernel.getRecord(this.context, collectionKey, recordId);
  }

  listRecords(collectionKey: string): Promise<CollectionRecord[]> {
    return this.kernel.listRecords(this.context, collectionKey);
  }

  updateRecord(
    collectionKey: string,
    recordId: string,
    values: RecordValues,
  ): Promise<CollectionRecord> {
    return this.kernel.updateRecord(this.context, collectionKey, recordId, values);
  }

  deleteRecord(collectionKey: string, recordId: string): Promise<void> {
    return this.kernel.deleteRecord(this.context, collectionKey, recordId);
  }

  listSources(): Promise<SourceDescriptor[]> {
    return this.kernel.listSources(this.context);
  }

  getSource(key: string): Promise<SourceDescriptor | null> {
    return this.kernel.getSource(this.context, key);
  }

  querySource(key: string, query?: SourceQueryDefinition): Promise<SourceResult> {
    return this.kernel.querySource(this.context, key, query);
  }

  getSourceRecord(key: string, id: string): Promise<SourceRow | null> {
    return this.kernel.getSourceRecord(this.context, key, id);
  }

  listViews(): Promise<readonly ViewDefinition[]> {
    return this.kernel.listViews(this.context);
  }

  getView(key: string): Promise<ViewDefinition | null> {
    return this.kernel.getView(this.context, key);
  }

  queryView(key: string, input?: ViewQueryInput): Promise<ViewQueryResult> {
    return this.kernel.queryView(this.context, key, input);
  }

  previewView(view: ViewDefinition, input?: ViewQueryInput): Promise<ViewQueryResult> {
    return this.kernel.previewView(this.context, view, input);
  }

  listForms(): Promise<readonly FormDefinition[]> {
    return this.kernel.listForms(this.context);
  }

  getForm(key: string): Promise<FormDefinition | null> {
    return this.kernel.getForm(this.context, key);
  }

  submitForm(key: string, input: SubmitFormInput): Promise<FormSubmission> {
    return this.kernel.submitForm(this.context, key, input);
  }

  listPages(): Promise<readonly PageDefinition[]> {
    return this.kernel.listPages(this.context);
  }

  getPage(key: string): Promise<PageDefinition | null> {
    return this.kernel.getPage(this.context, key);
  }
}
