import type { EditorContext } from "./authoring.js";
import type { RuleDraft } from "./rule-model.js";
import { labelFromKey } from "./editor-data.js";

/** Compact, dependency-free summary for Rule lists and relationship panels. */
export function ruleSummary(rule: RuleDraft, context: EditorContext): string {
  const trigger = rule.trigger;
  const start = trigger
    ? trigger.key === "form.submitted" && typeof trigger.config?.form === "string"
      ? `When ${context.forms.find((form) => form.key === trigger.config?.form)?.label ?? labelFromKey(trigger.config.form)} is submitted`
      : `When ${eventLabel(trigger.key, context)}`
    : manualLabel(rule, context);
  const count = countSteps(rule.steps);
  return count ? `${start} · ${count} ${count === 1 ? "step" : "steps"}` : start;
}

function manualLabel(rule: RuleDraft, context: EditorContext): string {
  const record = Object.values(rule.input ?? {}).find((input) => "record" in input);
  const collection = record
    ? context.collections.find((candidate) => candidate.key === record.record)
    : undefined;
  return collection ? `On ${collection.label}` : "Run manually";
}

function eventLabel(key: string, context: EditorContext): string {
  for (const collection of context.collections) {
    if (key === `${collection.key}.created`) return `a ${collection.label.toLowerCase()} is added`;
    if (key === `${collection.key}.changed`) return `a ${collection.label.toLowerCase()} changes`;
    if (key === `${collection.key}.deleted`)
      return `a ${collection.label.toLowerCase()} is deleted`;
    const prefix = `${collection.key}.`;
    if (key.startsWith(prefix) && key.endsWith(".changed")) {
      const fieldKey = key.slice(prefix.length, -".changed".length);
      const field = collection.fields.find((candidate) => candidate.key === fieldKey);
      return `${collection.label} ${(field?.label ?? labelFromKey(fieldKey)).toLowerCase()} changes`;
    }
  }
  return labelFromKey(key);
}

function countSteps(steps: RuleDraft["steps"]): number {
  return steps.reduce((count, step) => {
    if ("gate" in step)
      return count + 1 + countSteps(step.gate.pass ?? []) + countSteps(step.gate.fail ?? []);
    if ("wait" in step)
      return (
        count + 1 + countSteps(step.wait.on_signal ?? []) + countSteps(step.wait.on_timeout ?? [])
      );
    if ("foreach" in step) return count + 1 + countSteps(step.foreach.steps);
    if ("repeat" in step) return count + 1 + countSteps(step.repeat.steps);
    if ("parallel" in step)
      return (
        count +
        1 +
        step.parallel.branches.reduce((sum, branch) => sum + countSteps(branch.steps), 0)
      );
    return count + 1;
  }, 0);
}
