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

export type FieldKind =
  | "text"
  | "number"
  | "boolean"
  | "date"
  | "datetime"
  | "choice"
  | "reference"
  | "json";

export interface FieldDefinitionBase extends DefinitionIdentity {
  readonly type: FieldKind;
  readonly required?: boolean;
  readonly default?: JsonValue;
  readonly behavior?: FieldBehavior;
}

export interface TextFieldDefinition extends FieldDefinitionBase {
  readonly type: "text";
  readonly format?: "plain" | "email" | "url" | "phone";
  readonly validation?: {
    readonly minLength?: number;
    readonly maxLength?: number;
    readonly pattern?: string;
    readonly message?: string;
  };
}

export interface NumberFieldDefinition extends FieldDefinitionBase {
  readonly type: "number";
  readonly format?: "number" | "currency" | "percentage";
  readonly currency?: string;
  readonly validation?: {
    readonly min?: number;
    readonly max?: number;
    readonly integer?: boolean;
    readonly message?: string;
  };
}

export interface BooleanFieldDefinition extends FieldDefinitionBase {
  readonly type: "boolean";
}

export interface DateFieldDefinition extends FieldDefinitionBase {
  readonly type: "date";
  readonly validation?: {
    readonly min?: string;
    readonly max?: string;
    readonly message?: string;
  };
}

export interface DateTimeFieldDefinition extends FieldDefinitionBase {
  readonly type: "datetime";
  readonly validation?: {
    readonly min?: string;
    readonly max?: string;
    readonly message?: string;
  };
}

export interface ChoiceOptionDefinition extends DefinitionIdentity {}

export interface ChoiceFieldDefinition extends FieldDefinitionBase {
  readonly type: "choice";
  readonly options: readonly ChoiceOptionDefinition[];
  readonly multiple?: boolean;
}

export interface ReferenceFieldDefinition extends FieldDefinitionBase {
  readonly type: "reference";
  readonly collectionId: string;
  readonly multiple?: boolean;
}

export interface JsonFieldDefinition extends FieldDefinitionBase {
  readonly type: "json";
}

export type FieldDefinition =
  | TextFieldDefinition
  | NumberFieldDefinition
  | BooleanFieldDefinition
  | DateFieldDefinition
  | DateTimeFieldDefinition
  | ChoiceFieldDefinition
  | ReferenceFieldDefinition
  | JsonFieldDefinition;

export type FieldOperator =
  | "eq"
  | "neq"
  | "contains"
  | "empty"
  | "notEmpty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export type FieldCondition =
  | { readonly all: readonly FieldCondition[] }
  | { readonly any: readonly FieldCondition[] }
  | { readonly not: FieldCondition }
  | {
      readonly fieldId: string;
      readonly operator: FieldOperator;
      readonly value?: JsonValue;
    };

export interface FieldBehavior {
  readonly visibleWhen?: FieldCondition;
  readonly enabledWhen?: FieldCondition;
  readonly requiredWhen?: FieldCondition;
  readonly hiddenValue?: "preserve" | "clear";
}

export interface CollectionTransitionDefinition extends DefinitionIdentity {
  readonly from: readonly string[];
  readonly to: string;
}

export interface CollectionLifecycleDefinition {
  readonly fieldId: string;
  readonly initial: string;
  readonly terminal?: readonly string[];
  readonly transitions: readonly CollectionTransitionDefinition[];
}

export interface CollectionDefinition extends DefinitionIdentity {
  readonly fields: readonly FieldDefinition[];
  readonly titleFieldId?: string;
  readonly lifecycle?: CollectionLifecycleDefinition;
}

/** A semantic Source binding is portable; its concrete resolution is instance data. */
export interface SourceBindingDefinition extends DefinitionIdentity {}

export type SourceFilter =
  | { readonly all: readonly SourceFilter[] }
  | { readonly any: readonly SourceFilter[] }
  | { readonly not: SourceFilter }
  | {
      /** Stable Field IDs from the root through declared reference Fields. */
      readonly path: readonly string[];
      readonly operator: FieldOperator;
      readonly value?: JsonValue;
    };

export interface SourceSort {
  readonly path: readonly string[];
  readonly direction: "asc" | "desc";
}

export interface SourceSelection {
  readonly path: readonly string[];
  /** Required output key; keeps the result stable when Field keys change. */
  readonly as: string;
  readonly label?: string;
}

export interface SourceQueryDefinition {
  readonly filter?: SourceFilter;
  readonly sort?: readonly SourceSort[];
  readonly select?: readonly SourceSelection[];
  readonly offset?: number;
  readonly limit?: number;
}

export interface ViewPresentationDefinition {
  readonly block: string;
  readonly config?: SpecMeta;
}

export interface ViewDefinition extends DefinitionIdentity {
  /** Collection key or semantic Source-binding key in this Workspace. */
  readonly source: string;
  readonly query?: SourceQueryDefinition;
  readonly presentation?: ViewPresentationDefinition;
}
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
