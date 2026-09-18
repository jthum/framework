# Inference and Agents

Framework separates inference execution from Agent identity. `InferenceRuntime` is the only
Kernel-facing inference contract. A runtime receives resolved instructions, model selection,
messages, execution identity, and Framework's dynamic tool gateway, then emits a normalized event
stream for the complete run.

## Code map

- Runtime contract: [`src/kernel/inference-runtime.ts`](../src/kernel/inference-runtime.ts)
- Persisted Agent settings: [`src/kernel/agent-config.ts`](../src/kernel/agent-config.ts)
- Dynamic tool gateway: [`src/kernel/inference-tools.ts`](../src/kernel/inference-tools.ts)
- Kernel composition: [`src/kernel/kernel.ts`](../src/kernel/kernel.ts)
- Context-bound client: [`src/client/workspace-client.ts`](../src/client/workspace-client.ts)
- Runtime contract tests: [`src/kernel/inference-runtime.spec.ts`](../src/kernel/inference-runtime.spec.ts)
- YAIR implementation: [`packages/inference/yair/core`](../packages/inference/yair/core)

## One integration boundary

Hosts install one complete-run implementation:

```ts
const kernel = await Kernel.open({
  persistence,
  environment: defineEnvironmentProfile({
    ...LOCAL_BROWSER_ENVIRONMENT,
    inference: true,
  }),
  inference,
});
```

The runtime owns provider communication and the model/tool iteration loop. Framework owns Actor
identity, persisted Agent configuration, Action and Rule projection, contextual tool availability,
authorization, and tool execution. The runtime can never grant itself authority: it invokes tools
through the supplied `InferenceToolGateway`, whose execution path re-enters current Kernel checks.

Runtime implementations may wrap a broad inference library or provide their own provider system.
Framework does not depend on a model SDK, agent library, or schema library.

## YAIR

YAIR—Yet Another Inference Runtime—is developed as the independent `@jthum/yair` workspace package.
It contains the lightweight sequential loop previously built into Framework. YAIR resolves tools
before every model step, executes calls in emitted order, feeds results and structured errors back
to the model, aggregates usage, and enforces a step limit.

YAIR provider packages implement its narrower `ModelProvider` contract for one model request. That
contract belongs to YAIR, not Framework. Other complete runtimes integrate directly through
`InferenceRuntime` and do not use `ModelProvider`.

```ts
import { yair, ModelProviderRegistry } from "@jthum/yair";

const inference = yair({
  provider: new ModelProviderRegistry([{ key: "provider", provider }]),
});
```

YAIR is tightly integrated through Framework's public inference contract while remaining a
separate package. Framework never imports YAIR.

## Actors and Agent configuration

`Kernel.runInference(context, input)` uses the Actor in `context`:

- A user-facing assistant normally uses the current User. Its tool calls are authorized and
  attributed to that User.
- An autonomous or independently permissioned Agent uses an Agent Actor and ordinary Membership.
- A host may deliberately use a System Actor for system-owned work.

An Agent Actor has a persisted `AgentConfig` containing instructions, a selected `ModelConfig`, and
tool-selection policy. `ModelConfig` stores a provider key, model key, optional provider settings,
and an opaque `credentialRef`; the referenced secret stays in trusted host infrastructure.

The compact creation path remains atomic:

```ts
const planner = await kernel.createAgent(context, {
  name: "Planner",
  instructions: "Plan and prioritize the team's work.",
  provider: "provider",
  model: "reasoning-model",
  credentialRef: "secret/provider/team",
  permissions: ["read", "create", "update"],
});
```

Agent configuration is instance state rather than portable Spec. Exporting Spec does not export
identities, credentials, or deployment choices.

## Dynamic tools

`InferenceToolGateway.resolve()` returns a stable executable snapshot for one model step. A runtime
resolves it again before the next step. This supports tools that exist only on the first message,
after a particular result, or in one host interface.

Register trusted contextual providers with `KernelOptions.inferenceTools`. Business capabilities
normally remain Actions or Rules so all callers share one implementation. Inference-only tools can
come from a host provider.

Action tool metadata may use `availability: "discoverable"`. Agent-exposed Rules are discoverable
by default. When hidden matches exist, Framework offers `search_tools`; selected matches become
active on the following step. Eager tools remain attached without requiring discovery.

An Agent's persisted tool policy may include or exclude stable tool IDs and enable or disable
discovery. It narrows the eligible catalog and never grants permission. When discovery is disabled,
eligible discoverable tools are attached directly.

Immediately before execution, the gateway resolves current availability and authorization again.
A removed tool or revoked permission returns a structured tool error that the runtime can feed into
the conversation. Parallel execution is not implied by the contract; YAIR executes multiple calls
from one model step sequentially.

## Actions and Rules

Actions opt in with provider-neutral tool metadata. Rules opt in through `expose: ["agent"]`.
Disabled and unexposed Rules are absent. Short Rules return their result; durable Rules return their
execution identity and current status. Compact built-in tools cover Source and View discovery,
generic record operations, and View operations without generating per-Collection CRUD tools.

`inference.run` is a built-in Action. A Rule inherits its current Actor unless an action uses an
explicit semantic `runAs` binding. The host resolves that binding to an Actor without placing a
concrete Actor ID in portable Spec.

## Event contract

An `InferenceRuntime` emits `started`, monotonically numbered steps, streamed content and tool
activity, then exactly one terminal event: `completed`, `refused`, `failed`, or `cancelled`. No event
may follow the terminal. `collectInferenceRun` validates terminal behavior and returns completed
JSON output or raises the normalized Framework error.

An embedded host can consume the async stream directly. A server host resolves the authenticated
Actor, runs the Kernel, and frames events for its transport. Conversation persistence and bounded
history are host state.

Deterministic tests cover identity, authorization, discovery, changing tool availability, ordering,
stream validity, refusal, cancellation, and step limits. Behavioral model evals belong beside a
concrete runtime/provider integration.
