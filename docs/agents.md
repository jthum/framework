# Agents

An Agent is an ordinary `Actor` with `kind: "agent"`. `AgentRuntime` is the provider-neutral port
that lets that Actor reason, stream output, and invoke authorized Framework operations. Model SDKs,
provider credentials, and tool-loop implementations remain optional adapter concerns.

## Code map

- Runtime contract and event stream: [`src/kernel/agent-runtime.ts`](../src/kernel/agent-runtime.ts)
- Kernel composition and tool projection: [`src/kernel/kernel.ts`](../src/kernel/kernel.ts)
- Action opt-in metadata: [`src/kernel/action-registry.ts`](../src/kernel/action-registry.ts)
- Context-bound client: [`src/client/workspace-client.ts`](../src/client/workspace-client.ts)
- Deterministic behavior tests: [`src/kernel/agent-runtime.spec.ts`](../src/kernel/agent-runtime.spec.ts)

## Ownership

Framework owns:

- Agent identity, Workspace Membership, and authorization;
- compact tool projection from opted-in Actions and `expose: ["agent"]` Rules;
- stable tool IDs and a small JSON-compatible input-schema vocabulary;
- routing tool calls back through ordinary Action, Rule, record, Source, and View checks;
- a provider-neutral event stream and context-bound client methods.

The host or an optional adapter owns:

- model and provider selection;
- credentials and secret lookup;
- translating Framework tool IDs and schemas to provider-specific function formats;
- the model/tool loop, retries, token policy, and provider-specific errors;
- conversation storage, truncation, retrieval, and user-facing chat state;
- transport framing for remote streams.

No model SDK or schema library is a dependency of the Spec or Kernel. An adapter may use either
internally without making it part of Framework's public contract.

## Install a runtime

Implement the small port and inject it when opening the Kernel:

```ts
import type { AgentRunEvent, AgentRuntime, AgentRuntimeRequest } from "@jthum/framework/kernel";
import {
  defineEnvironmentProfile,
  Kernel,
  LOCAL_BROWSER_ENVIRONMENT,
} from "@jthum/framework/kernel";

class RuntimeAdapter implements AgentRuntime {
  async *run(request: AgentRuntimeRequest): AsyncIterable<AgentRunEvent> {
    // A real adapter passes request.messages and request.tools to its provider.
    // When the provider requests a tool, call request.invokeTool(toolId, input).
    yield { type: "completed", output: { message: "Ready" } };
  }
}

const kernel = await Kernel.open({
  persistence,
  environment: defineEnvironmentProfile({
    ...LOCAL_BROWSER_ENVIRONMENT,
    agentRuntime: true,
  }),
  agentRuntime: new RuntimeAdapter(),
});
```

The explicit environment capability prevents a deployment from appearing to support Agents merely
because a runtime object was accidentally present. `Kernel.runAgent` and `AgentClient.runAgent`
return an `AsyncIterable<AgentRunEvent>` so embedded and server transports can preserve streaming.
`collectAgentRun` is the convenience for callers, such as Rules, that need one final JSON value.

## Bind identity and authority

Create an Agent Actor and add an ordinary Membership. The Membership—not the model, prompt, or
runtime adapter—defines its ceiling. `runAgent` rejects User and System Actors.

The projected tool list is not an authority grant. Every invocation re-enters the existing Kernel
path. For example, `records.create` still checks create permission for its concrete Collection. A
read-only Agent may discover the generic record tool but cannot use it to write.

Built-in compact tools include Source and View discovery, generic record operations, and View
query/snapshot operations. `sources.list` exposes stable Source and Field IDs only when requested,
which avoids generating CRUD tool definitions for every Collection on every turn.

## Expose custom Actions and Rules

Custom Actions opt in with provider-neutral tool metadata:

```ts
const actions = [
  {
    key: "documents.publish",
    tool: {
      label: "Publish document",
      description: "Publish a reviewed document.",
      input: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
        additionalProperties: false,
      },
    },
    async run({ context, input }) {
      // Validate input and authorize the concrete domain resource here.
      return publishDocument(context, input.documentId);
    },
  },
];
```

Actions without `tool` remain callable by Rules and direct Action consumers but are not offered to
Agents. An exposed Rule is explicit portable configuration:

```ts
{
  id: "…",
  key: "approve_expense",
  label: "Approve expense",
  expose: ["agent"],
  input: { expense: { sourceId: "…", required: true } },
  steps: [/* ordinary Rule steps */]
}
```

Disabled Rules and Rules not exposed to Agents are omitted. Rule inputs become tool inputs; Source
inputs accept runtime record IDs and continue through normal Source resolution. Short Rules return
their result immediately. Durable Rules return an execution ID and status rather than hiding a wait
inside the model call.

## Call an Agent from a Rule

`agents.run` is a built-in Action. Since Rules inherit their triggering Actor, a Rule that needs an
Agent uses an explicit semantic `runAs` binding:

```ts
{
  id: "ask-agent",
  action: {
    key: "agents.run",
    runAs: "support_agent",
    as: "answer",
    input: {
      messages: [{ role: "user", content: { $ref: "vars.prompt" } }]
    }
  }
}
```

The host resolves `support_agent` to an Agent Actor in that Workspace. Current Membership and
operation permissions are checked at execution time. The semantic binding keeps concrete Actor IDs
out of the portable Spec.

## Streaming and remote hosts

For an embedded host, `createWorkspaceClient` forwards the stream directly. For a remote host, a
trusted server resolves `{ workspaceId, actorId }`, calls the Kernel, and translates events to its
streaming transport. A browser must never select a trusted Agent Actor ID by itself.

`tool_call` and `tool_result` events are observational stream events emitted by the adapter. The
only authorized invocation path is the `request.invokeTool` callback supplied by the Kernel.
Conversation persistence is deliberately not Kernel state: a host may store it in its own module,
send only a bounded message window, or run an Agent without a chat surface at all.

Agent evals measure model behavior separately. Deterministic tests remain responsible for identity,
permission checks, tool projection, input validation, and event-stream contracts.
