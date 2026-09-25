import type { RuleOutputContract } from "./model.ts";

/** Returns the first mismatch; extra object properties deliberately remain unrestricted. */
export function ruleOutputMismatch(
  contract: RuleOutputContract,
  value: unknown,
  path = "output",
): string | null {
  const valid =
    contract.type === "null"
      ? value === null
      : contract.type === "array"
        ? Array.isArray(value)
        : contract.type === "object"
          ? value !== null && typeof value === "object" && !Array.isArray(value)
          : contract.type === "text"
            ? typeof value === "string"
            : contract.type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : typeof value === "boolean";
  if (!valid) return `${path} must be ${contract.type}.`;
  if (contract.type === "array" && contract.items)
    for (const [index, item] of (value as unknown[]).entries()) {
      const mismatch = ruleOutputMismatch(contract.items, item, `${path}.${index}`);
      if (mismatch) return mismatch;
    }
  if (contract.type === "object" && contract.fields)
    for (const [key, field] of Object.entries(contract.fields)) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) {
        if (field.required) return `${path}.${key} is required.`;
        continue;
      }
      const mismatch = ruleOutputMismatch(field, item, `${path}.${key}`);
      if (mismatch) return mismatch;
    }
  return null;
}
