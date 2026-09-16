import type { SourceResult } from "../kernel/sources.ts";
import type { SpecMeta } from "../spec/model.ts";

export interface BlockDefinition {
  readonly key: string;
  readonly label: string;
  readonly category: string;
  readonly description?: string;
  readonly defaultConfig?: SpecMeta;
}

/** The complete declared input to a Block renderer. Blocks do not perform data access. */
export interface BlockInput {
  readonly data: SourceResult;
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
