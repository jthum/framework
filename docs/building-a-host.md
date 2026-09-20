# Building a host application

A host application turns Framework capabilities into a product. This guide is the assembly map:
it explains which boundaries to create and where to find the authoritative contracts without
duplicating those contracts in prose.

For exact exports, source, and behavioral tests, use the [public API map](public-api.md). The
[minimal executable host](../examples/minimal-host.ts) demonstrates the smallest composition.

## Start with ownership

Classify each part of the product before writing storage or interface code:

| Concern                                                                         | Owner                               |
| ------------------------------------------------------------------------------- | ----------------------------------- |
| Portable Collections, Views, Forms, Pages, Rules, and Agent definitions         | Framework Spec                      |
| Workspaces, Actors, Memberships, Attachments, records, and executions           | Framework instance                  |
| Product entities with their own invariants and lifecycle                        | Host domain module                  |
| Authentication, routes, navigation, credentials, deployment, and product policy | Host shell                          |
| Physical tables, files, indexes, and connection behavior                        | Persistence adapter or module store |

A domain entity does not become a Collection merely because it has fields. If it is intrinsic to
the product and has its own protocol, storage, or live behavior, keep it in a
[domain module](domain-modules.md). Collections remain appropriate for configurable information
models authored through the portable Spec.

## Recommended host shape

```text
src/
  app/                 product session and route-level composition
  framework/           Kernel/client composition roots and Spec envelope
  modules/<name>/      domain contract, local/remote clients, storage, Actions, Events, UI
  routes/              product-owned navigation and screens
  lib/                  product components and utilities
```

Names are host policy. The important boundary is that ordinary interface code receives
`WorkspaceClient` or a narrower Framework client plus any module-owned clients. Only composition
roots import the Kernel or concrete persistence drivers.

```text
ApplicationSession
  framework: WorkspaceClient
  conversations: ConversationClient
  other module clients...
```

See the executable client behavior in
[`src/client/workspace-client.spec.ts`](../src/client/workspace-client.spec.ts) and the deployment
composition in [local and remote deployment](deployment-modes.md).

## Build in vertical slices

### 1. Define the exported document

Use one host-owned envelope containing the canonical Framework Spec and optional module Specs. The
envelope provides one import/export artifact while keeping host semantics out of Framework `meta`.
Follow [the extension contract](extensions.md#one-exported-document).

### 2. Choose persistence at the composition root

Use `MemoryPersistenceAdapter` for deterministic prototypes and tests. Use the driver-neutral
`SqlitePersistenceAdapter` for SQLite. Browser hosts can opt into
`@jthum/framework-sqlite-browser`; Node hosts can use `@jthum/framework/sqlite/node`. The host
chooses one database or routed Workspace/scope databases. See
[SQLite layouts](deployment-modes.md#sqlite-layouts).

Do not let database names, SQL connections, or adapter repositories escape into components or
domain contracts.

### 3. Bootstrap identity and bind a client

Bootstrap or resume the root Workspace and trusted Actor at the composition boundary. Bind ordinary
operations through `createWorkspaceClient`. In a remote deployment, authentication resolves the
Actor on the server; a browser never supplies a trusted Actor identity. Read the exact client
surface in [`src/client/workspace-client.ts`](../src/client/workspace-client.ts).

### 4. Register host capabilities

Register host-provided Actions and Conditions when opening the Kernel. Compose domain Events,
Blocks, catalogs, inference, and optional secrets deliberately. Keep credentials outside the Spec.
The relevant guides are [Rules and Actions](rules.md), [Agents](agents.md),
[Catalogs](catalogs.md), and [Sources, Views, and Blocks](sources-views-blocks.md).

### 5. Assemble product interfaces

Import reusable Svelte surfaces through granular paths so route-level capabilities remain lazy.
Supply canonical definitions, focused clients, callbacks, catalogs, and preview snippets. The host
owns the shell, navigation, route policy, and domain screens. Start with
[Svelte integration](svelte.md) and [authoring contracts](authoring.md); inspect component props in
the linked Svelte source when exact signatures matter.

### 6. Keep local and remote implementations interchangeable

Local clients call an in-process Kernel or module store. Remote clients implement the same
transport-safe contracts over the host's protocol. Streaming module behavior belongs on the module
client. Framework does not prescribe HTTP, WebSocket, RPC, authentication, or server topology.

## Simple and advanced paths

The simplest useful host needs one adapter, one Kernel, one Workspace, one client, and one Spec.
Optional capabilities should be added only when required:

| Requirement                        | Add                                                            |
| ---------------------------------- | -------------------------------------------------------------- |
| Browser durability                 | browser SQLite package                                         |
| Server persistence                 | Node SQLite or another adapter                                 |
| Product-owned entities             | domain module and module client                                |
| Cross-Workspace data               | Source binding plus Attachment                                 |
| Entity-local configurable behavior | optional Framework scope                                       |
| Reusable authored interface        | granular Framework Svelte capability                           |
| Custom product interface           | canonical definitions and clients without Framework Svelte     |
| AI execution                       | `InferenceRuntime`, ModelConfigs, Agents, and authorized tools |

## Host completion checklist

- The host document validates Framework and module sections separately.
- Only composition roots import Kernel, persistence, or environment-specific drivers.
- UI code depends on focused clients and canonical definitions.
- Product entities with intrinsic invariants remain module-owned.
- Mutations use Framework or module Actions rather than parallel UI implementations.
- Authentication-derived Actor identity is trusted only on the server boundary.
- Local and remote clients expose the same logical behavior.
- Specs contain no records, secrets, concrete Workspaces, or concrete Attachments.
- Optional heavy interfaces and Block renderers remain lazy.
- Deterministic tests cover module contracts; browser smoke covers actual browser storage.

When uncertain, locate the relevant symbol and its behavior test through
[public-api.md](public-api.md). Do not infer a contract from an editor label or one adapter's
physical schema.
