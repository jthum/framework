import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { WorkspaceConfigStore } from "../persistence/workspace-config.ts";
import type { JsonValue } from "../spec/model.ts";
import { assertValidRuleOutputContract } from "../spec/validate.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ActionRegistry } from "./action-registry.ts";
import type { ExecutionContext } from "./model.ts";
import type {
  ActorBinding,
  RuntimeAction,
  SecretCipher,
  WorkspaceSetting,
} from "./workspace-config.ts";

export type SettingInput = Omit<WorkspaceSetting, "value" | "encrypted" | "maskedValue"> & {
  readonly value?: JsonValue;
};

export type SettingSummary = Omit<WorkspaceSetting, "value" | "encrypted"> & {
  readonly configured: boolean;
  readonly value?: JsonValue;
};

export class WorkspaceConfigService {
  constructor(
    private readonly store: WorkspaceConfigStore,
    private readonly actions: ActionRegistry,
    private readonly cipher: SecretCipher | undefined,
    private readonly assertContext: (context: ExecutionContext) => Promise<void>,
    private readonly authorize: (request: AuthorizationRequest) => Promise<void>,
  ) {}

  async listSettings(context: ExecutionContext): Promise<readonly SettingSummary[]> {
    await this.authorizeFor(context, "settings.list");
    return (await this.store.get(context.workspaceId)).settings.map(maskSetting);
  }

  async getSetting(context: ExecutionContext, key: string): Promise<SettingSummary | null> {
    await this.authorizeFor(context, "settings.read");
    const setting = (await this.store.get(context.workspaceId)).settings.find(
      (item) => item.key === key,
    );
    return setting ? maskSetting(setting) : null;
  }

  /** Trusted Action implementations may resolve secrets without exposing them to UI readers. */
  async actionSetting(context: ExecutionContext, key: string): Promise<JsonValue | null> {
    const setting = (await this.store.get(context.workspaceId)).settings.find(
      (item) => item.key === key,
    );
    if (!setting) return null;
    if (!setting.secret) return setting.value ?? null;
    if (!setting.encrypted || !this.cipher) return null;
    return await this.cipher.decrypt(setting.encrypted, context.workspaceId, key);
  }

  /** Trusted inference runtimes resolve only the selected model's credential setting. */
  async inferenceCredential(workspaceId: string, key: string): Promise<string | null> {
    const setting = (await this.store.get(workspaceId)).settings.find((item) => item.key === key);
    if (!setting?.secret || !setting.encrypted || !this.cipher) return null;
    return this.cipher.decrypt(setting.encrypted, workspaceId, key);
  }

  async inferenceSetting(workspaceId: string, key: string): Promise<JsonValue | null> {
    const setting = (await this.store.get(workspaceId)).settings.find((item) => item.key === key);
    return setting && !setting.secret ? (setting.value ?? null) : null;
  }

  async putSetting(context: ExecutionContext, input: SettingInput): Promise<SettingSummary> {
    await this.authorizeFor(context, "settings.update");
    const key = requiredKey(input.key, "Setting");
    const label = requiredKey(input.label, "Setting label");
    if (input.secret && input.value !== undefined && typeof input.value !== "string")
      throw invalid("Secret setting values must be strings.");
    if (input.secret && !this.cipher)
      throw unsupported("Secret settings require a host encryption key.");
    const encrypted =
      input.secret && input.value !== undefined
        ? await this.cipher!.encrypt(input.value as string, context.workspaceId, key)
        : undefined;
    const next = await this.store.update(context.workspaceId, (current) => {
      const previous = current.settings.find((item) => item.key === key);
      const setting: WorkspaceSetting = {
        key,
        label,
        ...(input.category ? { category: input.category } : {}),
        ...(input.secret
          ? {
              secret: true,
              ...(encrypted
                ? { encrypted, maskedValue: maskSecret(input.value as string) }
                : previous?.secret && previous.encrypted
                  ? { encrypted: previous.encrypted, maskedValue: previous.maskedValue }
                  : {}),
            }
          : { value: input.value ?? null }),
      };
      return {
        ...current,
        settings: [...current.settings.filter((item) => item.key !== key), setting],
      };
    });
    return maskSetting(next.settings.find((item) => item.key === key)!);
  }

  async deleteSetting(context: ExecutionContext, key: string): Promise<void> {
    await this.authorizeFor(context, "settings.delete");
    const current = await this.store.get(context.workspaceId);
    if (!current.settings.some((item) => item.key === key)) throw resourceNotFound("Setting", key);
    await this.store.update(context.workspaceId, (value) => ({
      ...value,
      settings: value.settings.filter((item) => item.key !== key),
    }));
  }

  async listActorBindings(context: ExecutionContext): Promise<readonly ActorBinding[]> {
    await this.authorizeFor(context, "actor_bindings.list");
    return structuredClone((await this.store.get(context.workspaceId)).actorBindings);
  }

  async putActorBinding(context: ExecutionContext, input: ActorBinding): Promise<ActorBinding> {
    await this.authorizeFor(context, "actor_bindings.manage");
    const binding = {
      key: semanticKey(input.key, "Actor binding"),
      actorId: requiredKey(input.actorId, "Actor ID"),
    };
    await this.store.update(context.workspaceId, (current) => ({
      ...current,
      actorBindings: [...current.actorBindings.filter((item) => item.key !== binding.key), binding],
    }));
    return binding;
  }

  async deleteActorBinding(context: ExecutionContext, key: string): Promise<void> {
    await this.authorizeFor(context, "actor_bindings.manage");
    const bindingKey = semanticKey(key, "Actor binding");
    await this.store.update(context.workspaceId, (current) => {
      if (!current.actorBindings.some((item) => item.key === bindingKey))
        throw resourceNotFound("Actor binding", bindingKey);
      return {
        ...current,
        actorBindings: current.actorBindings.filter((item) => item.key !== bindingKey),
      };
    });
  }

  async resolveActorBinding(workspaceId: string, key: string): Promise<string | null> {
    return (
      (await this.store.get(workspaceId)).actorBindings.find((item) => item.key === key)?.actorId ??
      null
    );
  }

  async listRuntimeActions(context: ExecutionContext): Promise<readonly RuntimeAction[]> {
    await this.authorizeFor(context, "actions.list");
    return (await this.store.get(context.workspaceId)).actions;
  }

  async putRuntimeAction(context: ExecutionContext, input: RuntimeAction): Promise<RuntimeAction> {
    await this.authorizeFor(context, "actions.manage");
    if (!input || typeof input !== "object") throw invalid("Action definition is required.");
    const key = requiredKey(input.key, "Action");
    const label = requiredKey(input.label, "Action label");
    if (this.actions.has(key)) throw resourceConflict(`Action ${key} is installed by the host.`);
    if (!input.input || input.input.type !== "object")
      throw invalid("An Action input must be an object schema.");
    if (input.output !== undefined) assertValidRuleOutputContract(input.output);
    if (!input.implementation || !isRecord(input.implementation.config))
      throw invalid("Action implementation config must be an object.");
    requiredKey(input.implementation.kind, "Action implementation kind");
    if (input.tool?.availability && !["eager", "discoverable"].includes(input.tool.availability))
      throw invalid("Action tool availability is invalid.");
    const action = structuredClone({ ...input, key, label });
    await this.store.update(context.workspaceId, (current) => ({
      ...current,
      actions: [...current.actions.filter((item) => item.key !== key), action],
    }));
    return action;
  }

  async deleteRuntimeAction(context: ExecutionContext, key: string): Promise<void> {
    await this.authorizeFor(context, "actions.manage");
    await this.store.update(context.workspaceId, (current) => {
      if (!current.actions.some((item) => item.key === key)) throw resourceNotFound("Action", key);
      return { ...current, actions: current.actions.filter((item) => item.key !== key) };
    });
  }

  private async authorizeFor(context: ExecutionContext, operation: string): Promise<void> {
    await this.assertContext(context);
    await this.authorize({
      context,
      operation,
      resource: { kind: "workspace", id: context.workspaceId, workspaceId: context.workspaceId },
    });
  }
}

function maskSetting(setting: WorkspaceSetting): SettingSummary {
  return {
    key: setting.key,
    label: setting.label,
    ...(setting.category ? { category: setting.category } : {}),
    ...(setting.secret ? { secret: true } : {}),
    configured: setting.secret ? Boolean(setting.encrypted) : setting.value !== undefined,
    ...(setting.secret && setting.maskedValue ? { maskedValue: setting.maskedValue } : {}),
    ...(setting.secret ? {} : { value: setting.value ?? null }),
  };
}

function maskSecret(value: string): string {
  return value.length >= 8 ? `••••${value.slice(-4)}` : "••••";
}

function requiredKey(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${label} is required.`);
  return value.trim();
}

function semanticKey(value: string, label: string): string {
  const key = requiredKey(value, label);
  if (!/^[a-z][a-z0-9_]*$/.test(key))
    throw invalid(
      `${label} must begin with a lowercase letter and use letters, numbers, or underscores.`,
    );
  return key;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}

function unsupported(message: string): FrameworkError {
  return new FrameworkError({ code: ERROR_CODES.persistenceUnsupported, message });
}
