/**
 * Authoring working models, not a second persisted Spec or a runtime API.
 * Keys are editable UI choices; a host maps them to stable Spec identities.
 */
import type { FieldOperator, SpecMeta } from "@jthum/framework/spec";
import type {
  FieldFormat,
  FieldKind,
  FieldPresentation,
  FieldPresentationVariant,
} from "./field-capabilities.js";
import type { RuleDraft } from "./rule-model.js";
export type { RuleDraft, RuleStep } from "./rule-model.js";
export { cloneData } from "./editor-data.js";
export type {
  FieldFormat,
  FieldKind,
  FieldPresentation,
  FieldPresentationVariant,
} from "./field-capabilities.js";
export { FIELD_KINDS, fieldCapability } from "./field-capabilities.js";
export const VALUE_SEMANTICS = ["neutral", "info", "success", "warning", "danger"] as const;
export type ValueSemantic = (typeof VALUE_SEMANTICS)[number];
export type Exposure = "ui" | "agent";
export type SortDirection = "asc" | "desc";
export type FilterOp =
  | "eq"
  | "neq"
  | "contains"
  | "empty"
  | "not_empty"
  | "in"
  | "gt"
  | "gte"
  | "lt"
  | "lte";
export interface FilterClause {
  field: string;
  op?: FilterOp;
  value?: unknown;
}
export type FieldCondition =
  | { all: FieldCondition[] }
  | { any: FieldCondition[] }
  | { not: FieldCondition }
  | FilterClause;
interface DraftIdentity {
  id: string;
  key: string;
  label: string;
  description?: string;
  meta?: SpecMeta;
}
export interface FieldDraft extends DraftIdentity {
  type: FieldKind;
  description?: string;
  placeholder?: string;
  required?: boolean;
  default?: unknown;
  values?: string[];
  target?: string;
  format?: FieldFormat;
  currency?: string;
  presentation?: FieldPresentation;
  variant?: FieldPresentationVariant;
  max?: number;
  value_semantics?: Record<string, ValueSemantic>;
  validation?: {
    min?: number;
    max?: number;
    min_length?: number;
    max_length?: number;
    pattern?: string;
    message?: string;
  };
  visible_when?: FieldCondition;
  enabled_when?: FieldCondition;
  required_when?: FieldCondition;
  hidden_value?: "preserve" | "clear";
}
export interface TransitionDraft {
  id?: string;
  key: string;
  label: string;
  from: string[];
  to: string;
}
export interface LifecycleDraft {
  field: string;
  initial: string;
  terminal?: string[];
  transitions: TransitionDraft[];
}
export interface CollectionDraft extends DraftIdentity {
  collection_label?: string;
  /** Host-owned sharing hint; never an authorization policy. */
  expose?: boolean;
  fields: FieldDraft[];
  lifecycle?: LifecycleDraft;
}
export interface ViewMeasure {
  op: "count" | "sum" | "avg" | "min" | "max";
  field?: string;
  fields?: string[];
}
export interface ViewDraft extends DraftIdentity {
  source: string;
  fields: string[];
  /** Stable output contracts retained when they differ from key-derived defaults. */
  aliases?: Record<string, string>;
  column_labels?: Record<string, string>;
  where?: FilterClause[] | Record<string, unknown>;
  expose?: string[];
  limit?: number;
  order_by?: Record<string, SortDirection>;
  group_by?: string;
  group_alias?: string;
  group_label?: string;
  /** Canonical display path for a grouped relation; retained even when authoring does not edit it. */
  group_label_path?: string;
  measures?: Record<string, ViewMeasure>;
  measure_labels?: Record<string, string>;
  implicit?: boolean;
  presentation?: { block: string; config?: SpecMeta };
  /** Caller-parameter contracts retained while expose remains a field-path picker. */
  parameters?: Record<
    string,
    {
      key: string;
      label?: string;
      required?: boolean;
      operator?: FieldOperator;
      source?: "input";
    }
  >;
}
export interface FormDraft extends DraftIdentity {
  type?: string;
  fields?: string[];
  inputs?: FieldDraft[];
  mode: "create" | "edit" | "standalone";
  submit?: { success?: { title?: string; description?: string } };
  implicit?: boolean;
}
export interface EditorContext {
  collections: CollectionDraft[];
  views: ViewDraft[];
  forms: FormDraft[];
  rules: RuleDraft[];
}
export interface ViewActions {
  save: (draft: Partial<ViewDraft> & { key: string }) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
  query: (
    draft: ViewDraft,
    filters: Record<string, string>,
  ) => Promise<Array<Record<string, unknown>>>;
}
export interface ViewPreview {
  rows: Array<Record<string, unknown>> | null;
  view: ViewDraft;
  exposedFields: FieldDraft[];
  exposedValues: Record<string, string>;
  onFiltersChange: (values: Record<string, string>) => void;
}
export interface FormActions {
  save: (draft: FormDraft) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
  prepareField: (key: string, draft: Partial<FieldDraft>, existing?: FieldDraft) => FieldDraft;
}
export interface FormPreview {
  form: FormDraft;
  collection?: CollectionDraft;
  fields?: string[];
}
export interface CollectionActions {
  save: (draft: {
    key: string;
    label?: string;
    collection_label?: string;
    expose?: boolean;
    lifecycle?: LifecycleDraft | null;
  }) => Promise<unknown>;
  rename: (key: string, next: string) => Promise<unknown>;
  renameField: (collection: string, key: string, next: string) => Promise<unknown>;
  saveField: (collection: string, field: Partial<FieldDraft> & { key: string }) => Promise<unknown>;
  reorderFields: (collection: string, keys: string[]) => Promise<unknown>;
  deleteField: (collection: string, key: string) => Promise<unknown>;
  remove: (key: string) => Promise<unknown>;
}
