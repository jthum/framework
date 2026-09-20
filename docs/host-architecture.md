# Host architecture

A host turns Framework primitives into a product. Framework provides composable layers; it does
not require one deployment shape.

## Recommended composition

```text
product shell and domain modules
        |             |
 Svelte interfaces   custom surfaces
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
the Actor on the server. See [local and remote deployment](deployment-modes.md) for the composition
boundary and app-owned module clients.

## Host responsibilities

The host owns:

- authentication and session resolution;
- choosing the active Workspace and Actor;
- Kernel lifetime and request/process scope;
- persistence adapter and deployment environment;
- routes, navigation, layout, product vocabulary, and error presentation;
- application-specific Actions, Conditions, Sources, Blocks, and modules;
- Agent provider adapters, credential resolution, conversation storage, and stream transport;
- Spec import/export envelope and validation of host extensions;
- catalogs, template installation, registry trust, and optional library UI.

Framework owns portable validation and semantics, authorization choke points, built-in Actions,
logical persistence contracts, context-bound clients, and reusable editors.

## Adoption levels

| Need                              | Use                                                                    |
| --------------------------------- | ---------------------------------------------------------------------- |
| Portable configuration only       | `@jthum/framework/spec`                                                |
| Reference execution               | Spec + Kernel + a persistence adapter                                  |
| Transport-neutral application API | `WorkspaceClient`                                                      |
| Reusable authoring                | granular `@jthum/framework/svelte/authoring/*` imports                 |
| Fully custom interface            | canonical Spec and client contracts, without Framework Svelte surfaces |
| Another language/runtime          | implement the documented Spec semantics independently                  |

An optional `InferenceRuntime` supplies a complete inference run. A host may use YAIR, a bridge to
another inference library, or its own implementation without changing Kernel semantics. See
[Inference and Agents](agents.md).

## Persistence

`PersistenceAdapter` exposes logical catalog, record, and execution storage. SQL belongs inside SQL
adapters. A host may use the included in-memory adapter, a SQLite gateway, or another adapter that
passes the shared contracts. Analytics engines may sit beside primary persistence as Sources; they
do not have to replace transactional storage.

The optional `@jthum/framework-sqlite-browser` package supplies a worker-backed browser driver. It
prefers OPFS and falls back to IndexedDB or memory. The package owns browser SQLite mechanics only;
the host still chooses its namespace and database routing policy. Server hosts can use
`@jthum/framework/sqlite/node` or provide any other `SqliteDatabase` implementation.

### Optional SQLite record databases

`SqlitePersistenceAdapter` accepts optional `workspaceDatabases` and `scopeDatabases` callbacks.
Without either, records live in the catalog database. With `workspaceDatabases`, each Workspace's
records live in its own database; scope-local tables co-locate there unless `scopeDatabases` selects
separate storage. Scope-only routing is also supported. Workspace definitions, Actors, Memberships,
Attachments, scope configuration, subscriptions, and executions remain in the central catalog.
Physical placement does not grant access: cross-Workspace sharing still uses explicit Attachments,
which query the origin Workspace's record database without copying its data.

Relationship queries across routed SQLite files use SQLite `ATTACH` for the duration of a read.
Each routed `SqliteDatabase` handle therefore supplies its stable `name` (the same name passed to
its gateway when opened). An in-memory SQLite handle with no attachable name can still serve local
queries, but cannot join records in another independent in-memory handle. Attachment filters and
row policies remain query restrictions regardless of physical placement.

```ts
const persistence = new SqlitePersistenceAdapter(openCatalogDatabase, {
  workspaceDatabases: {
    open: ({ workspaceId }) => openWorkspaceDatabase(workspaceId),
    remove: ({ workspaceId }) => removeWorkspaceDatabase(workspaceId),
  },
  scopeDatabases: {
    open: ({ workspaceId, scope }) => openLocalDatabase(workspaceId, scope.kind, scope.id),
    remove: ({ workspaceId, scope }) => removeLocalDatabase(workspaceId, scope.kind, scope.id),
  },
});
```

These are host-provided functions; Framework does not choose filesystem paths, OPFS names, or
database credentials. Resolve a stable, distinct database for each Workspace/kind/id tuple. Never
route by renameable Collection keys. An ownership marker rejects accidentally reused scope files
and catalog files. Persisted layout selection rejects opening an existing database in a different
mode; changing layouts is an explicit data-transfer concern, not a compatibility path.

Record databases open on demand for schema/data operations and cleanup. Metadata-only creation
does not open one. Handles are cached for the session and closed on session close or database
cleanup. A scope containing only Pages or Rules needs no dedicated record database.
`remove` is optional: without it, cleanup removes tables but retains the empty database.
If supplied, removal must tolerate retries and already-missing storage. The host owns WAL/sidecar
cleanup where its gateway requires it. Shared Collections are not copied into each scope database.

Multi-database schema changes use a small forward-recovery journal. The adapter records an accepted
operation, applies local schema/seed changes transactionally, publishes central configuration and
subscriptions, finishes cleanup, then clears the journal. A failure may leave the change pending;
reopening with the same routing completes it before returning a session. Initial records replay
idempotently. Record operations and further lifecycle changes reject pending recovery instead of
using a partly changed schema. Single-database changes retain their existing atomic transactions.

This is not a cross-database transaction for arbitrary Actions. A routed session serializes its
record/lifecycle operations. A multi-process host must coordinate schema changes, recovery/opening,
and affected requests with an application-level maintenance barrier or single lifecycle writer;
separate live sessions are not a distributed locking protocol. Persistence catalog/Scope stores are
trusted ports: change scoped configuration through `applyScopeConfig`/`deleteScope`, not direct
metadata writes. Workspace Specs use `applyWorkspaceSpec`. Direct `RecordStore.applySchema` manages
unscoped schemas in the configured Workspace record database (or central database in single mode).

Executable behavior: [routing and recovery tests](../src/sqlite/database-routing.spec.ts) and
[shared scope contracts](../src/kernel/scopes.spec.ts).

## UI and code splitting

Framework's Svelte components inherit semantic tokens from the host. Import full editors from
granular subpaths so route-level code remains lazy:

```ts
import PageEditor from "@jthum/framework/svelte/authoring/page-editor";
```

Use the aggregate authoring barrel only when eager loading the complete authoring surface is
intentional. Block renderers and their dependencies load through `BlockRegistry` only when asked.

## Administrative boundaries

Ordinary surfaces should receive `WorkspaceClient` or a narrower interface. Trusted composition
code may use the Kernel for Workspace creation, Memberships, and Attachments, and may compose
Catalog objects separately. Do not expose persistence repositories or root-wide discovery directly
to untrusted clients.
