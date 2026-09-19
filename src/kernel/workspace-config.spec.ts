import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import {
  MemoryWorkspaceConfigStore,
  type WorkspaceConfigStore,
} from "../persistence/workspace-config.ts";
import type { JsonValue } from "../spec/model.ts";
import type { ActionDefinition, RuntimeActionExecutor } from "./action-registry.ts";
import { defineEnvironmentProfile, LOCAL_BROWSER_ENVIRONMENT } from "./environment.ts";
import type { InferenceContext, InferenceEvent, InferenceRuntime } from "./inference-runtime.ts";
import { Kernel } from "./kernel.ts";
import { ActionRegistry } from "./action-registry.ts";
import { WorkspaceConfigService } from "./workspace-config-service.ts";
import type { RuntimeAction, SecretStore } from "./workspace-config.ts";

const input = {
  type: "object" as const,
  properties: { query: { type: "string" as const } },
  required: ["query"],
  additionalProperties: false,
};

function runtimeAction(key: string, tool = true): RuntimeAction {
  return {
    key,
    label: "Search",
    description: "Search with the configured provider.",
    input,
    implementation: { kind: "delegate", config: {} },
    ...(tool ? { tool: { availability: "eager" } } : {}),
  };
}

class MemorySecrets implements SecretStore {
  readonly values = new Map<string, string>();
  async get(ref: string) {
    return this.values.get(ref) ?? null;
  }
  async set(ref: string, value: string) {
    this.values.set(ref, value);
  }
  async delete(ref: string) {
    this.values.delete(ref);
  }
}

describe("Workspace settings and runtime Actions", () => {
  it("preserves concurrent edits to different settings", async () => {
    const store = new MemoryWorkspaceConfigStore();
    await Promise.all([
      store.update("space", (current) => ({
        ...current,
        settings: [...current.settings, { key: "first", label: "First", value: 1 }],
      })),
      store.update("space", (current) => ({
        ...current,
        settings: [...current.settings, { key: "second", label: "Second", value: 2 }],
      })),
    ]);
    expect((await store.get("space")).settings.map((item) => item.key).sort()).toEqual([
      "first",
      "second",
    ]);
  });

  it("restores a secret if its configuration write fails", async () => {
    const secrets = new MemorySecrets();
    const ref = "workspace/space/setting/api_key";
    await secrets.set(ref, "old-value");
    const store: WorkspaceConfigStore = {
      async get() {
        return { settings: [], actions: [] };
      },
      async update() {
        throw new Error("write failed");
      },
    };
    const service = new WorkspaceConfigService(
      store,
      new ActionRegistry(),
      secrets,
      async () => {},
      async () => {},
    );
    await expect(
      service.putSetting(
        { workspaceId: "space", actorId: "actor" },
        { key: "api_key", label: "API key", secret: true, value: "new-value" },
      ),
    ).rejects.toThrow("write failed");
    expect(await secrets.get(ref)).toBe("old-value");
  });

  it("masks secrets and lets trusted Actions resolve them", async () => {
    const secrets = new MemorySecrets();
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      secrets,
      actions: [
        {
          key: "test.secret",
          run: ({ getSetting }) => getSetting("api_key"),
        },
      ],
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    try {
      expect(
        await kernel.putSetting(context, {
          key: "api_key",
          label: "API key",
          category: "Search",
          secret: true,
        }),
      ).toMatchObject({ configured: false });
      await kernel.putSetting(context, {
        key: "api_key",
        label: "API key",
        category: "Search",
        secret: true,
        value: "private-token",
      });
      expect(await kernel.getSetting(context, "api_key")).toEqual({
        key: "api_key",
        label: "API key",
        category: "Search",
        secret: true,
        configured: true,
      });
      expect(JSON.stringify(await kernel.listSettings(context))).not.toContain("private-token");
      expect(await kernel.executeAction(context, "test.secret")).toBe("private-token");
      await kernel.putSetting(context, { key: "api_key", label: "API key", secret: true });
      expect(await kernel.executeAction(context, "test.secret")).toBe("private-token");
      await kernel.deleteSetting(context, "api_key");
      expect(secrets.values.size).toBe(0);
    } finally {
      await kernel.close();
    }
  });

  it("executes a Workspace Action directly, from a Rule, and as an Agent tool", async () => {
    const calls: string[] = [];
    const provider: ActionDefinition = {
      key: "web.search.mock",
      run: ({ input: values }) => {
        calls.push(typeof values.query === "string" ? values.query : "");
        return { provider: "mock", query: values.query ?? null };
      },
    };
    const executor: RuntimeActionExecutor = {
      kind: "delegate",
      async run(_action, execution) {
        const providerKey = await execution.getSetting("search_provider");
        if (typeof providerKey !== "string") throw new Error("Search provider is not configured.");
        return execution.callAction(providerKey, execution.input);
      },
    };
    const inference: InferenceRuntime = {
      async *run(context: InferenceContext): AsyncIterable<InferenceEvent> {
        const offered = await context.tools.resolve({
          execution: context.execution,
          actor: context.actor,
          messages: context.messages,
          step: 1,
          activeToolIds: new Set(),
        });
        yield {
          type: "completed",
          output: await offered.execute({
            id: "call-1",
            toolId: "action:web.search",
            input: { query: "agent" },
          }),
        };
      },
    };
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      actions: [provider],
      actionExecutors: [executor],
      inference,
      environment: defineEnvironmentProfile({ ...LOCAL_BROWSER_ENVIRONMENT, inference: true }),
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    try {
      await kernel.putSetting(context, {
        key: "search_provider",
        label: "Search provider",
        category: "Search",
        value: "web.search.mock",
      });
      await kernel.putRuntimeAction(context, runtimeAction("web.search"));
      expect(await kernel.executeAction(context, "web.search", { query: "direct" })).toEqual({
        provider: "mock",
        query: "direct",
      });
      await kernel.applySpec(context, {
        ...workspace.spec,
        rules: [
          {
            id: "rule-search",
            key: "search",
            label: "Search",
            steps: [
              {
                id: "step-search",
                action: { key: "web.search", as: "result", input: { query: "rule" } },
              },
            ],
          },
        ],
      });
      expect((await kernel.runRule(context, "search")).vars.result).toEqual({
        provider: "mock",
        query: "rule",
      });
      const created = await kernel.createAgent(context, {
        name: "Assistant",
        instructions: "Search when useful.",
        provider: "test",
        model: "test",
        permissions: ["read", "create", "update", "delete", "manage"],
      });
      const agent = { ...context, actorId: created.actor.id };
      expect((await kernel.listInferenceTools(agent)).map((item) => item.id)).toContain(
        "action:web.search",
      );
      const events = await kernel.runInference(agent, { messages: [] });
      let output: JsonValue | undefined;
      for await (const event of events) if (event.type === "completed") output = event.output;
      expect(output).toEqual({ provider: "mock", query: "agent" });
      expect(calls).toEqual(["direct", "rule", "agent"]);
    } finally {
      await kernel.close();
    }
  });

  it("does not offer or preflight Actions whose executor is unavailable", async () => {
    const kernel = await Kernel.open({ persistence: new MemoryPersistenceAdapter() });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    try {
      await expect(
        kernel.putRuntimeAction(context, {
          ...runtimeAction("bad"),
          input: null,
        } as unknown as RuntimeAction),
      ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
      await kernel.putRuntimeAction(context, runtimeAction("web.search"));
      await expect(
        kernel.executeAction(context, "web.search", { query: "x" }),
      ).rejects.toMatchObject({
        code: ERROR_CODES.persistenceUnsupported,
      });
      await kernel.applySpec(context, {
        ...workspace.spec,
        rules: [
          {
            id: "rule-search",
            key: "search",
            label: "Search",
            steps: [{ id: "step-search", action: { key: "web.search" } }],
          },
        ],
      });
      await expect(kernel.runRule(context, "search")).rejects.toMatchObject({
        code: ERROR_CODES.persistenceUnsupported,
      });
    } finally {
      await kernel.close();
    }
  });

  it("uses Workspace Actions in durable Rules too", async () => {
    const calls: string[] = [];
    const kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, durableRuleExecution: true },
      actionExecutors: [
        {
          kind: "delegate",
          run: async (_action, execution) => {
            calls.push("ran");
            return execution.input.query ?? null;
          },
        },
      ],
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    const context = { workspaceId: workspace.id, actorId: user.id };
    try {
      await kernel.putRuntimeAction(context, runtimeAction("web.search", false));
      await kernel.applySpec(context, {
        ...workspace.spec,
        rules: [
          {
            id: "rule-search",
            key: "search",
            label: "Search",
            steps: [
              { id: "step-search", action: { key: "web.search", input: { query: "durable" } } },
            ],
          },
        ],
      });
      expect(await kernel.startRule(context, "search")).toMatchObject({ status: "completed" });
      expect(calls).toEqual(["ran"]);
    } finally {
      await kernel.close();
    }
  });

  it("rejects an Action removed after it was offered to an Agent", async () => {
    let kernel!: Kernel;
    let owner!: { workspaceId: string; actorId: string };
    const inference: InferenceRuntime = {
      async *run(context) {
        const offered = await context.tools.resolve({
          execution: context.execution,
          actor: context.actor,
          messages: context.messages,
          step: 1,
          activeToolIds: new Set(),
        });
        expect(offered.tools.map((tool) => tool.id)).toContain("action:web.search");
        await kernel.deleteRuntimeAction(owner, "web.search");
        await expect(
          offered.execute({ id: "call", toolId: "action:web.search", input: { query: "x" } }),
        ).rejects.toMatchObject({ code: ERROR_CODES.resourceNotFound });
        yield { type: "completed", output: null };
      },
    };
    kernel = await Kernel.open({
      persistence: new MemoryPersistenceAdapter(),
      environment: { ...LOCAL_BROWSER_ENVIRONMENT, inference: true },
      inference,
      actionExecutors: [{ kind: "delegate", run: () => null }],
    });
    const { workspace, user } = await kernel.createRootWorkspace({
      name: "Space",
      user: { name: "Jane" },
    });
    owner = { workspaceId: workspace.id, actorId: user.id };
    try {
      await kernel.putRuntimeAction(owner, runtimeAction("web.search"));
      const created = await kernel.createAgent(owner, {
        name: "Assistant",
        instructions: "Use tools.",
        provider: "test",
        model: "test",
        permissions: ["read"],
      });
      const stream = await kernel.runInference(
        { ...owner, actorId: created.actor.id },
        { messages: [] },
      );
      for await (const _event of stream) {
        /* consume the deterministic runtime */
      }
    } finally {
      await kernel.close();
    }
  });
});
