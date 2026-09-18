# Host architecture

A host turns Framework primitives into a product. Framework provides composable layers; it does
not require one deployment shape.

## Recommended composition

```text
product shell and domain modules
        |             |
 Svelte Studio   custom surfaces
        \             /
       WorkspaceClient
              |
            Kernel
       /       |       \
persistence  policy  environment
```

For an embedded or local application, `createWorkspaceClient(kernel, context)` is the simplest
path. For a remote application, implement `WorkspaceClient` over a transport and keep the Kernel
on the trusted server. The browser must never choose a trusted `actorId`; authentication resolves
the Actor on the server.

## Host responsibilities

The host owns:

- authentication and session resolution;
- choosing the active Workspace and Actor;
- Kernel lifetime and request/process scope;
- persistence adapter and deployment environment;
- routes, navigation, layout, product vocabulary, and error presentation;
- application-specific Actions, Conditions, Sources, Blocks, and modules;
- Agent provider/model adapters, credentials, conversation storage, and stream transport;
- Spec import/export envelope and validation of host extensions;
- catalogs, template installation, registry trust, and optional library UI.

Framework owns portable validation and semantics, authorization choke points, built-in Actions,
logical persistence contracts, context-bound clients, and reusable editors.

## Adoption levels

| Need                              | Use                                                   |
| --------------------------------- | ----------------------------------------------------- |
| Portable configuration only       | `@jthum/framework/spec`                               |
| Reference execution               | Spec + Kernel + a persistence adapter                 |
| Transport-neutral application API | `WorkspaceClient`                                     |
| Reusable authoring                | granular `@jthum/framework/svelte/studio/*` imports   |
| Fully custom interface            | canonical Spec and client contracts, without Studio   |
| Another language/runtime          | implement the documented Spec semantics independently |

An optional `AgentRuntime` is another injected Kernel port, not a provider SDK embedded in the
Kernel. See [Agents](agents.md) for the ownership boundary.

## Persistence

`PersistenceAdapter` exposes logical catalog, record, and execution storage. SQL belongs inside SQL
adapters. A host may use the included in-memory adapter, a SQLite gateway, or another adapter that
passes the shared contracts. Analytics engines may sit beside primary persistence as Sources; they
do not have to replace transactional storage.

## UI and code splitting

Framework's Svelte components inherit semantic tokens from the host. Import full editors from
granular subpaths so route-level code remains lazy:

```ts
import PageEditor from "@jthum/framework/svelte/studio/page-editor";
```

Use the aggregate Studio barrel only when eager loading the complete authoring surface is
intentional. Block renderers and their dependencies load through `BlockRegistry` only when asked.

## Administrative boundaries

Ordinary surfaces should receive `WorkspaceClient` or a narrower interface. Trusted composition
code may use the Kernel for Workspace creation, Memberships, and Attachments, and may compose
Catalog objects separately. Do not expose persistence repositories or root-wide discovery directly
to untrusted clients.
