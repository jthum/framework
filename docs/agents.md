# Inference and Agents

Framework separates a model request, a complete tool-using turn, and the Actor whose authority is
used. This lets a user-facing assistant run as its current User while an autonomous Agent runs as
an Agent Actor with its own Membership and permission ceiling.

## Code map

- Contracts and default loop: [`src/kernel/agent-runtime.ts`](../src/kernel/agent-runtime.ts)
- Kernel composition and tool gateway: [`src/kernel/kernel.ts`](../src/kernel/kernel.ts)
- Action tool metadata: [`src/kernel/action-registry.ts`](../src/kernel/action-registry.ts)
- Context-bound client: [`src/client/workspace-client.ts`](../src/client/workspace-client.ts)
- Deterministic contract tests: [`src/kernel/agent-runtime.spec.ts`](../src/kernel/agent-runtime.spec.ts)

## Three layers

`InferenceAdapter` performs one provider/model request. Its input is an immutable message and tool
snapshot for that request. It translates provider events into `InferenceEvent` without deciding
which tools exist or executing them.

`AgentRuntime` coordinates a complete turn. `DefaultAgentRuntime` resolves tools, calls an
`InferenceAdapter`, executes requested tools sequentially, adds results to the messages, and repeats
until the turn completes. A host may replace the complete runtime when a higher-level agent library
needs to own orchestration.

The Kernel owns execution identity, authorization, Action and Rule projection, and the dynamic tool
gateway. Every tool execution re-enters current Kernel checks.

The simple composition path is one adapter:

```ts
const kernel = await Kernel.open({
  persistence,
  environment: defineEnvironmentProfile({
    ...LOCAL_BROWSER_ENVIRONMENT,
    agentRuntime: true,
  }),
  inference,
});
```

Framework constructs `DefaultAgentRuntime`. Advanced hosts pass `agentRuntime` instead. Supplying
both is rejected so ownership of the loop is unambiguous.

No model SDK or schema library is a dependency of the Spec or Kernel. An adapter may use either
internally.

## Actors

`Kernel.runAgent(context, input)` uses the Actor in `context`:

- A user-facing assistant normally uses the current User. Its tool calls are authorized and
  attributed to that User.
- An autonomous or independently permissioned Agent uses an Agent Actor and ordinary Membership.
- A host may deliberately use a System Actor for system-owned work.

An Agent Actor is persisted identity and authority. Inference is the reasoning operation. Keeping
them separate supports chat, generation, extraction, and structured decisions without inventing an
Actor for every model call.

## Dynamic tools

Tools are resolved before every model step and remain stable for that provider request. This makes
contextual tools natural: a host tool may be available on the first message, after a particular
result, or only in one interface. `AgentToolProvider` is the trusted host extension point.

```ts
const firstMessageTools: AgentToolProvider = {
  resolve(context) {
    if (context.step !== 1) return [];
    return [
      {
        id: "set_title",
        label: "Set title",
        description: "Set the conversation title.",
        input: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
        execute(input) {
          return saveTitle(input.title);
        },
      },
    ];
  },
};
```

Register trusted providers with `KernelOptions.agentTools`. Business capabilities usually remain
Actions or Rules so all callers share one implementation. Inference-only tools can live in a host
provider.

Action tool metadata may set `availability: "discoverable"`. Exposed Rules are discoverable by
default. When discoverable tools exist, Framework offers `search_tools`; matches are activated for
the next model step. Eager tools remain attached without requiring discovery. The resolver runs on
every step, but stable ordering and definitions produce the same serialized tool prefix, preserving
provider caching when the effective set has not changed.

A resolved `AgentToolSet` is a bound snapshot. The model can call only a tool offered in that step.
Immediately before execution, the Kernel resolves current availability and re-enters authorization.
If a tool was removed or authority was revoked, the runtime emits `tool_error`, adds that error to
the conversation, and allows the model to recover on the next step. Multiple calls from one model
step execute sequentially in emitted order.

## Action and Rule tools

Actions opt in with provider-neutral metadata:

```ts
const action = {
  key: "documents.publish",
  tool: {
    label: "Publish document",
    description: "Publish a reviewed document.",
    availability: "discoverable",
    keywords: ["release", "document"],
    input: {
      type: "object",
      properties: { documentId: { type: "string" } },
      required: ["documentId"],
      additionalProperties: false,
    },
  },
  run({ context, input }) {
    return publishDocument(context, input.documentId);
  },
};
```

Rules opt in through `expose: ["agent"]`. Disabled and unexposed Rules are absent. Short Rules
return their result; durable Rules return their execution identity and current status. Built-in
compact tools cover Source and View discovery, generic record operations, and View operations,
avoiding per-Collection CRUD definitions.

## Event contracts

An `InferenceAdapter` emits zero or more content, structured-output, tool-call, and usage events,
followed by exactly one of:

- `finished` with `stop`, `tool_calls`, `length`, `refusal`, or `content_filter`;
- `failed` with an `ErrorEnvelope`;
- `cancelled`.

No event may follow that terminal inference event.

An `AgentRuntime` emits `started` first, monotonically numbered steps, their streamed content and
tool activity, then exactly one turn terminal: `completed`, `refused`, `failed`, or `cancelled`.
Completed model steps emit `step_finished`; provider failure or cancellation terminates the active
step directly. No event may follow the turn terminal. `collectAgentRun` validates this terminal
contract and returns the completed JSON value.

## Rules and transports

`agents.run` is a built-in Action. A Rule inherits its current Actor by default. It uses a semantic
`runAs` binding when it should run as an independently permissioned Agent; the host resolves the
binding to an Agent Actor without placing concrete Actor IDs in portable Spec.

An embedded host can consume the async stream directly. A server host resolves the authenticated
Actor, runs the Kernel, and frames events for its transport. Conversation storage and bounded
history are host state; provider credentials are resolved by trusted host infrastructure rather
than stored in portable Spec.

Deterministic tests cover identity, authorization, discovery, changing tool availability, ordering,
and event contracts. Behavioral model evals belong beside a concrete adapter.
