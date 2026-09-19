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

The host may define a `SettingsLayout` and render it with `SettingsPanel`. Its tabs and sections are presentation, while each control reuses a `FieldDefinition` for its stable setting key, type, default, and validation. A setting can move between sections without changing its key. The layout is host-owned instance UI, not portable Spec. `SettingsPanel` edits only declared settings; it does not offer a create/delete setting flow. Secret text inputs stay blank after loading and an empty edit preserves an existing secret. Its save operation validates all visible controls before writing; writes are sequential, not atomic across settings.

`WorkspaceSettings` is the separate, optional editor for user-defined settings. Pass `reservedKeys` when composing it alongside a host layout to keep those app-defined keys out of the custom editor. A host may omit the custom editor entirely. This is a UI boundary, not an authorization policy: server hosts that restrict which settings may be created or modified must enforce that policy at their API/authorization boundary as well.

Trusted Action implementations use `execution.getSetting(key)` to resolve either kind of setting. This is an execution capability, not a general UI read API. A host that runs untrusted user code must isolate it and decide which settings it may access; installing an executor grants that executor this capability.

## Actions

There is one Action execution path. Framework built-ins and host/module Actions are registered through `KernelOptions.actions`. A Workspace can additionally save a `RuntimeAction` with a semantic key, input schema, and opaque `implementation: { kind, config }`. The host installs an executor for each supported implementation kind through `KernelOptions.actionExecutors`. Framework stores the definition but does not evaluate arbitrary code in the Kernel process.

```ts
const kernel = await Kernel.open({
  persistence,
  actionExecutors: [
    {
      kind: "http",
      async run(action, execution) {
        const endpoint = action.implementation.config.endpoint;
        if (typeof endpoint !== "string") throw new Error("An endpoint is required.");
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(execution.input),
        });
        return await response.json();
      },
    },
  ],
});

await kernel.putRuntimeAction(context, {
  key: "company.lookup",
  label: "Look up company",
  description: "Look up a company through the configured service.",
  input: { type: "object", properties: { query: { type: "string" } } },
  implementation: { kind: "http", config: { endpoint: "https://example.test/lookup" } },
  tool: { availability: "discoverable", keywords: ["company", "lookup"] },
});
```

The example only demonstrates the executor boundary; a production HTTP executor must define its
own URL, network, credential, timeout, and response policies. An executor may instead implement
JavaScript, WASM, a remote function, or another capability. Those facilities and their isolation
policy belong to the host. When an executor deliberately composes installed Actions,
`execution.callAction` preserves the same Actor, authorization, and bounded execution state.

A Rule may call `company.lookup` by key. A saved Action with `tool` metadata is projected directly as `action:company.lookup` for eligible Agents; it does not need a one-step Rule wrapper. Tool policy and execution-time authorization still apply. Actions whose implementation executor is not installed remain stored but cannot run or appear as Agent tools. This permits a host to disable an executor without deleting its definitions.

Hosts can import `WorkspaceSettings` and `SettingsPanel` from their individual
`@jthum/framework/svelte/studio/*` paths. Framework deliberately does not provide a generic
runtime-Action editor: each implementation kind needs an authoring experience that explains the
capability it creates. A host that enables HTTP, code, WASM, or another executor builds or imports
the corresponding interface on the same `WorkspaceClient` operations.

Action keys are Workspace-local contracts; a runtime Action cannot replace an installed built-in or host Action. Settings and runtime Actions are omitted from Spec export. A host that wants to move them between deployments should export instance configuration separately, excluding or re-binding secrets as appropriate.
