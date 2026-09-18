import { ERROR_CODES, FrameworkError, resourceNotFound } from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { JsonValue } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ModelSelection } from "./agent-runtime.ts";
import type { Clock, IdGenerator } from "./defaults.ts";
import type {
  Actor,
  AgentConfig,
  AgentToolPolicy,
  ExecutionContext,
  Membership,
  ModelConfig,
  Permission,
} from "./model.ts";

export interface CreateModelConfigInput {
  readonly name: string;
  readonly provider: string;
  readonly model: string;
  readonly credentialRef?: string;
  readonly settings?: Readonly<Record<string, JsonValue>>;
}

export type UpdateModelConfigInput = CreateModelConfigInput;

export interface ConfigureAgentInput {
  readonly modelConfigId: string;
  readonly instructions: string;
  readonly tools?: Partial<AgentToolPolicy>;
}

export interface CreateAgentInput {
  readonly name: string;
  readonly email?: string;
  readonly instructions: string;
  readonly provider: string;
  readonly model: string;
  readonly credentialRef?: string;
  readonly settings?: Readonly<Record<string, JsonValue>>;
  readonly tools?: Partial<AgentToolPolicy>;
  readonly roles?: readonly string[];
  readonly permissions?: readonly Permission[];
}

export interface AgentBootstrap {
  readonly actor: Actor;
  readonly membership: Membership;
  readonly config: AgentConfig;
  readonly model: ModelConfig;
}

export interface AgentExecutionConfig {
  readonly instructions: string;
  readonly model: ModelSelection;
  readonly tools: AgentToolPolicy;
}

/** Persists Agent identity settings while provider execution stays behind InferenceAdapter. */
export class AgentConfigService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async create(context: ExecutionContext, input: CreateAgentInput): Promise<AgentBootstrap> {
    await this.assertContext(context);
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    await this.authorize({
      context,
      operation: "agents.create",
      resource: { kind: "workspace", id: workspace.id, workspaceId: workspace.id },
    });
    if (!workspace.policy.createActors)
      throw new FrameworkError({
        code: ERROR_CODES.permissionDenied,
        message: "This Workspace does not permit creating local Actors.",
      });
    const stamp = this.clock.now();
    const name = requiredName(input.name, "Agent");
    const actor: Actor = {
      id: this.ids.create("actor"),
      originId: workspace.id,
      rootId: workspace.rootId,
      kind: "agent",
      name,
      ...(input.email === undefined ? {} : { email: input.email }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const model: ModelConfig = {
      id: this.ids.create("model_config"),
      workspaceId: workspace.id,
      name: `${name} model`,
      provider: requiredName(input.provider, "Provider"),
      model: requiredName(input.model, "Model"),
      ...(input.credentialRef === undefined
        ? {}
        : { credentialRef: requiredName(input.credentialRef, "Credential reference") }),
      ...(input.settings === undefined ? {} : { settings: structuredClone(input.settings) }),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const config: AgentConfig = {
      actorId: actor.id,
      modelConfigId: model.id,
      instructions: requiredName(input.instructions, "Agent instructions"),
      tools: normalizeAgentToolPolicy(input.tools),
      createdAt: stamp,
      updatedAt: stamp,
    };
    const agentMembership = createMembership(
      this.ids,
      stamp,
      actor.id,
      workspace.id,
      input.roles ?? ["agent"],
      input.permissions ?? ["read"],
    );
    await this.catalog.transaction(async (transaction) => {
      await transaction.insertActor(actor);
      await transaction.insertModelConfig(model);
      await transaction.insertAgentConfig(config);
      await transaction.insertMembership(agentMembership);
    });
    return { actor, membership: agentMembership, config, model };
  }

  async createModel(
    context: ExecutionContext,
    input: CreateModelConfigInput,
  ): Promise<ModelConfig> {
    await this.authorizeWorkspace(context, "model_configs.create", context.workspaceId);
    const stamp = this.clock.now();
    const config: ModelConfig = {
      id: this.ids.create("model_config"),
      workspaceId: context.workspaceId,
      ...modelValues(input),
      createdAt: stamp,
      updatedAt: stamp,
    };
    await this.catalog.transaction((transaction) => transaction.insertModelConfig(config));
    return config;
  }

  async listModels(context: ExecutionContext): Promise<readonly ModelConfig[]> {
    await this.authorizeWorkspace(context, "model_configs.manage", context.workspaceId);
    return this.catalog.listModelConfigs(context.workspaceId);
  }

  async getModel(context: ExecutionContext, id: string): Promise<ModelConfig | null> {
    await this.assertContext(context);
    const config = await this.catalog.getModelConfig(id);
    if (!config) return null;
    await this.authorizeWorkspace(context, "model_configs.manage", config.workspaceId, false);
    return config;
  }

  async updateModel(
    context: ExecutionContext,
    id: string,
    input: UpdateModelConfigInput,
  ): Promise<ModelConfig> {
    await this.assertContext(context);
    const current = await this.catalog.getModelConfig(id);
    if (!current) throw resourceNotFound("ModelConfig", id);
    await this.authorizeWorkspace(context, "model_configs.update", current.workspaceId, false);
    const config: ModelConfig = {
      id: current.id,
      workspaceId: current.workspaceId,
      ...modelValues(input),
      createdAt: current.createdAt,
      updatedAt: this.clock.now(),
    };
    await this.catalog.transaction((transaction) => transaction.updateModelConfig(config));
    return config;
  }

  async deleteModel(context: ExecutionContext, id: string): Promise<void> {
    await this.assertContext(context);
    const current = await this.catalog.getModelConfig(id);
    if (!current) throw resourceNotFound("ModelConfig", id);
    await this.authorizeWorkspace(context, "model_configs.delete", current.workspaceId, false);
    await this.catalog.transaction((transaction) => transaction.deleteModelConfig(id));
  }

  async get(context: ExecutionContext, actorId: string): Promise<AgentConfig | null> {
    await this.assertContext(context);
    const actor = await this.requireActor(actorId);
    await this.authorize({
      context,
      operation: "agent_configs.manage",
      resource: { kind: "actor", id: actor.id, workspaceId: actor.originId },
    });
    return this.catalog.getAgentConfig(actorId);
  }

  async configure(
    context: ExecutionContext,
    actorId: string,
    input: ConfigureAgentInput,
  ): Promise<AgentConfig> {
    await this.assertContext(context);
    const actor = await this.requireActor(actorId);
    await this.authorize({
      context,
      operation: "agent_configs.update",
      resource: { kind: "actor", id: actor.id, workspaceId: actor.originId },
    });
    const current = await this.catalog.getAgentConfig(actorId);
    const stamp = this.clock.now();
    const config: AgentConfig = {
      actorId,
      modelConfigId: input.modelConfigId,
      instructions: requiredName(input.instructions, "Agent instructions"),
      tools: normalizeAgentToolPolicy(input.tools),
      createdAt: current?.createdAt ?? stamp,
      updatedAt: stamp,
    };
    await this.catalog.transaction((transaction) =>
      current ? transaction.updateAgentConfig(config) : transaction.insertAgentConfig(config),
    );
    return config;
  }

  async execution(actor: Actor): Promise<AgentExecutionConfig | null> {
    if (actor.kind !== "agent") return null;
    const config = await this.catalog.getAgentConfig(actor.id);
    if (!config) throw resourceNotFound("AgentConfig", actor.id);
    const model = await this.catalog.getModelConfig(config.modelConfigId);
    if (!model) throw resourceNotFound("ModelConfig", config.modelConfigId);
    return {
      instructions: config.instructions,
      model: {
        configId: model.id,
        provider: model.provider,
        model: model.model,
        ...(model.credentialRef === undefined ? {} : { credentialRef: model.credentialRef }),
        ...(model.settings === undefined ? {} : { settings: structuredClone(model.settings) }),
      },
      tools: config.tools,
    };
  }

  private async authorizeWorkspace(
    context: ExecutionContext,
    operation: string,
    workspaceId: string,
    validate = true,
  ): Promise<void> {
    if (validate) await this.assertContext(context);
    await this.authorize({
      context,
      operation,
      resource: { kind: "workspace", id: workspaceId, workspaceId },
    });
  }

  private async requireActor(id: string): Promise<Actor> {
    const actor = await this.catalog.getActor(id);
    if (!actor) throw resourceNotFound("Actor", id);
    return actor;
  }
}

export function defaultAgentToolPolicy(): AgentToolPolicy {
  return { search: true };
}

export function normalizeAgentToolPolicy(
  input: Partial<AgentToolPolicy> | undefined,
): AgentToolPolicy {
  return {
    ...(input?.include === undefined ? {} : { include: [...input.include] }),
    ...(input?.exclude === undefined ? {} : { exclude: [...input.exclude] }),
    search: input?.search ?? true,
  };
}

export function agentToolAllowed(policy: AgentToolPolicy, id: string): boolean {
  return (
    (policy.include === undefined || policy.include.includes(id)) && !policy.exclude?.includes(id)
  );
}

function modelValues(input: CreateModelConfigInput) {
  return {
    name: requiredName(input.name, "ModelConfig"),
    provider: requiredName(input.provider, "Provider"),
    model: requiredName(input.model, "Model"),
    ...(input.credentialRef === undefined
      ? {}
      : { credentialRef: requiredName(input.credentialRef, "Credential reference") }),
    ...(input.settings === undefined ? {} : { settings: structuredClone(input.settings) }),
  };
}

function createMembership(
  ids: IdGenerator,
  stamp: string,
  actorId: string,
  workspaceId: string,
  roles: readonly string[],
  permissions: readonly Permission[],
): Membership {
  return {
    id: ids.create("membership"),
    actorId,
    workspaceId,
    roles: [...roles],
    permissions: [...permissions],
    createdAt: stamp,
    updatedAt: stamp,
  };
}

function requiredName(value: string, kind: string): string {
  const name = value.trim();
  if (!name)
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: `${kind} is required.`,
    });
  return name;
}
