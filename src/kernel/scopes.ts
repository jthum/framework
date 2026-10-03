import type { Spec } from "../spec/model.ts";
import { ERROR_CODES, FrameworkError } from "../errors/error.ts";
import type { ScopeConfig, ScopeHandle } from "./model.ts";

export const EMPTY_SCOPE_CONFIG: ScopeConfig = Object.freeze({
  collections: [],
  views: [],
  forms: [],
  pages: [],
  rules: [],
});

export function assertScope(scope: ScopeHandle): void {
  if (
    !scope ||
    typeof scope.kind !== "string" ||
    !scope.kind.trim() ||
    typeof scope.id !== "string" ||
    !scope.id.trim()
  )
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "Scope kind and id must be non-empty strings.",
    });
}

export function emptyScopeConfig(): ScopeConfig {
  return structuredClone(EMPTY_SCOPE_CONFIG);
}

export function readScopeConfig(value: unknown): ScopeConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidConfig();
  const item = value as Record<string, unknown>;
  for (const key of ["collections", "views", "forms", "pages", "rules"])
    if (!Array.isArray(item[key])) throw invalidConfig();
  return structuredClone(value) as ScopeConfig;
}

function invalidConfig(): FrameworkError {
  return new FrameworkError({
    code: ERROR_CODES.validationInvalidInput,
    message: "Scope configuration must contain collections, views, forms, pages, and rules arrays.",
  });
}

export function mergeScopeConfig(spec: Spec, config: ScopeConfig): Spec {
  return {
    ...spec,
    collections: [...spec.collections, ...config.collections],
    views: [...spec.views, ...config.views],
    forms: [...spec.forms, ...config.forms],
    pages: [...spec.pages, ...config.pages],
    rules: [...spec.rules, ...config.rules],
  };
}

export function assertDistinctScopeIds(left: ScopeConfig, right: ScopeConfig): void {
  const definitions = (config: ScopeConfig) => [
    ...config.collections,
    ...config.views,
    ...config.forms,
    ...config.pages,
    ...config.rules,
    ...config.collections.flatMap((collection) => collection.fields),
  ];
  const ids = new Set(definitions(right).map((item) => item.id));
  if (definitions(left).some((item) => ids.has(item.id)))
    throw new FrameworkError({
      code: ERROR_CODES.validationInvalidInput,
      message: "Scope definitions must not reuse identities owned by another scope.",
    });
}
