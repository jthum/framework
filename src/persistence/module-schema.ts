import { ERROR_CODES, FrameworkError, invalidInput } from "../errors/error.ts";
import type {
  EntityField,
  EntityId,
  EntityRow,
  EntitySchema,
  ModuleCapability,
  ModuleSchema,
} from "./modules.ts";

const pathPattern = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
export function assertPath(path: string): void {
  if (
    !pathPattern.test(path) ||
    path.split(".").some((part) => ["__proto__", "prototype", "constructor"].includes(part))
  )
    throw invalidInput("Entity field paths must be safe, non-empty property paths.");
}

export function validateModuleSchema(
  schema: ModuleSchema,
  capabilities: readonly ModuleCapability[],
): ModuleSchema {
  assertPath(schema.id);
  for (const capability of schema.requires ?? [])
    if (!capabilities.includes(capability))
      throw new FrameworkError({
        code: ERROR_CODES.persistenceUnsupported,
        message: `This persistence provider does not support ${capability}.`,
      });
  if (!Object.keys(schema.entities).length)
    throw invalidInput("Declare at least one module entity.");
  for (const [name, entity] of Object.entries(schema.entities)) {
    assertPath(name);
    for (const [path, field] of Object.entries(entity.fields)) {
      assertPath(path);
      if (
        ["id", "workspaceId"].includes(path.split(".")[0]!) ||
        !["text", "number", "boolean", "id", "json"].includes(field.type)
      )
        throw invalidInput("Invalid or reserved module entity field.");
      if (
        Object.keys(entity.fields).some((other) => other !== path && other.startsWith(`${path}.`))
      )
        throw invalidInput("Entity fields cannot overlap nested paths.");
      if (field.generated && (field.generated !== "sequence" || field.type !== "number"))
        throw invalidInput("Generated sequences must be numeric fields.");
      if (
        field.references &&
        (field.type !== "id" ||
          !schema.entities[field.references.entity] ||
          (field.references.onDelete === "setNull" && !field.optional))
      )
        throw invalidInput(
          "Entity references require a declared entity and a compatible identity field.",
        );
      if (field.values?.some((value) => !validFieldValue(field, value)))
        throw invalidInput("Entity field choices must match the field type.");
    }
    for (const index of entity.indexes ?? []) {
      if (
        !index.fields.length ||
        index.fields.some(
          (field) =>
            !["id", "workspaceId"].includes(field) &&
            (!entity.fields[field] || entity.fields[field].type === "json"),
        )
      )
        throw invalidInput("Entity indexes require declared scalar fields.");
    }
  }
  return structuredClone(schema);
}

/** Property order is not schema identity; index/field ordering within arrays still is. */
export function moduleSchemaSignature(schema: ModuleSchema): string {
  const sort = (input: unknown): unknown =>
    Array.isArray(input)
      ? input.map(sort)
      : input && typeof input === "object"
        ? Object.fromEntries(
            Object.entries(input)
              .sort(([left], [right]) => left.localeCompare(right))
              .map(([key, value]) => [key, sort(value)]),
          )
        : input;
  return JSON.stringify(
    sort({ ...schema, ...(schema.requires ? { requires: [...schema.requires].sort() } : {}) }),
  );
}

export function entitySchema(schema: ModuleSchema, name: string): EntitySchema {
  const entity = schema.entities[name];
  if (!entity) throw invalidInput("This module does not declare that entity.");
  return entity;
}

export function assertEntityId(value: unknown): asserts value is EntityId {
  if (
    !(
      (typeof value === "string" && value.length > 0) ||
      (typeof value === "number" && Number.isSafeInteger(value))
    )
  )
    throw invalidInput("Entity identities must be non-empty strings or safe integers.");
}

export function valueAt(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setAt(value: Record<string, unknown>, path: string, input: unknown): void {
  const parts = path.split(".");
  let current = value;
  for (const part of parts.slice(0, -1)) {
    const child = current[part];
    if (!child || typeof child !== "object" || Array.isArray(child)) current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  if (input === undefined) delete current[parts.at(-1)!];
  else current[parts.at(-1)!] = input;
}

export function validJson(value: unknown): boolean {
  const visiting = new Set<object>();
  const inspect = (input: unknown): boolean => {
    if (input === null || typeof input === "string" || typeof input === "boolean") return true;
    if (typeof input === "number") return Number.isFinite(input);
    if (
      !input ||
      typeof input !== "object" ||
      visiting.has(input) ||
      (!Array.isArray(input) && Object.getPrototypeOf(input) !== Object.prototype)
    )
      return false;
    visiting.add(input);
    const valid = Object.values(input).every(inspect);
    visiting.delete(input);
    return valid;
  };
  return inspect(value);
}

export function validFieldValue(field: EntityField, value: unknown): boolean {
  if (field.type === "json") return validJson(value);
  if (field.type === "id")
    return (
      (typeof value === "string" && !!value.length) ||
      (typeof value === "number" && Number.isSafeInteger(value))
    );
  if (field.type === "text") return typeof value === "string";
  if (field.type === "boolean") return typeof value === "boolean";
  return typeof value === "number" && Number.isFinite(value);
}

function assertKeys(entity: EntitySchema, value: object, prefix = ""): void {
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!prefix && ["id", "workspaceId"].includes(key)) continue;
    if (entity.fields[path]) continue;
    if (!Object.keys(entity.fields).some((field) => field.startsWith(`${path}.`)))
      throw invalidInput(`Unknown entity field: ${path}.`);
    if (child != null) {
      if (typeof child !== "object" || Array.isArray(child))
        throw invalidInput(`Expected a nested object at ${path}.`);
      assertKeys(entity, child, path);
    }
  }
}

export function normalizeEntity(
  entity: EntitySchema,
  workspaceId: string,
  input: object,
  id: EntityId,
  sequence: number,
): EntityRow {
  assertEntityId(id);
  assertKeys(entity, input);
  const requestedWorkspace = valueAt(input, "workspaceId");
  if (requestedWorkspace !== undefined && requestedWorkspace !== workspaceId)
    throw invalidInput("Entity data cannot cross the bound Workspace.");
  const result: Record<string, unknown> = { id, workspaceId };
  for (const [path, field] of Object.entries(entity.fields)) {
    const value = field.generated ? sequence : valueAt(input, path);
    if (value === undefined || (value === null && field.type !== "json")) {
      if (!field.optional) throw invalidInput(`Missing entity field: ${path}.`);
      continue;
    }
    if (
      !validFieldValue(field, value) ||
      (field.values && !field.values.includes(value as string | number | boolean))
    )
      throw invalidInput(`Invalid entity field: ${path}.`);
    setAt(result, path, structuredClone(value));
  }
  return result;
}

export function patchEntity(entity: EntitySchema, existing: EntityRow, patch: object): EntityRow {
  assertKeys(entity, patch);
  if (Object.hasOwn(patch, "id") || Object.hasOwn(patch, "workspaceId"))
    throw invalidInput("An entity's identity and Workspace are immutable.");
  const result = structuredClone(existing) as Record<string, unknown>;
  for (const [path, field] of Object.entries(entity.fields)) {
    const parts = path.split(".");
    let touched = false;
    let current: unknown = patch;
    for (const part of parts) {
      if (current == null) {
        touched = true;
        break;
      }
      if (typeof current !== "object" || !Object.hasOwn(current, part)) {
        touched = false;
        break;
      }
      touched = true;
      current = (current as Record<string, unknown>)[part];
    }
    if (!touched) continue;
    if (field.generated) throw invalidInput("Provider-generated sequences are immutable.");
    setAt(result, path, valueAt(patch, path));
  }
  const sequenceField = Object.entries(entity.fields).find(([, field]) => field.generated)?.[0];
  return normalizeEntity(
    entity,
    existing.workspaceId as string,
    result,
    existing.id as EntityId,
    sequenceField ? Number(valueAt(existing, sequenceField)) : 0,
  );
}

export function compareEntityValues(left: unknown, right: unknown): number {
  const a = left ?? null,
    b = right ?? null;
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a !== typeof b) return typeof a === "string" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return a < b ? -1 : 1;
  if (typeof a === "boolean" && typeof b === "boolean") return a ? 1 : -1;
  if (typeof a === "string" && typeof b === "string") {
    const leftPoints = Array.from(a),
      rightPoints = Array.from(b);
    for (let index = 0; index < Math.min(leftPoints.length, rightPoints.length); index++) {
      const difference = leftPoints[index]!.codePointAt(0)! - rightPoints[index]!.codePointAt(0)!;
      if (difference) return difference < 0 ? -1 : 1;
    }
    return leftPoints.length < rightPoints.length ? -1 : 1;
  }
  throw invalidInput("Query comparison requires scalar values.");
}
