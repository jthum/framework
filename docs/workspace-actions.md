# Workspace settings and runtime Actions

Settings and runtime Actions are instance state scoped to one Workspace. They are not part of the portable Spec. A host can use them for configurable providers and user-authored capabilities without adding a new Rule or integration primitive.

## Code map

- Data contracts: [`src/kernel/workspace-config.ts`](../src/kernel/workspace-config.ts)
- Kernel operations: [`src/kernel/workspace-config-service.ts`](../src/kernel/workspace-config-service.ts)
- Action execution and delegation: [`src/kernel/action-registry.ts`](../src/kernel/action-registry.ts), [`src/kernel/rules.ts`](../src/kernel/rules.ts)
- Persistence ports: [`src/persistence/workspace-config.ts`](../src/persistence/workspace-config.ts)
- Behavior: [`src/kernel/workspace-config.spec.ts`](../src/kernel/workspace-config.spec.ts)

## Settings

`putSetting` stores a keyed, optionally categorized value. `listSettings` and `getSetting` are suitable for a settings UI. They return a `configured` flag and ordinary values, but never return a secret value. For secret settings, the host supplies `KernelOptions.secrets`: the config store retains only a reference while the `SecretStore` owns the value. Framework does not prescribe browser, encrypted database, or environment-backed secret storage.

Trusted Action implementations use `execution.getSetting(key)` to resolve either kind of setting. This is an execution capability, not a general UI read API. A host that runs untrusted user code must isolate it and decide which settings it may access; installing an executor grants that executor this capability.

## Actions

There is one Action execution path. Framework built-ins and host/module Actions are registered through `KernelOptions.actions`. A Workspace can additionally save a `RuntimeAction` with a semantic key, input schema, and opaque `implementation: { kind, config }`. The host installs an executor for each supported implementation kind through `KernelOptions.actionExecutors`. Framework stores the definition but does not evaluate arbitrary code in the Kernel process.

```ts
const kernel = await Kernel.open({
  persistence,
  actions: [{ key: "web.search.brave", run: async ({ input }) => searchBrave(input) }],
  actionExecutors: [
    {
      kind: "delegate",
      async run(_action, execution) {
        const key = await execution.getSetting("search_provider");
        if (typeof key !== "string") throw new Error("Select a search provider.");
        return execution.callAction(key, execution.input);
      },
    },
  ],
});

await kernel.putSetting(context, {
  key: "search_provider",
  label: "Search provider",
  category: "Search",
  value: "web.search.brave",
});

await kernel.putRuntimeAction(context, {
  key: "web.search",
  label: "Web search",
  description: "Search with the selected provider.",
  input: { type: "object", properties: { query: { type: "string" } } },
  implementation: { kind: "delegate", config: {} },
  tool: { availability: "discoverable", keywords: ["web", "search"] },
});
```

`execution.callAction` uses the same Actor, authorization, and bounded execution budget as a direct Action call. Thus `web.search` can delegate to a built-in, app-installed, or another Workspace Action. The executor may instead implement HTTP, JavaScript, WASM, or remote function semantics; those facilities and their isolation policy belong to the host.

A Rule may call `web.search` by key. A saved Action with `tool` metadata is projected directly as `action:web.search` for eligible Agents; it does not need a one-step Rule wrapper. Tool policy and execution-time authorization still apply. Actions whose implementation executor is not installed remain stored but cannot run or appear as Agent tools. This permits a host to disable an executor without deleting its definitions.

Hosts can import `WorkspaceSettings` and `WorkspaceActions` from their individual
`@jthum/framework/svelte/studio/*` paths. Both use a context-bound `WorkspaceClient`; the Action
editor receives only the implementation kinds installed by the host. A host may instead build its
own interface on the same client operations.

Action keys are Workspace-local contracts; a runtime Action cannot replace an installed built-in or host Action. Settings and runtime Actions are omitted from Spec export. A host that wants to move them between deployments should export instance configuration separately, excluding or re-binding secrets as appropriate.
