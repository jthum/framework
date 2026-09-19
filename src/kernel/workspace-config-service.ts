import {
  ERROR_CODES,
  FrameworkError,
  resourceConflict,
  resourceNotFound,
} from "../errors/error.ts";
import type { WorkspaceConfigStore } from "../persistence/workspace-config.ts";
import type { JsonValue } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { ActionRegistry } from "./action-registry.ts";
import type { ExecutionContext } from "./model.ts";
import type { RuntimeAction, SecretStore, WorkspaceSetting } from "./workspace-config.ts";

export type SettingInput = Omit<WorkspaceSetting, "value" | "secretRef"> & {
  readonly value?: JsonValue;
};

export type SettingSummary = Omit<WorkspaceSetting, "value" | "secretRef"> & {
  readonly configured: boolean;
  readonly value?: JsonValue;
};

export class WorkspaceConfigService {
  constructor(
    private readonly store: WorkspaceConfigStore,
    private readonly actions: ActionRegistry,
    private readonly secrets: SecretStore | undefined,
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
    if (!setting.secretRef || !this.secrets) return null;
    return await this.secrets.get(setting.secretRef);
  }

  async putSetting(context: ExecutionContext, input: SettingInput): Promise<SettingSummary> {
    await this.authorizeFor(context, "settings.update");
    const key = requiredKey(input.key, "Setting");
    const label = requiredKey(input.label, "Setting label");
    const previous = (await this.store.get(context.workspaceId)).settings.find(
      (item) => item.key === key,
    );
    if (input.secret && input.value !== undefined && typeof input.value !== "string")
      throw invalid("Secret setting values must be strings.");
    if (input.secret && !this.secrets)
      throw unsupported("Secret settings require a host SecretStore.");
    const ref = `workspace/${encodeURIComponent(context.workspaceId)}/setting/${encodeURIComponent(key)}`;
    const oldSecret =
      input.secret && input.value !== undefined ? await this.secrets!.get(ref) : null;
    if (input.secret && input.value !== undefined)
      await this.secrets!.set(ref, input.value as string);
    const setting: WorkspaceSetting = {
      key,
      label,
      ...(input.category ? { category: input.category } : {}),
      ...(input.secret
        ? {
            secret: true,
            ...(input.value !== undefined || previous?.secretRef ? { secretRef: ref } : {}),
          }
        : { value: input.value ?? null }),
    };
    try {
      await this.store.update(context.workspaceId, (current) => ({
        ...current,
        settings: [...current.settings.filter((item) => item.key !== key), setting],
      }));
    } catch (error) {
      if (input.secret && input.value !== undefined) {
        if (oldSecret === null) await this.secrets!.delete(ref);
        else await this.secrets!.set(ref, oldSecret);
      }
      throw error;
    }
    if (previous?.secretRef && !input.secret) await this.secrets?.delete(previous.secretRef);
    return maskSetting(setting);
  }

  async deleteSetting(context: ExecutionContext, key: string): Promise<void> {
    await this.authorizeFor(context, "settings.delete");
    const current = await this.store.get(context.workspaceId);
    const setting = current.settings.find((item) => item.key === key);
    if (!setting) throw resourceNotFound("Setting", key);
    await this.store.update(context.workspaceId, (value) => ({
      ...value,
      settings: value.settings.filter((item) => item.key !== key),
    }));
    if (setting.secretRef) await this.secrets?.delete(setting.secretRef);
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
    configured: setting.secret ? Boolean(setting.secretRef) : setting.value !== undefined,
    ...(setting.secret ? {} : { value: setting.value ?? null }),
  };
}

function requiredKey(value: string, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw invalid(`${label} is required.`);
  return value.trim();
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
