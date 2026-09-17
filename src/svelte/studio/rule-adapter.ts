import { nanoid } from "nanoid";
import type {
  RuleAction,
  RuleActionCall,
  RuleDefinition,
  RuleStep as CanonicalStep,
  RuleTriggerDefinition,
  Spec,
} from "@jthum/framework/spec";
import type {
  AutomationEffect,
  AutomationEffectCall,
  AutomationInput,
  AutomationPredicate,
  AutomationTrigger,
  AutomationValue,
  RuleDraft,
  RuleStep,
} from "./rule-model.js";

export class RuleAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleAuthoringError";
  }
}

/** Translate a portable Rule into Studio's key-oriented working model. */
export function ruleDraftFromDefinition(rule: RuleDefinition, spec: Spec): RuleDraft {
  return {
    id: rule.id,
    key: rule.key,
    label: rule.label,
    ...(rule.description ? { description: rule.description } : {}),
    ...(rule.meta ? { meta: structuredClone(rule.meta) } : {}),
    ...(rule.enabled !== undefined ? { enabled: rule.enabled } : {}),
    ...(rule.priority !== undefined ? { priority: rule.priority } : {}),
    ...(rule.input
      ? {
          input: Object.fromEntries(
            Object.entries(rule.input).map(([key, input]) => [
              key,
              "sourceId" in input
                ? {
                    record: sourceKey(spec, input.sourceId),
                    ...(input.required !== undefined ? { required: input.required } : {}),
                  }
                : draftClone<AutomationInput>(input),
            ]),
          ),
        }
      : {}),
    ...(rule.trigger ? { trigger: draftTrigger(rule.trigger, spec) } : {}),
    ...(rule.expose ? { expose: [...rule.expose] } : {}),
    steps: rule.steps.map((step) => draftStep(step, spec)),
  };
}

/** Translate Studio's working model to the canonical, identity-based Rule contract. */
export function ruleDefinitionFromDraft(draft: RuleDraft, spec: Spec): RuleDefinition {
  return {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.meta ? { meta: structuredClone(draft.meta) } : {}),
    ...(draft.enabled !== undefined ? { enabled: draft.enabled } : {}),
    ...(draft.priority !== undefined ? { priority: draft.priority } : {}),
    ...(draft.input
      ? {
          input: Object.fromEntries(
            Object.entries(draft.input).map(([key, input]) => [
              key,
              "record" in input
                ? {
                    sourceId: sourceId(spec, input.record),
                    ...(input.required !== undefined ? { required: input.required } : {}),
                  }
                : structuredClone(input),
            ]),
          ),
        }
      : {}),
    ...(draft.trigger ? { trigger: canonicalTrigger(draft.trigger, spec) } : {}),
    ...(draft.expose ? { expose: [...draft.expose] } : {}),
    steps: draft.steps.map((step) => canonicalStep(step, spec)),
  };
}

function draftStep(step: CanonicalStep, spec: Spec): RuleStep {
  const id = step.id;
  if ("action" in step) return { id, effect: draftAction(step.action) };
  if ("invoke" in step)
    return {
      id,
      invoke: {
        workflow: ruleKey(spec, step.invoke.ruleId),
        ...(step.invoke.input
          ? { input: draftClone<Record<string, AutomationValue>>(step.invoke.input) }
          : {}),
        ...(step.invoke.as ? { as: step.invoke.as } : {}),
      },
    };
  if ("gate" in step)
    return {
      id,
      gate: {
        predicate: draftClone<AutomationPredicate>(step.gate.predicate),
        ...(step.gate.pass ? { pass: step.gate.pass.map((item) => draftStep(item, spec)) } : {}),
        ...(step.gate.fail ? { fail: step.gate.fail.map((item) => draftStep(item, spec)) } : {}),
      },
    };
  if ("compute" in step)
    return {
      id,
      compute: { assign: draftClone<Record<string, AutomationValue>>(step.compute.assign) },
    };
  if ("delay" in step) return { id, delay: structuredClone(step.delay) };
  if ("wait" in step)
    return {
      id,
      wait: {
        ...(step.wait.signal ? { signal: step.wait.signal } : {}),
        ...(step.wait.request ? { request: structuredClone(step.wait.request) } : {}),
        ...(step.wait.timeout !== undefined ? { timeout: step.wait.timeout } : {}),
        ...(step.wait.as ? { as: step.wait.as } : {}),
        ...(step.wait.onSignal
          ? { on_signal: step.wait.onSignal.map((item) => draftStep(item, spec)) }
          : {}),
        ...(step.wait.onTimeout
          ? { on_timeout: step.wait.onTimeout.map((item) => draftStep(item, spec)) }
          : {}),
      },
    };
  if ("foreach" in step)
    return {
      id,
      foreach: {
        source: structuredClone(step.foreach.source),
        ...(step.foreach.as ? { as: step.foreach.as } : {}),
        ...(step.foreach.max !== undefined ? { max: step.foreach.max } : {}),
        ...(step.foreach.onItemFailure ? { on_item_failure: step.foreach.onItemFailure } : {}),
        steps: step.foreach.steps.map((item) => draftStep(item, spec)),
      },
    };
  if ("repeat" in step)
    return {
      id,
      repeat: {
        times: structuredClone(step.repeat.times),
        ...(step.repeat.as ? { as: step.repeat.as } : {}),
        ...(step.repeat.max !== undefined ? { max: step.repeat.max } : {}),
        ...(step.repeat.onItemFailure ? { on_item_failure: step.repeat.onItemFailure } : {}),
        steps: step.repeat.steps.map((item) => draftStep(item, spec)),
      },
    };
  return {
    id,
    parallel: {
      ...(step.parallel.join ? { join: step.parallel.join } : {}),
      branches: step.parallel.branches.map((branch) => ({
        id: branch.id,
        ...(branch.key ? { key: branch.key } : {}),
        steps: branch.steps.map((item) => draftStep(item, spec)),
      })),
    },
  };
}

function canonicalStep(step: RuleStep, spec: Spec): CanonicalStep {
  const id = step.id || nanoid();
  if ("effect" in step) return { id, action: canonicalAction(step.effect) };
  if ("invoke" in step)
    return {
      id,
      invoke: {
        ruleId: ruleId(spec, step.invoke.workflow),
        ...(step.invoke.input ? { input: structuredClone(step.invoke.input) } : {}),
        ...(step.invoke.as ? { as: step.invoke.as } : {}),
      },
    };
  if ("gate" in step)
    return {
      id,
      gate: {
        predicate: structuredClone(step.gate.predicate),
        ...(step.gate.pass
          ? { pass: step.gate.pass.map((item) => canonicalStep(item, spec)) }
          : {}),
        ...(step.gate.fail
          ? { fail: step.gate.fail.map((item) => canonicalStep(item, spec)) }
          : {}),
      },
    };
  if ("compute" in step) return { id, compute: structuredClone(step.compute) };
  if ("delay" in step) return { id, delay: structuredClone(step.delay) };
  if ("wait" in step)
    return {
      id,
      wait: {
        ...(step.wait.signal ? { signal: step.wait.signal } : {}),
        ...(step.wait.request ? { request: structuredClone(step.wait.request) } : {}),
        ...(step.wait.timeout !== undefined ? { timeout: step.wait.timeout } : {}),
        ...(step.wait.as ? { as: step.wait.as } : {}),
        ...(step.wait.on_signal
          ? { onSignal: step.wait.on_signal.map((item) => canonicalStep(item, spec)) }
          : {}),
        ...(step.wait.on_timeout
          ? { onTimeout: step.wait.on_timeout.map((item) => canonicalStep(item, spec)) }
          : {}),
      },
    };
  if ("foreach" in step)
    return {
      id,
      foreach: {
        source: structuredClone(step.foreach.source),
        ...(step.foreach.as ? { as: step.foreach.as } : {}),
        ...(step.foreach.max !== undefined ? { max: step.foreach.max } : {}),
        ...(step.foreach.on_item_failure ? { onItemFailure: step.foreach.on_item_failure } : {}),
        steps: step.foreach.steps.map((item) => canonicalStep(item, spec)),
      },
    };
  if ("repeat" in step)
    return {
      id,
      repeat: {
        times: structuredClone(step.repeat.times),
        ...(step.repeat.as ? { as: step.repeat.as } : {}),
        ...(step.repeat.max !== undefined ? { max: step.repeat.max } : {}),
        ...(step.repeat.on_item_failure ? { onItemFailure: step.repeat.on_item_failure } : {}),
        steps: step.repeat.steps.map((item) => canonicalStep(item, spec)),
      },
    };
  return {
    id,
    parallel: {
      ...(step.parallel.join ? { join: step.parallel.join } : {}),
      branches: step.parallel.branches.map((branch) => ({
        id: branch.id || nanoid(),
        ...(branch.key ? { key: branch.key } : {}),
        steps: branch.steps.map((item) => canonicalStep(item, spec)),
      })),
    },
  };
}

function draftAction(action: RuleAction): AutomationEffect {
  return {
    key: action.key,
    ...(action.input ? { params: draftClone<Record<string, AutomationValue>>(action.input) } : {}),
    ...(action.runAs ? { runAs: action.runAs } : {}),
    ...(action.as ? { as: action.as } : {}),
    ...(action.retry
      ? {
          retry: {
            max: action.retry.max,
            ...(action.retry.backoff ? { backoff: [...action.retry.backoff] } : {}),
          },
        }
      : {}),
    ...(action.compensate ? { compensate: draftActionCall(action.compensate) } : {}),
  };
}

function canonicalAction(effect: AutomationEffect): RuleAction {
  return {
    key: effect.key,
    ...(effect.params ? { input: structuredClone(effect.params) } : {}),
    ...(effect.runAs ? { runAs: effect.runAs } : {}),
    ...(effect.as ? { as: effect.as } : {}),
    ...(effect.retry ? { retry: structuredClone(effect.retry) } : {}),
    ...(effect.compensate ? { compensate: canonicalActionCall(effect.compensate) } : {}),
  };
}

function draftActionCall(action: RuleActionCall): AutomationEffectCall {
  return {
    key: action.key,
    ...(action.input ? { params: draftClone<Record<string, AutomationValue>>(action.input) } : {}),
    ...(action.runAs ? { runAs: action.runAs } : {}),
  };
}

function canonicalActionCall(effect: AutomationEffectCall): RuleActionCall {
  return {
    key: effect.key,
    ...(effect.params ? { input: structuredClone(effect.params) } : {}),
    ...(effect.runAs ? { runAs: effect.runAs } : {}),
  };
}

function draftTrigger(trigger: RuleTriggerDefinition, spec: Spec): AutomationTrigger {
  if (trigger.event === "form.submitted" && trigger.formId)
    return {
      key: trigger.event,
      config: {
        ...(trigger.config ? draftClone<Record<string, AutomationValue>>(trigger.config) : {}),
        form: formKey(spec, trigger.formId),
      },
    };
  if (trigger.event.startsWith("record.") && trigger.sourceId) {
    const source = sourceDefinition(spec, trigger.sourceId);
    if (trigger.event === "record.field_changed" && trigger.fieldId) {
      const collection = spec.collections.find((item) => item.id === source.id);
      const field = collection?.fields.find((item) => item.id === trigger.fieldId);
      if (!field) throw new RuleAuthoringError(`Trigger Field ${trigger.fieldId} is unavailable.`);
      return {
        key: `${source.key}.${field.key}.changed`,
        ...(trigger.config
          ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
          : {}),
      };
    }
    const suffix = trigger.event.slice("record.".length).replace("updated", "changed");
    return {
      key: `${source.key}.${suffix}`,
      ...(trigger.config
        ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
        : {}),
    };
  }
  return {
    key: trigger.event,
    ...(trigger.config
      ? { config: draftClone<Record<string, AutomationValue>>(trigger.config) }
      : {}),
  };
}

function canonicalTrigger(trigger: AutomationTrigger, spec: Spec): RuleTriggerDefinition {
  if (trigger.key === "form.submitted" && typeof trigger.config?.form === "string") {
    const { form: _form, ...config } = trigger.config;
    return {
      event: trigger.key,
      formId: formId(spec, trigger.config.form),
      ...(Object.keys(config).length ? { config } : {}),
    };
  }
  for (const collection of spec.collections) {
    if (trigger.key === `${collection.key}.created`)
      return {
        event: "record.created",
        sourceId: collection.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    if (trigger.key === `${collection.key}.changed`)
      return {
        event: "record.updated",
        sourceId: collection.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    if (trigger.key === `${collection.key}.deleted`)
      return {
        event: "record.deleted",
        sourceId: collection.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    const prefix = `${collection.key}.`,
      suffix = ".changed";
    if (trigger.key.startsWith(prefix) && trigger.key.endsWith(suffix)) {
      const key = trigger.key.slice(prefix.length, -suffix.length);
      const field = collection.fields.find((item) => item.key === key);
      if (!field) throw new RuleAuthoringError(`Trigger Field ${key} is unavailable.`);
      return {
        event: "record.field_changed",
        sourceId: collection.id,
        fieldId: field.id,
        ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
      };
    }
  }
  return {
    event: trigger.key,
    ...(trigger.config ? { config: structuredClone(trigger.config) } : {}),
  };
}

function sourceDefinition(spec: Spec, id: string) {
  const source = [...spec.collections, ...spec.sources].find((item) => item.id === id);
  if (!source) throw new RuleAuthoringError(`Source ${id} is unavailable.`);
  return source;
}
function sourceKey(spec: Spec, id: string): string {
  return sourceDefinition(spec, id).key;
}
function sourceId(spec: Spec, key: string): string {
  const source = [...spec.collections, ...spec.sources].find((item) => item.key === key);
  if (!source) throw new RuleAuthoringError(`Source ${key} is unavailable.`);
  return source.id;
}
function ruleKey(spec: Spec, id: string): string {
  const rule = spec.rules.find((item) => item.id === id);
  if (!rule) throw new RuleAuthoringError(`Rule ${id} is unavailable.`);
  return rule.key;
}
function ruleId(spec: Spec, key: string): string {
  const rule = spec.rules.find((item) => item.key === key);
  if (!rule) throw new RuleAuthoringError(`Rule ${key} is unavailable.`);
  return rule.id;
}
function formKey(spec: Spec, id: string): string {
  const form = spec.forms.find((item) => item.id === id);
  if (!form) throw new RuleAuthoringError(`Form ${id} is unavailable.`);
  return form.key;
}
function formId(spec: Spec, key: string): string {
  const form = spec.forms.find((item) => item.key === key);
  if (!form) throw new RuleAuthoringError(`Form ${key} is unavailable.`);
  return form.id;
}

function draftClone<T>(value: unknown): T {
  return structuredClone(value) as T;
}
