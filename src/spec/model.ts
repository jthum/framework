export const SPEC_VERSION = 2 as const;

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type SpecMeta = Record<string, JsonValue>;

export interface DefinitionIdentity {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly meta?: SpecMeta;
}

/** Detailed collection and field semantics land in the Collections phase. */
export interface CollectionDefinition extends DefinitionIdentity {}

/** A semantic Source binding is portable; its concrete resolution is instance data. */
export interface SourceBindingDefinition extends DefinitionIdentity {}

export interface ViewDefinition extends DefinitionIdentity {}
export interface FormDefinition extends DefinitionIdentity {}
export interface PageDefinition extends DefinitionIdentity {}
export interface RuleDefinition extends DefinitionIdentity {}

export interface Spec extends DefinitionIdentity {
  readonly version: typeof SPEC_VERSION;
  readonly collections: readonly CollectionDefinition[];
  readonly sources: readonly SourceBindingDefinition[];
  readonly views: readonly ViewDefinition[];
  readonly forms: readonly FormDefinition[];
  readonly pages: readonly PageDefinition[];
  readonly rules: readonly RuleDefinition[];
}

export interface EmptySpecInput extends DefinitionIdentity {}

export function createEmptySpec(input: EmptySpecInput): Spec {
  return {
    version: SPEC_VERSION,
    id: input.id,
    key: input.key,
    label: input.label,
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.meta === undefined ? {} : { meta: input.meta }),
    collections: [],
    sources: [],
    views: [],
    forms: [],
    pages: [],
    rules: [],
  };
}
