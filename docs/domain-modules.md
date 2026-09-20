# Domain modules

A domain module owns product entities and behavior that should not be expressed as configurable
Framework Collections. Examples include conversations, media processing, presence, billing, or a
specialized collaborative document model.

Modules are ordinary host code, not a portable `ModuleDefinition` primitive or plugin container.
They integrate through existing Framework contracts where that adds value.

## What a module owns

A module may own:

- its entity types, invariants, and lifecycle;
- logical storage contracts and physical adapter;
- a transport-neutral client used by product interfaces;
- local and remote client implementations;
- Actions, Events, Conditions, Agent tools, and Rule integration;
- Source bindings when module data should participate in Views;
- Blocks and module-specific screens;
- optional module Spec inside the host document.

Framework continues to own Workspace identity, Actor context, portable definitions, authorization
choke points for Framework resources, and any Framework configuration selected for a scope.

## Client boundary

Define the smallest product-language contract needed by the interface:

```ts
interface ConversationClient {
  listChannels(): Promise<readonly Channel[]>;
  postMessage(channelId: string, body: string): Promise<Message>;
  watchChannel(channelId: string): AsyncIterable<ConversationChange>;
}
```

The local implementation can use module-owned browser storage. The remote implementation can call
an authenticated server and expose the same stream. Compose it beside `WorkspaceClient`; do not add
module methods to Framework's client merely to obtain one application API.

Authorization remains explicit. A module can call the host Authorizer or maintain additional
domain policy, but knowing a module entity ID never grants access. Pass the current
`ExecutionContext` through module Actions and Events so attribution is preserved.

## Integration choices

Use the least coupling that provides the feature:

| Need                                                 | Integration                                        |
| ---------------------------------------------------- | -------------------------------------------------- |
| Execute module behavior from Rules or UI             | register a typed Action                            |
| React to module activity                             | publish a named Event with Actor context           |
| Let Rules test domain state                          | register a Condition or pass explicit Event data   |
| Let an Agent invoke behavior                         | expose the Action directly as an authorized tool   |
| Display module data on authored Pages                | provide a Source and/or Block contract             |
| Attach configurable definitions to one module entity | select a Framework scope `{ kind, id }`            |
| Export module configuration                          | store a versioned module Spec in the host envelope |

An optional Framework scope does not take ownership of the module entity. Deleting scope
configuration deletes its local Framework configuration and records; module-entity deletion and
concurrency remain module responsibilities. Read the exact scope semantics and behavioral tests in
[Extensions](extensions.md#module-scope) and
[`src/kernel/scopes.spec.ts`](../src/kernel/scopes.spec.ts).

## Actions and Events

Actions are the shared mutation seam for interfaces, Rules, and Agents. A module Action declares
input, output, authorization, and execution behavior, then delegates to the module's logical
service. Do not copy the mutation into an endpoint, component, and Rule executor.

Events describe occurrences after a successful mutation. Include the effective Actor and enough
stable data for subscribers; do not expose database rows or transport objects. Rule subscriptions
are persisted by Framework, but the module owns how external stimuli reach its Action/Event seam.

Authoritative contracts:

- [`ActionDefinition`](../src/kernel/action-registry.ts)
- [`KernelOptions`](../src/kernel/kernel.ts)
- [Rule and Event semantics](rules.md)
- [inference tool projection](agents.md)

## Storage

Module tables may share a physical database with Framework or live in a separate database. That is
deployment policy, not entity ownership. Keep module queries behind the module's storage port so a
browser-local implementation can later be replaced with server SQLite, Postgres, Convex, or
another backend without changing the interface.

Framework database-per-scope routing applies only to Framework Collections selected for that
scope. It does not automatically route module-owned entities.

## Testing a module

Test the contract at three levels:

1. Pure domain tests for invariants and transitions.
2. A reusable client/store contract suite run against local and remote implementations.
3. Integration scenarios proving Action, Event, Rule, Actor, and optional scope propagation.

Browser storage and streaming receive focused integration smoke tests. Authorization and
validation stay deterministic; inference evals never replace them.

## Avoid these shortcuts

- Do not model intrinsic module entities as Collections solely to reuse CRUD.
- Do not import a concrete database into components.
- Do not treat a scope ID, parent Workspace, or Actor origin as authority.
- Do not hide module behavior in unvalidated Framework `meta`.
- Do not create a parallel Rule, tool, or mutation runtime when an Action integration suffices.
- Do not require every module operation to pass through `WorkspaceClient`.
