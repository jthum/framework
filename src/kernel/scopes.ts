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
