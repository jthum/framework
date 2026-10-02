import type { JsonValue } from "../spec/model.ts";

/** IDs retain the provider's representation. Numeric 1 and string "1" are distinct. */
export type EntityId = string | number;
export type EntityRow = Readonly<Record<string, unknown>>;
export type ModuleCapability =
  | "transactions"
  | "joins"
  | "unions"
  | "aggregates"
  | "latest"
  | "traversal"
  | "sampling";

export interface EntityField {
  readonly type: "text" | "number" | "boolean" | "id" | "json";
  readonly optional?: boolean;
  readonly values?: readonly (string | number | boolean)[];
  readonly generated?: "sequence";
  readonly references?: {
    readonly entity: string;
    readonly onDelete?: "restrict" | "cascade" | "setNull";
  };
}

export interface EntityIndex {
  readonly fields: readonly string[];
  readonly unique?: boolean;
}

/** id and workspaceId are implicit; nested field paths do not prescribe physical columns. */
export interface EntitySchema {
  readonly fields: Readonly<Record<string, EntityField>>;
  readonly indexes?: readonly EntityIndex[];
}

/** Host code declaration, not a Collection or part of the user-authored portable Spec. */
export interface ModuleSchema {
  readonly id: string;
  readonly entities: Readonly<Record<string, EntitySchema>>;
  readonly requires?: readonly ModuleCapability[];
}

export type EntityExpression =
  | { readonly field: string; readonly source?: string }
  | { readonly value: JsonValue }
  | { readonly coalesce: readonly EntityExpression[] }
  | { readonly slice: EntityExpression; readonly length: number }
  | {
      readonly when: EntityFilter;
      readonly thenValue: EntityExpression;
      readonly elseValue: EntityExpression;
    };

export type EntityFilter =
  | { readonly op: "and"; readonly conditions: readonly EntityFilter[] }
  | { readonly op: "or"; readonly conditions: readonly EntityFilter[] }
  | { readonly op: "not"; readonly condition: EntityFilter }
  | {
      readonly op: "eq" | "ne" | "lt" | "lte" | "gt" | "gte";
      readonly left: EntityExpression;
      readonly right: EntityExpression;
    }
  | {
      readonly op: "in";
      readonly expression: EntityExpression;
      readonly values: readonly JsonValue[];
    };

export interface EntityOrder {
  readonly expression: EntityExpression;
  readonly direction?: "asc" | "desc";
}

export interface EntityAggregate {
  readonly op: "count" | "sum" | "min" | "max";
  readonly expression?: EntityExpression;
  readonly distinct?: boolean;
  readonly where?: EntityFilter;
}

export interface EntityQuery {
  /** Exactly one of from or union. Union branches expose the same named projection. */
  readonly from?: string;
  readonly union?: readonly EntityQuery[];
  readonly joins?: readonly {
    readonly entity: string;
    readonly as: string;
    readonly on: EntityFilter;
    readonly kind?: "inner" | "left";
  }[];
  readonly where?: EntityFilter;
  readonly select?: Readonly<Record<string, EntityExpression>>;
  readonly aggregate?: Readonly<Record<string, EntityAggregate>>;
  readonly groupBy?: readonly EntityExpression[];
  readonly orderBy?: readonly EntityOrder[];
  readonly limit?: number;
  readonly offset?: number;
  /** Pick the newest ordered row in each group BEFORE the final limit. */
  readonly latestBy?: readonly string[];
  /** Latest N rows per group; defaults to one. Requires latestBy. */
  readonly limitPerGroup?: number;
  /** Scope-restricted, cycle-safe traversal; virtual traversal.rootId/depth fields. */
  readonly traverse?: {
    readonly parentField: string;
    readonly roots: readonly EntityId[];
    readonly direction: "ancestors" | "descendants";
    readonly includeRoots?: boolean;
  };
  /** Evenly spaced ordered rows; returns virtual ordinal and total fields. */
  readonly sample?: number;
}

/** Trusted persistence surface. Workspace scoping is isolation, not Actor authorization. */
export interface ModuleTransaction {
  get<T extends object = EntityRow>(entity: string, id: EntityId): Promise<T | null>;
  query<T extends object = EntityRow>(query: EntityQuery): Promise<T[]>;
  insert<T extends object = EntityRow>(entity: string, row: object): Promise<T>;
  insertMany<T extends object = EntityRow>(entity: string, rows: readonly object[]): Promise<T[]>;
  update<T extends object = EntityRow>(entity: string, id: EntityId, patch: object): Promise<T>;
  delete(entity: string, id: EntityId): Promise<void>;
  upsert<T extends object = EntityRow>(
    entity: string,
    keys: readonly string[],
    row: object,
  ): Promise<T>;
}

export interface ModuleWorkspaceStore extends ModuleTransaction {
  /** All reads/writes use the supplied transaction, never the outer store inside this callback. */
  transaction<T>(work: (transaction: ModuleTransaction) => Promise<T>): Promise<T>;
}

export interface ModuleStore {
  workspace(workspaceId: string): ModuleWorkspaceStore;
}

export interface ModulePersistence {
  readonly capabilities: readonly ModuleCapability[];
  open(schema: ModuleSchema): Promise<ModuleStore>;
}

export const MODULE_CAPABILITIES: readonly ModuleCapability[] = [
  "transactions",
  "joins",
  "unions",
  "aggregates",
  "latest",
  "traversal",
  "sampling",
];

export const entityField = (field: string, source?: string): EntityExpression => ({
  field,
  ...(source ? { source } : {}),
});
export const entityValue = (value: JsonValue): EntityExpression => ({ value });
export const entityEqual = (field: string, value: JsonValue, source?: string): EntityFilter => ({
  op: "eq",
  left: entityField(field, source),
  right: entityValue(value),
});
export const entityAnd = (...conditions: readonly EntityFilter[]): EntityFilter => ({
  op: "and",
  conditions,
});
export const entityOr = (...conditions: readonly EntityFilter[]): EntityFilter => ({
  op: "or",
  conditions,
});
