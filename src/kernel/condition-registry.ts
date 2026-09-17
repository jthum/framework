import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import type { JsonValue } from "../spec/model.ts";

export interface ConditionExecution {
  readonly input: Readonly<Record<string, JsonValue>>;
  readonly read: (path: string) => JsonValue | undefined;
}

export interface ConditionDefinition {
  /** Immutable semantic predicate key, for example `context.equals`. */
  readonly key: string;
  readonly test: (execution: ConditionExecution) => boolean | Promise<boolean>;
}

export class ConditionRegistry {
  private readonly definitions = new Map<string, ConditionDefinition>();

  constructor(definitions: readonly ConditionDefinition[] = []) {
    for (const definition of definitions) this.register(definition);
  }

  register(definition: ConditionDefinition): void {
    const key = definition.key.trim();
    if (!key) throw resourceConflict("Condition key is required.");
    if (this.definitions.has(key))
      throw resourceConflict(`Condition ${key} is already registered.`);
    this.definitions.set(key, { ...definition, key });
  }

  has(key: string): boolean {
    return this.definitions.has(key);
  }

  keys(): ReadonlySet<string> {
    return new Set(this.definitions.keys());
  }

  async test(key: string, execution: ConditionExecution): Promise<boolean> {
    const definition = this.definitions.get(key);
    if (!definition)
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: `The ${key} Condition is not installed in this runtime.`,
        details: { condition: key },
      });
    return definition.test(execution);
  }
}

export function coreConditions(): readonly ConditionDefinition[] {
  return [
    { key: "always", test: () => true },
    {
      key: "context.equals",
      test: ({ input, read }) => same(readPath(input, read), input.value),
    },
    {
      key: "context.not_equals",
      test: ({ input, read }) => !same(readPath(input, read), input.value),
    },
    {
      key: "context.filled",
      test: ({ input, read }) => !empty(readPath(input, read)),
    },
    {
      key: "context.empty",
      test: ({ input, read }) => empty(readPath(input, read)),
    },
    {
      key: "context.contains",
      test: ({ input, read }) => contains(readPath(input, read), input.value),
    },
    {
      key: "context.in",
      test: ({ input, read }) =>
        Array.isArray(input.values) &&
        input.values.some((value) => same(readPath(input, read), value)),
    },
    {
      key: "context.compare",
      test: ({ input, read }) => compare(readPath(input, read), input.value, input.operator),
    },
  ];
}

function readPath(
  input: Readonly<Record<string, JsonValue>>,
  read: (path: string) => JsonValue | undefined,
): JsonValue | undefined {
  return typeof input.path === "string" ? read(input.path) : undefined;
}

function same(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function empty(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function contains(value: JsonValue | undefined, expected: JsonValue | undefined): boolean {
  if (typeof value === "string" && typeof expected === "string") return value.includes(expected);
  if (Array.isArray(value)) return value.some((candidate) => same(candidate, expected));
  return false;
}

function compare(
  left: JsonValue | undefined,
  right: JsonValue | undefined,
  operator: JsonValue | undefined,
): boolean {
  if ((typeof left !== "number" && typeof left !== "string") || typeof left !== typeof right)
    return false;
  const comparison =
    typeof left === "number" && typeof right === "number"
      ? left === right
        ? 0
        : left > right
          ? 1
          : -1
      : typeof left === "string" && typeof right === "string"
        ? left.localeCompare(right)
        : Number.NaN;
  switch (operator) {
    case "gt":
      return comparison > 0;
    case "gte":
      return comparison >= 0;
    case "lt":
      return comparison < 0;
    case "lte":
      return comparison <= 0;
    default:
      return false;
  }
}
