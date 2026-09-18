# Workspace client

`@jthum/framework/client` exposes `WorkspaceClient`, a context-bound contract for interface code, and `createWorkspaceClient(kernel, context)`, its in-process implementation.

```ts
const client = await createWorkspaceClient(kernel, { workspaceId, actorId });
const views = await client.listViews();
const result = await client.queryView("invoices", {
  parameters: { status: "overdue" },
});
```

View parameters are declared in the portable View definition. The client does not accept an
arbitrary extra filter language at this boundary.

Binding validates and copies the execution context. Every operation still goes through the Kernel's current membership and authorization checks; binding is not an access grant or permission cache. Clients cannot close the Kernel or change their Actor. The host owns Kernel lifetime and creates a new client when the active Workspace or Actor changes.

On a server, authentication supplies the Actor. Resolve the client's Workspace selection against that trusted identity; never trust a browser-supplied Actor ID. A remote implementation can implement the same interface over a transport, while the server continues to derive the execution context itself. No HTTP transport or authentication provider is implemented by this contract.

The contract currently covers Workspace Spec, local records, Sources, Views, Forms, Pages and
durable Rule execution. Catalog administration and Attachment management remain explicit Kernel
operations; do not expose trusted persistence discovery APIs through a client. Attachment Sources
are readable through Source operations, not writable local Collections.

`executeAction(key, input)` and `runRule(key, input)` expose the same context-bound Action/short
Rule spine. An Action-published Event runs matching short Rules; authorization is checked for
the Action and its actual record operations. Use `startRule` for a durable wait or User request.
Published Events still reject durable-only subscribers in the short runner; this does not imply
automatic durable dispatch or a scheduler.

`launchRule(client, key, input)` is an optional convenience for UI/tool callers: it reads current
definitions, follows nested invocations, and chooses the short runner or durable execution.
Its result is `{ mode: "short", run }` or `{ mode: "durable", execution }`. Short runs do not
create history entries; durable runs return a persisted run ID. Unavailable durable execution
fails explicitly rather than falling back. The explicit APIs remain available to advanced hosts.

The built-in read Actions are `records.list`, which accepts a stable `sourceId` and optional
canonical Source `query`, and `views.query`, which accepts a stable `viewId` and declared
`parameters`. Both return record-like values and enforce the same Source/View authorization and
query validation as direct client calls. They exist so structured Rules can compose reads without
inventing a second query runtime.

Local `createRecord`/`updateRecord`/`deleteRecord` are deliberately quiet CRUD primitives. For
an interactive write that should trigger automations, call the corresponding record Action with
stable `sourceId`, `recordId` and `values`, or submit a Form. Create/edit Form intake shares the
Action mutation/event implementation and publishes `record.created` or `record.updated` plus
effective field changes before `form.submitted`. Standalone Forms publish only `form.submitted`.
Event handlers run after a successful write; a later Rule failure does not roll that write back.

`RuleExecutionClient` is the smaller execution-only contract implemented by `WorkspaceClient`.
It includes start/resume, paginated run summaries, selected run details, assigned ActorRequests,
responses, and explicit termination. Components can accept this smaller port when they need no
record/schema APIs. The local implementation returns public projections, not opaque continuation
frames. History lists only runs started by the bound Actor in the bound Workspace, with a default
page size of 20 and an enforced maximum of 100. Inspecting another Actor's execution still requires
management permission. Request responses return the request, never the initiating Actor's run data.

This layer does not translate legacy definitions or add another mutation implementation. UI editors can accept the interface rather than importing a concrete Kernel, persistence adapter, or global application session.
