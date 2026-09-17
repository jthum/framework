import type { EditorContext, RuleStep } from "./authoring.js";
import type { AutomationPredicate, AutomationCondition } from "./rule-model.js";
import { labelFromKey } from "./editor-data.js";
const scalarString = (value: unknown) =>
  value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
export function humanCondition(condition: AutomationPredicate): string {
  const raw = condition as Record<string, unknown>;
  if (Array.isArray(raw.all))
    return raw.all.map((item) => humanCondition(item as AutomationPredicate)).join(" and ");
  if (Array.isArray(raw.any))
    return raw.any.map((item) => humanCondition(item as AutomationPredicate)).join(" or ");
  if (raw.not && typeof raw.not === "object")
    return `not ${humanCondition(raw.not as AutomationPredicate)}`;
  const leaf = condition as AutomationCondition;
  const op = leaf.op === "context.not_equals" ? "is not" : "is";
  const path = typeof leaf.path === "string" ? leaf.path : "value";
  const value =
    typeof leaf.value === "string" ||
    typeof leaf.value === "number" ||
    typeof leaf.value === "boolean"
      ? String(leaf.value)
      : "value";
  return `${leafLabel(path)} ${op} ${labelFromKey(value)}`;
}

export function humanStep(step: RuleStep, spec?: EditorContext): string {
  if ("effect" in step && step.effect.key === "records.set") {
    const values = step.effect.params?.values;
    const input = step.effect.params?.record;
    const typeKey = isBinding(input) ? (input.$ref.split(".").at(-1) ?? "record") : "record";
    return Object.entries(isObject(values) ? values : {})
      .map(([fieldKey, value]) => {
        const field = fieldLabel(spec, typeKey, fieldKey);
        const display =
          isBinding(value) && value.$ref === "meta.now"
            ? "today"
            : labelFromKey(scalarString(value));
        return `Set ${field.toLowerCase()} to ${display}`;
      })
      .join(", ");
  }
  if ("effect" in step && step.effect.key === "records.create")
    return `Create ${typeLabel(spec, typeof step.effect.params?.type === "string" ? step.effect.params.type : "record").toLowerCase()}`;
  if ("effect" in step && step.effect.key === "records.delete") return "Delete record";
  if ("invoke" in step) return `Run ${labelFromKey(step.invoke.workflow)}`;
  if ("effect" in step && step.effect.key === "records.query")
    return `Look up ${labelFromKey(step.effect.as ?? "records")}`;
  if ("gate" in step) return `If ${humanCondition(step.gate.predicate)}`;
  if ("compute" in step) return "Calculate values";
  if ("foreach" in step) return "For each item";
  if ("repeat" in step) return "Repeat steps";
  if ("parallel" in step) return "Run branches together";
  if ("delay" in step) return "Wait for a duration";
  if ("wait" in step)
    return step.wait.request ? `Ask a user: ${step.wait.request.label}` : "Wait for a signal";
  return "Do something";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isBinding(value: unknown): value is { $ref: string } {
  return isObject(value) && typeof value.$ref === "string";
}

function typeLabel(spec: EditorContext | undefined, key: string): string {
  return spec?.collections.find((type) => type.key === key)?.label ?? labelFromKey(key);
}

function fieldLabel(spec: EditorContext | undefined, typeKey: string, fieldKey: string): string {
  const field = spec?.collections
    .find((type) => type.key === typeKey)
    ?.fields.find((item) => item.key === fieldKey);
  return field?.label ?? labelFromKey(fieldKey);
}

function leafLabel(path: string): string {
  return labelFromKey(path.split(".").at(-1) ?? path);
}
