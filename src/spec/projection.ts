import type { JsonValue, SourceSelection } from "./model.ts";

/** Stable column identifier; nested output paths use dotted identifiers. */
export function projectionKey(output: SourceSelection["as"]): string {
  return typeof output === "string" ? output : output.join(".");
}

/** Read one explicitly projected value without loading or resolving another record. */
export function readProjection(
  values: Readonly<Record<string, JsonValue>>,
  output: SourceSelection["as"],
): JsonValue | undefined {
  const path = typeof output === "string" ? [output] : output;
  let value: JsonValue | undefined = values;
  for (const key of path) {
    if (!value || typeof value !== "object" || Array.isArray(value) || !Object.hasOwn(value, key))
      return undefined;
    value = value[key];
  }
  return value;
}

/** Assemble validated selections into plain JSON results; absent leaves stay absent. */
export function projectValues(
  selections: readonly SourceSelection[],
  valueAt: (path: readonly string[]) => JsonValue | undefined,
): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const selection of selections) {
    const value = valueAt(selection.path);
    if (value === undefined) continue;
    const path = typeof selection.as === "string" ? [selection.as] : selection.as;
    let target = values;
    for (const key of path.slice(0, -1)) {
      if (!Object.hasOwn(target, key))
        Object.defineProperty(target, key, {
          value: {},
          enumerable: true,
          configurable: true,
          writable: true,
        });
      const child = target[key];
      if (!child || typeof child !== "object" || Array.isArray(child))
        throw new TypeError("Projection outputs overlap an object and its fields.");
      target = child;
    }
    Object.defineProperty(target, path.at(-1)!, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return values;
}
