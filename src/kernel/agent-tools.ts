import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { CatalogRepository } from "../persistence/catalog.ts";
import type { JsonValue, RuleInputDefinition } from "../spec/model.ts";
import { agentToolAllowed } from "./agent-config.ts";
import type { ActionRegistry } from "./action-registry.ts";
import type {
  AgentTool,
  AgentToolCall,
  AgentToolContext,
  AgentToolGateway,
  AgentToolInputSchema,
  AgentToolProvider,
  AgentToolValueSchema,
} from "./agent-runtime.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { AgentToolPolicy, ExecutionContext } from "./model.ts";
import { requiresDurableExecution } from "./rule-compatibility.ts";
import type { RuleRun, RunRuleInput } from "./rules.ts";

interface AgentToolOperations {
  executeAction(
    context: ExecutionContext,
    key: string,
    input: Readonly<Record<string, JsonValue>>,
  ): Promise<JsonValue>;
  runRule(context: ExecutionContext, key: string, input: RunRuleInput): Promise<RuleRun>;
  startRule(
    context: ExecutionContext,
    key: string,
    input: RunRuleInput,
  ): Promise<{ readonly id: string; readonly status: string }>;
}

/** Resolves and executes the effective per-step Action, Rule, and host tool catalog. */
export class AgentToolService {
  constructor(
    private readonly catalog: CatalogRepository,
    private readonly actions: ActionRegistry,
    private readonly providers: readonly AgentToolProvider[],
    private readonly operations: AgentToolOperations,
    private readonly isAuthorized: (request: AuthorizationRequest) => Promise<boolean>,
  ) {}

  gateway(context: ExecutionContext, policy: AgentToolPolicy): AgentToolGateway {
    return { resolve: (toolContext) => this.project(context, toolContext, policy, false) };
  }

  list(
    context: ExecutionContext,
    toolContext: AgentToolContext,
    policy: AgentToolPolicy,
  ): Promise<{ readonly tools: readonly AgentTool[] }> {
    return this.project(context, toolContext, policy, true);
  }

  private async project(
    context: ExecutionContext,
    toolContext: AgentToolContext,
    policy: AgentToolPolicy,
    includeDiscoverable: boolean,
  ): Promise<{
    readonly tools: readonly AgentTool[];
    execute(call: AgentToolCall): Promise<JsonValue>;
  }> {
    const workspace = await this.catalog.getWorkspace(context.workspaceId);
    if (!workspace) throw resourceNotFound("Workspace", context.workspaceId);
    const executors = new Map<
      string,
      (input: Readonly<Record<string, JsonValue>>) => Promise<JsonValue>
    >();
    const eager: AgentTool[] = [];
    const discoverable: Array<AgentTool & { readonly keywords: readonly string[] }> = [];

    for (const action of this.actions.list()) {
      if (!action.tool) continue;
      if (
        !(await this.isAuthorized({
          context,
          operation: "actions.execute",
          resource: { kind: "action", id: action.key, workspaceId: context.workspaceId },
        }))
      )
        continue;
      const id = `action:${action.key}`;
      if (!agentToolAllowed(policy, id)) continue;
      const { availability = "eager", keywords = [], ...tool } = structuredClone(action.tool);
      const projected = { id, ...tool };
      if (availability === "discoverable") discoverable.push({ ...projected, keywords });
      else eager.push(projected);
      executors.set(id, (input) => this.operations.executeAction(context, action.key, input));
    }

    for (const rule of workspace.spec.rules) {
      if (rule.enabled === false || !rule.expose?.includes("agent")) continue;
      if (
        !(await this.isAuthorized({
          context,
          operation: "rules.run",
          resource: { kind: "rule", id: rule.id, workspaceId: context.workspaceId },
        }))
      )
        continue;
      const id = `rule:${rule.id}`;
      if (!agentToolAllowed(policy, id)) continue;
      discoverable.push({
        id,
        label: rule.label,
        description: rule.description ?? `Run the ${rule.label} Rule.`,
        input: ruleInputSchema(rule.input),
        keywords: [rule.key, rule.label],
      });
      executors.set(id, async (input) => {
        if (requiresDurableExecution(rule, workspace.spec.rules)) {
          const execution = await this.operations.startRule(context, rule.key, { input });
          return { mode: "durable", executionId: execution.id, status: execution.status };
        }
        const run = await this.operations.runRule(context, rule.key, { input });
        return {
          mode: "short",
          ruleId: run.ruleId,
          ruleKey: run.ruleKey,
          status: run.status,
          vars: { ...run.vars },
          trace: run.trace.map((item) => ({ ...item })),
        };
      });
    }

    for (const provider of this.providers) {
      for (const definition of await provider.resolve(toolContext)) {
        if (!agentToolAllowed(policy, definition.id)) continue;
        const { availability = "eager", keywords = [] } = definition;
        if (executors.has(definition.id))
          throw resourceConflict(`Agent tool ${definition.id} is already registered.`);
        const projected: AgentTool = structuredClone({
          id: definition.id,
          label: definition.label,
          description: definition.description,
          input: definition.input,
        });
        if (availability === "discoverable") discoverable.push({ ...projected, keywords });
        else eager.push(projected);
        executors.set(definition.id, async (input) =>
          definition.execute(structuredClone(input), toolContext),
        );
      }
    }

    const visibleDiscoverable =
      includeDiscoverable || !policy.search
        ? discoverable
        : discoverable.filter((tool) => toolContext.activeToolIds.has(tool.id));
    const tools: AgentTool[] = [...eager, ...visibleDiscoverable];
    if (policy.search && !includeDiscoverable && discoverable.length > visibleDiscoverable.length)
      tools.push(searchToolsDefinition());
    tools.sort((left, right) => left.id.localeCompare(right.id));

    const offered = new Set(tools.map((tool) => tool.id));
    return {
      tools: tools.map((tool) => structuredClone(tool)),
      execute: async (call) => {
        if (!offered.has(call.toolId)) throw resourceNotFound("AgentTool", call.toolId);
        if (call.toolId === "search_tools") return searchAgentTools(discoverable, call.input);
        const current = await this.project(
          context,
          { ...toolContext, activeToolIds: new Set([call.toolId]) },
          policy,
          false,
        );
        if (!current.tools.some((tool) => tool.id === call.toolId))
          throw resourceNotFound("AgentTool", call.toolId);
        const execute = executors.get(call.toolId);
        if (!execute) throw resourceNotFound("AgentTool", call.toolId);
        return execute(structuredClone(call.input));
      },
    };
  }
}

function ruleInputSchema(
  input: Readonly<Record<string, RuleInputDefinition>> | undefined,
): AgentToolInputSchema {
  const entries = Object.entries(input ?? {});
  return {
    type: "object",
    properties: Object.fromEntries(
      entries.map(([key, definition]) => [key, ruleInputValueSchema(definition)]),
    ),
    ...(entries.some(([, definition]) => definition.required)
      ? { required: entries.filter(([, definition]) => definition.required).map(([key]) => key) }
      : {}),
    additionalProperties: false,
  };
}

function ruleInputValueSchema(definition: RuleInputDefinition): AgentToolValueSchema {
  if ("sourceId" in definition)
    return { type: "string", description: `Record ID from Source ${definition.sourceId}.` };
  if (definition.value === "text" || definition.value === "date") return { type: "string" };
  if (definition.value === "number") return { type: "number" };
  if (definition.value === "boolean") return { type: "boolean" };
  if (definition.value === "array") return { type: "array", items: { type: "json" } };
  return { type: "object", additionalProperties: true };
}

function searchToolsDefinition(): AgentTool {
  return {
    id: "search_tools",
    label: "Search tools",
    description:
      "Find additional tools relevant to the current task. Matches become available on the next step.",
    input: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words describing the capability or task." },
        limit: { type: "number", description: "Maximum number of matches. Defaults to 8." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

function searchAgentTools(
  tools: readonly (AgentTool & { readonly keywords: readonly string[] })[],
  input: Readonly<Record<string, JsonValue>>,
): JsonValue {
  const query = requiredString(input.query, "query").toLocaleLowerCase();
  const requestedLimit = input.limit;
  if (
    requestedLimit !== undefined &&
    (typeof requestedLimit !== "number" || !Number.isInteger(requestedLimit) || requestedLimit < 1)
  )
    throw invalidInput("Tool search limit must be a positive integer.");
  const limit = Math.min(typeof requestedLimit === "number" ? requestedLimit : 8, 20);
  const terms = query.split(/\s+/u).filter(Boolean);
  const matches = tools
    .map((tool) => ({
      tool,
      score: terms.reduce((score, term) => {
        const text =
          `${tool.id} ${tool.label} ${tool.description} ${tool.keywords.join(" ")}`.toLocaleLowerCase();
        return score + (text.includes(term) ? 1 : 0);
      }, 0),
    }))
    .filter(({ score }) => score > 0)
    .sort((left, right) => right.score - left.score || left.tool.id.localeCompare(right.tool.id))
    .slice(0, limit)
    .map(({ tool }) => ({ id: tool.id, label: tool.label, description: tool.description }));
  return { query, tools: matches };
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalidInput(`${name} is required.`);
  return value.trim();
}

function invalidInput(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}
