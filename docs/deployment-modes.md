# Local and remote deployment

An application can run Framework in the same browser process as its interface or keep the Kernel
on a trusted server. Portable Specs, module contracts, and interface components should not change
between those deployments.

## Two compositions

```text
local
interface -> WorkspaceClient -> Kernel -> browser persistence

remote
interface -> remote WorkspaceClient -> authenticated server -> Kernel -> server persistence
```

`createWorkspaceClient(kernel, context)` is the local implementation. A remote implementation
provides the same client capabilities over a host-selected transport. Authentication on the server
derives the Actor; a remote caller never supplies a trusted Actor identity.

Server rendering is independent of this choice. A client-rendered interface may use a remote
Kernel, and a server-rendered route may still hydrate into the same remote clients.

## Framework and module clients

`WorkspaceClient` exposes Framework-owned capabilities. It includes focused interfaces for
Workspace management, Memberships, Attachments, scope configuration, Rules, inference, and ordinary
Spec-backed data. A host-owned domain module keeps its own storage, invariants, and client contract.
It composes beside the Framework client rather than masquerading as a Collection:

```ts
interface ConversationClient {
  listChannels(): Promise<readonly Channel[]>;
  postMessage(channelId: string, body: string): Promise<Message>;
  watchChannel(channelId: string): AsyncIterable<ConversationChange>;
}

interface ApplicationSession {
  readonly framework: WorkspaceClient;
  readonly conversations: ConversationClient;
}
```

The local composition may implement `ConversationClient` against module-owned local tables. The
remote composition implements it over the same transport used by the application server. Framework
does not require every module operation to pass through `WorkspaceClient`.

A module may still integrate deliberately by registering Actions and Conditions, publishing domain
Events, exposing agent tools, or selecting an opaque Framework scope. A scope such as
`{ kind: "channel", id }` may own optional local Pages, Rules, Forms, Views, or Collections; the
channel and its messages remain module-owned instance data.

## Composition boundary

Ordinary interface and module code should depend on client contracts. Restrict direct imports of
`@jthum/framework/kernel`, persistence adapters, and SQLite drivers to a local/server composition
root. This keeps a later deployment change concentrated in startup code.

The host owns:

- authentication and login-identity-to-Actor resolution;
- Kernel and persistence lifetime;
- transport, request routing, streaming, and live module updates;
- module-owned storage and migrations;
- filesystem paths, database backup, and deployment policy.

Framework owns:

- portable definitions and validation;
- Kernel semantics and authorization choke points;
- context-bound Framework client contracts and their local implementation;
- persistence ports and reference adapters;
- reusable Svelte capability surfaces.

## SQLite layouts

The SQLite adapter works in either deployment. The host can use one database, route records to one
database per Workspace, and optionally route scope-local Framework records to separate databases.
Those callbacks choose OPFS names in a browser or filesystem paths on a server. Module-owned tables
may use their own database layout; Framework scope databases do not prescribe module storage.

A single server process can keep one long-lived Kernel and serve multiple authenticated Actors.
Multiple server processes require host coordination for lifecycle changes and recovery, as
described in [host architecture](host-architecture.md#optional-sqlite-record-databases).

## Live updates

Transport-neutral request contracts do not imply a universal real-time protocol. A module that is
intrinsically live should put its stream or subscription operation on its own client contract, as
in `watchChannel` above. Framework query screens should centralize refresh/invalidation in the host
rather than assume that the browser performed every mutation. A shared Framework change-feed
contract should be introduced only when its cross-adapter semantics are proven by a remote host.
