import type { RuleDefinition, RuleStep } from "../spec/model.ts";

export type RuleCapabilitySupport = "supported" | "emulated" | "unsupported";

export interface RuleRuntimeProfile {
  readonly key: string;
  readonly label: string;
  /** Extensible capability keys; runtimes may publish namespaced additions. */
  readonly capabilities: Readonly<Record<string, RuleCapabilitySupport>>;
  /** Immutable semantic Action contract keys installed in this runtime. */
  readonly actions: ReadonlySet<string>;
  /** Event contract keys this runtime can publish or subscribe to. */
  readonly events: ReadonlySet<string>;
  /** Predicate contract keys installed in this runtime. */
  readonly conditions: ReadonlySet<string>;
  readonly notes?: Readonly<Record<string, string>>;
}

export interface RuleCompatibilityDiagnostic {
  readonly kind: "capability" | "action" | "event" | "condition";
  readonly key: string;
  readonly support: RuleCapabilitySupport;
  readonly message: string;
}

export interface RuleCompatibility {
  readonly compatible: boolean;
  readonly requiredCapabilities: readonly string[];
  readonly requiredActions: readonly string[];
  readonly requiredConditions: readonly string[];
  readonly diagnostics: readonly RuleCompatibilityDiagnostic[];
}

export function requiredRuleCapabilities(rule: RuleDefinition): string[] {
  const capabilities = new Set<string>();
  collectRequirements(rule.steps, capabilities, new Set());
  return [...capabilities];
}

export function requiredRuleActions(rule: RuleDefinition): string[] {
  const actions = new Set<string>();
  collectRequirements(rule.steps, new Set(), actions);
  return [...actions];
}

export function requiredRuleConditions(rule: RuleDefinition): string[] {
  const conditions = new Set<string>();
  collectConditions(rule.steps, conditions);
  return [...conditions];
}

export function checkRuleCompatibility(
  rule: RuleDefinition,
  profile: RuleRuntimeProfile,
): RuleCompatibility {
  const requiredCapabilities = requiredRuleCapabilities(rule);
  const requiredActions = requiredRuleActions(rule);
  const requiredConditions = requiredRuleConditions(rule);
  const diagnostics: RuleCompatibilityDiagnostic[] = [];
  if (rule.trigger && !profile.events.has(rule.trigger.event))
    diagnostics.push({
      kind: "event",
      key: rule.trigger.event,
      support: "unsupported",
      message: `${profile.label} does not provide the ${rule.trigger.event} Event.`,
    });
  for (const key of requiredActions)
    if (!profile.actions.has(key))
      diagnostics.push({
        kind: "action",
        key,
        support: "unsupported",
        message: `${profile.label} does not provide the ${key} Action.`,
      });
  for (const key of requiredConditions)
    if (!profile.conditions.has(key))
      diagnostics.push({
        kind: "condition",
        key,
        support: "unsupported",
        message: `${profile.label} does not provide the ${key} Condition.`,
      });
  for (const key of requiredCapabilities) {
    const support = profile.capabilities[key] ?? "unsupported";
    if (support !== "supported")
      diagnostics.push({
        kind: "capability",
        key,
        support,
        message: profile.notes?.[key] ?? `${profile.label} does not fully support ${key}.`,
      });
  }
  return {
    compatible: diagnostics.every((diagnostic) => diagnostic.support !== "unsupported"),
    requiredCapabilities,
    requiredActions,
    requiredConditions,
    diagnostics,
  };
}

function collectConditions(steps: readonly RuleStep[], conditions: Set<string>): void {
  for (const step of steps) {
    if ("gate" in step) {
      collectPredicateConditions(step.gate.predicate, conditions);
      collectConditions(step.gate.pass ?? [], conditions);
      collectConditions(step.gate.fail ?? [], conditions);
    } else if ("foreach" in step) collectConditions(step.foreach.steps, conditions);
    else if ("repeat" in step) collectConditions(step.repeat.steps, conditions);
    else if ("parallel" in step)
      for (const branch of step.parallel.branches) collectConditions(branch.steps, conditions);
    else if ("wait" in step) {
      collectConditions(step.wait.onSignal ?? [], conditions);
      collectConditions(step.wait.onTimeout ?? [], conditions);
    }
  }
}

function collectPredicateConditions(
  predicate: import("../spec/model.ts").RulePredicate,
  conditions: Set<string>,
): void {
  if ("all" in predicate && Array.isArray(predicate.all))
    for (const child of predicate.all) collectPredicateConditions(child, conditions);
  else if ("any" in predicate && Array.isArray(predicate.any))
    for (const child of predicate.any) collectPredicateConditions(child, conditions);
  else if (
    "not" in predicate &&
    predicate.not &&
    typeof predicate.not === "object" &&
    !Array.isArray(predicate.not)
  )
    collectPredicateConditions(
      predicate.not as import("../spec/model.ts").RulePredicate,
      conditions,
    );
  else if ("op" in predicate && typeof predicate.op === "string") conditions.add(predicate.op);
}

function collectRequirements(
  steps: readonly RuleStep[],
  capabilities: Set<string>,
  actions: Set<string>,
): void {
  for (const step of steps) {
    if ("action" in step) {
      actions.add(step.action.key);
      if (step.action.runAs && step.action.runAs !== "trigger") capabilities.add("run_as");
      if ((step.action.retry?.max ?? 1) > 1) capabilities.add("retries");
      if (step.action.compensate) {
        capabilities.add("compensation");
        actions.add(step.action.compensate.key);
        if (step.action.compensate.runAs && step.action.compensate.runAs !== "trigger")
          capabilities.add("run_as");
      }
    } else if ("invoke" in step) capabilities.add("nested_rules");
    else if ("gate" in step) {
      collectRequirements(step.gate.pass ?? [], capabilities, actions);
      collectRequirements(step.gate.fail ?? [], capabilities, actions);
    } else if ("foreach" in step || "repeat" in step) {
      capabilities.add("loops");
      collectRequirements(
        "foreach" in step ? step.foreach.steps : step.repeat.steps,
        capabilities,
        actions,
      );
    } else if ("parallel" in step) {
      capabilities.add("parallel");
      for (const branch of step.parallel.branches)
        collectRequirements(branch.steps, capabilities, actions);
    } else if ("delay" in step) capabilities.add("durable_waits");
    else if ("wait" in step) {
      if (step.wait.request) capabilities.add("actor_requests");
      if (step.wait.signal) capabilities.add("signals");
      if (step.wait.timeout !== undefined) capabilities.add("durable_waits");
      collectRequirements(step.wait.onSignal ?? [], capabilities, actions);
      collectRequirements(step.wait.onTimeout ?? [], capabilities, actions);
    }
  }
}
