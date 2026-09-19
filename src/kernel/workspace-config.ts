import type { JsonValue } from "../spec/model.ts";
import type { InferenceToolInputSchema } from "./inference-runtime.ts";

/** Instance settings belong to one Workspace, never to the portable Spec. */
export interface WorkspaceSetting {
  readonly key: string;
  readonly label: string;
  readonly category?: string;
  readonly secret?: boolean;
  /** Plain values are stored here. Secret values are stored only in SecretStore. */
  readonly value?: JsonValue;
  readonly secretRef?: string;
}

/** A runtime-installed Action contract; executors interpret the opaque implementation. */
export interface RuntimeAction {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly input: InferenceToolInputSchema;
  readonly implementation: {
    readonly kind: string;
    readonly config: Readonly<Record<string, JsonValue>>;
  };
  readonly tool?: {
    readonly availability?: "eager" | "discoverable";
    readonly keywords?: readonly string[];
  };
}

export interface WorkspaceConfig {
  readonly settings: readonly WorkspaceSetting[];
  readonly actions: readonly RuntimeAction[];
}

export const EMPTY_WORKSPACE_CONFIG: WorkspaceConfig = { settings: [], actions: [] };

/** The host decides how secret values are protected in its deployment. */
export interface SecretStore {
  get(ref: string): Promise<string | null>;
  set(ref: string, value: string): Promise<void>;
  delete(ref: string): Promise<void>;
}
