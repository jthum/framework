import type { JsonValue, RuleOutputContract } from "../spec/model.ts";
import type { InferenceToolInputSchema } from "./inference-runtime.ts";

/** Instance settings belong to one Workspace, never to the portable Spec. */
export interface WorkspaceSetting {
  readonly key: string;
  readonly label: string;
  readonly category?: string;
  readonly secret?: boolean;
  /** Ordinary values are stored here. Secret values are sealed in `encrypted`. */
  readonly value?: JsonValue;
  readonly encrypted?: EncryptedSecret;
  readonly maskedValue?: string;
}

export interface EncryptedSecret {
  readonly version: 1;
  readonly algorithm: "AES-GCM";
  readonly iv: string;
  readonly ciphertext: string;
}

/** Instance mapping from one portable semantic Rule binding to a concrete Actor. */
export interface ActorBinding {
  readonly key: string;
  readonly actorId: string;
}

/** A runtime-installed Action contract; executors interpret the opaque implementation. */
export interface RuntimeAction {
  readonly key: string;
  readonly label: string;
  readonly description: string;
  readonly input: InferenceToolInputSchema;
  readonly output?: RuleOutputContract;
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
  readonly actorBindings: readonly ActorBinding[];
}

export const EMPTY_WORKSPACE_CONFIG: WorkspaceConfig = {
  settings: [],
  actions: [],
  actorBindings: [],
};

/** Framework stores sealed settings; the host supplies the environment's key. */
export interface SecretCipher {
  encrypt(value: string, workspaceId: string, settingKey: string): Promise<EncryptedSecret>;
  decrypt(value: EncryptedSecret, workspaceId: string, settingKey: string): Promise<string>;
}
