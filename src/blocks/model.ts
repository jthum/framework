import type { SourceResult } from "../kernel/sources.ts";
import type { JsonValue, PageHeight, SpecMeta } from "../spec/model.ts";

export type BlockInputType =
  | "text"
  | "textarea"
  | "number"
  | "boolean"
  | "view"
  | "form"
  | "rule"
  | "field"
  | "select";

export type BlockFieldKind = "number" | "date" | "datetime" | "choice" | "any";

export interface BlockOptionDefinition {
  readonly value: string;
  readonly label: string;
}

/** Portable configuration metadata used by Studio; it never loads or executes a renderer. */
export interface BlockInputDefinition {
  readonly key: string;
  readonly label: string;
  readonly type: BlockInputType;
  readonly description?: string;
  readonly required?: boolean;
  readonly default?: JsonValue;
  /** Restricts a Field picker without coupling the Block to a concrete Collection. */
  readonly fieldKind?: BlockFieldKind;
  /** Key of the sibling input whose selection provides this input's choices. */
  readonly dependsOn?: string;
  readonly options?: readonly BlockOptionDefinition[];
}

export interface BlockDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly description?: string;
  readonly order?: number;
  readonly defaultHeight?: PageHeight;
  readonly defaultConfig?: SpecMeta;
  /** Omit for a zero-configuration Block. */
  readonly inputs?: readonly BlockInputDefinition[];
}

/** The complete declared input to a Block renderer. Blocks do not perform data access. */
export interface BlockInput<Data = SourceResult> {
  /** Static Blocks may specialize Data as undefined and render entirely from config. */
  readonly data: Data;
  readonly config?: SpecMeta;
}

/** Compatible with dynamic imports whose default export is a Svelte component or other renderer. */
export interface BlockModule<Renderer = unknown> {
  readonly default: Renderer;
}

export interface BlockRegistration<Renderer = unknown> {
  readonly definition: BlockDefinition;
  readonly load: () => Promise<BlockModule<Renderer>>;
}
