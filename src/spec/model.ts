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
  /** Stable ID of a local Collection or declared Source binding in this Spec. */
  readonly sourceId: string;
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
  /** Optional plural/display label for a set of records. */
  readonly collectionLabel?: string;
  readonly fields: readonly FieldDefinition[];
  readonly titleFieldId?: string;
  readonly lifecycle?: CollectionLifecycleDefinition;
}

/** A semantic Source binding is portable; its concrete resolution is instance data. */
export interface SourceDefinition extends DefinitionIdentity {}

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

export type SourceAggregateOperation = "count" | "sum" | "avg" | "min" | "max";

export interface SourceAggregateMeasure {
  /** Stable result key exposed to Blocks and consumers. */
  readonly as: string;
  readonly label?: string;
  readonly operation: SourceAggregateOperation;
  /** Required by numeric operations other than a multi-path average. */
  readonly path?: readonly string[];
  /** Average these fields per record, then average the resulting records. */
  readonly paths?: readonly (readonly string[])[];
}

export interface SourceAggregateSort {
  /** Group alias or measure alias. */
  readonly key: string;
  readonly direction: "asc" | "desc";
}

export interface SourceAggregateGroup extends SourceSelection {
  /** Optional display path while the grouping identity continues to use path. */
  readonly labelPath?: readonly string[];
}

export interface SourceAggregateDefinition {
  readonly group: SourceAggregateGroup;
  readonly measures: readonly SourceAggregateMeasure[];
  readonly sort?: readonly SourceAggregateSort[];
}

export interface SourceQueryDefinition {
  readonly filter?: SourceFilter;
  readonly sort?: readonly SourceSort[];
  readonly select?: readonly SourceSelection[];
  readonly aggregate?: SourceAggregateDefinition;
  readonly offset?: number;
  readonly limit?: number;
}

export interface ViewPresentationDefinition {
  readonly block: string;
  readonly config?: SpecMeta;
}

/** A caller-supplied filter exposed by a View without changing its stored query. */
export interface ViewParameterDefinition {
  readonly key: string;
  readonly label?: string;
  readonly path: readonly string[];
  readonly operator?: FieldOperator;
  readonly required?: boolean;
  /** Context parameters are supplied by the embedding surface rather than shown as filters. */
  readonly source?: "input" | "context";
}

export interface ViewQueryInput {
  readonly parameters?: Readonly<Record<string, JsonValue>>;
}

export interface ViewDefinition extends DefinitionIdentity {
  /** Collection key or semantic Source-binding key in this Workspace. */
  readonly source: string;
  readonly query?: SourceQueryDefinition;
  readonly parameters?: readonly ViewParameterDefinition[];
  readonly presentation?: ViewPresentationDefinition;
}

export interface FormSuccessDefinition {
  readonly title?: string;
  readonly description?: string;
}

export interface FormSubmitDefinition {
  /** Presentation hint only; workflow behavior belongs to form.submitted Rules. */
  readonly success?: FormSuccessDefinition;
}

export interface CollectionFormDefinition extends DefinitionIdentity {
  readonly mode: "create" | "edit";
  /** Stable ID of the local Collection this Form writes. */
  readonly collectionId: string;
  /** Ordered stable IDs of Fields exposed by this Form. */
  readonly fieldIds: readonly string[];
  readonly submit?: FormSubmitDefinition;
}

export interface StandaloneFormDefinition extends DefinitionIdentity {
  readonly mode: "standalone";
  /** Ordered, Form-owned Fields emitted with form.submitted. */
  readonly fields: readonly FieldDefinition[];
  readonly submit?: FormSubmitDefinition;
}

export type FormDefinition = CollectionFormDefinition | StandaloneFormDefinition;

export type PageHeight = "s" | "m" | "l" | "xl";

export interface PageBlockNode {
  readonly id: string;
  readonly kind: "block";
  readonly block: string;
  readonly config?: SpecMeta;
}

export interface PageGroupNode {
  readonly id: string;
  readonly kind: "group";
  readonly columns?: number;
  readonly minHeight?: PageHeight;
  readonly children: readonly PageLayoutNode[];
}

export type PageLayoutNode = PageBlockNode | PageGroupNode;

export interface PageDefinition extends DefinitionIdentity {
  /** Ordered layout tree. Groups are layout, never registry Blocks. */
  readonly layout: readonly PageLayoutNode[];
}

export interface RuleBinding {
  readonly $ref: string;
}

export type RuleValue =
  | JsonPrimitive
  | RuleBinding
  | readonly RuleValue[]
  | { readonly [key: string]: RuleValue };

export type RulePredicate =
  | { readonly all: readonly RulePredicate[] }
  | { readonly any: readonly RulePredicate[] }
  | { readonly not: RulePredicate }
  | ({ readonly op: string } & { readonly [key: string]: RuleValue });

export type RuleInputDefinition =
  | { readonly sourceId: string; readonly required?: boolean }
  | {
      readonly value: "text" | "number" | "boolean" | "date" | "object" | "array";
      readonly required?: boolean;
      readonly default?: RuleValue;
    };

export interface RuleTriggerDefinition {
  /** Stable Event contract key, for example `record.created` or `form.submitted`. */
  readonly event: string;
  readonly sourceId?: string;
  readonly fieldId?: string;
  readonly formId?: string;
  readonly config?: Readonly<Record<string, RuleValue>>;
}

export interface RuleRetryDefinition {
  /** Total attempts, including the initial attempt. */
  readonly max: number;
  /** Non-negative seconds before subsequent attempts. */
  readonly backoff?: readonly number[];
}

export interface RuleActionCall {
  /** Immutable semantic contract key registered by the runtime. */
  readonly key: string;
  readonly input?: Readonly<Record<string, RuleValue>>;
  /** Defaults to the execution Actor; `system` or a semantic Actor binding may override it. */
  readonly runAs?: string;
}

export interface RuleAction extends RuleActionCall {
  readonly as?: string;
  readonly retry?: RuleRetryDefinition;
  readonly compensate?: RuleActionCall;
}

interface RuleStepIdentity {
  /** Stable within this Rule; used by traces, retries, waits, and idempotency. */
  readonly id: string;
}

export type RuleStep =
  | (RuleStepIdentity & {
      readonly gate: {
        readonly predicate: RulePredicate;
        readonly pass?: readonly RuleStep[];
        readonly fail?: readonly RuleStep[];
      };
    })
  | (RuleStepIdentity & {
      readonly compute: { readonly assign: Readonly<Record<string, RuleValue>> };
    })
  | (RuleStepIdentity & { readonly action: RuleAction })
  | (RuleStepIdentity & {
      readonly invoke: {
        /** Stable ID of another Rule in this Spec. */
        readonly ruleId: string;
        readonly input?: Readonly<Record<string, RuleValue>>;
        readonly as?: string;
      };
    })
  | (RuleStepIdentity & { readonly delay: { readonly duration: number | string } })
  | (RuleStepIdentity & {
      readonly wait: {
        /** Host-rendered User intake; concrete Actor IDs remain instance data. */
        readonly request?: {
          readonly actor?: string;
          readonly label: string;
          readonly fields: readonly FieldDefinition[];
        };
        readonly signal?: string;
        readonly timeout?: number | string;
        readonly as?: string;
        readonly onSignal?: readonly RuleStep[];
        readonly onTimeout?: readonly RuleStep[];
      };
    })
  | (RuleStepIdentity & {
      readonly foreach: {
        readonly source: RuleBinding;
        readonly as?: string;
        readonly max?: number;
        readonly onItemFailure?: "stop" | "continue";
        readonly steps: readonly RuleStep[];
      };
    })
  | (RuleStepIdentity & {
      readonly repeat: {
        readonly times: number | RuleBinding;
        readonly as?: string;
        readonly max?: number;
        readonly onItemFailure?: "stop" | "continue";
        readonly steps: readonly RuleStep[];
      };
    })
  | (RuleStepIdentity & {
      readonly parallel: {
        readonly branches: readonly {
          readonly id: string;
          readonly key?: string;
          readonly steps: readonly RuleStep[];
        }[];
        readonly join?: "all" | "any";
      };
    });

export interface RuleDefinition extends DefinitionIdentity {
  readonly enabled?: boolean;
  readonly priority?: number;
  readonly input?: Readonly<Record<string, RuleInputDefinition>>;
  readonly trigger?: RuleTriggerDefinition;
  readonly expose?: readonly ("ui" | "agent")[];
  readonly steps: readonly RuleStep[];
}

export interface Spec extends DefinitionIdentity {
  readonly version: typeof SPEC_VERSION;
  readonly collections: readonly CollectionDefinition[];
  readonly sources: readonly SourceDefinition[];
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
