import type { JsonValue } from "./model.ts";

/** Compare portable JSON structurally: object property order is not definition identity. */
export function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([left], [right]) => left.localeCompare(right)),
        )
      : item,
  );
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** Bounded, cycle-safe validation. Optional object properties may be omitted with undefined. */
export function isJsonValue(value: unknown, optionalProperties = false): value is JsonValue {
  const ancestors = new Set<object>();
  let remaining = 100000;
  const visit = (item: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > 64) return false;
    if (item === null || typeof item === "boolean" || typeof item === "string") return true;
    if (typeof item === "number") return Number.isFinite(item);
    if (!Array.isArray(item) && !isPlainObject(item)) return false;
    if (ancestors.has(item)) return false;
    ancestors.add(item);
    const valid = Array.isArray(item)
      ? item.every((child) => visit(child, depth + 1))
      : Object.values(Object.getOwnPropertyDescriptors(item)).every(
          (property) =>
            "value" in property &&
            ((optionalProperties && property.value === undefined) ||
              visit(property.value, depth + 1)),
        );
    ancestors.delete(item);
    return valid;
  };
  return visit(value, 0);
}

/** Assignment must remain safe even after a JSON/structured-clone round trip. */
export function setOwnValue<T>(object: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(object, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}
