# Extending a host

Framework keeps the core Spec portable while allowing a host to add real domain capabilities.

## One exported document

A host may wrap the Framework Spec in one consolidated, versioned document:

```ts
interface HostDocument {
  readonly format: "example.application";
  readonly version: 1;
  readonly framework: Spec;
  readonly modules?: {
    readonly conversations?: ConversationModuleSpec;
  };
  readonly meta?: Record<string, JsonValue>;
}
```

Users still import and export one document. Framework validates `framework`; the host validates its
envelope, module definitions, and cross-references. Domain behavior should not be hidden in
Framework `meta` merely to avoid defining a proper host contract.

Use `meta` for optional JSON-compatible annotations that consumers may preserve without
understanding: icons, folder hints, provenance, or adapter conventions. Unknown metadata must not
alter core Framework semantics.

## Domain modules

A module can contribute:

- Actions and Conditions registered when opening the Kernel;
- Event contracts used by Rules;
- host-owned data integrations, with portable Source bindings where supported;
- Block definitions and lazy renderers;
- host-owned module Spec and runtime state;
- custom routes, screens, and invariants.

Module entities need not become new Framework primitives. Prefer composing the small shared
primitives and keep domain invariants in module code.

Custom Source-provider registration is not yet a public Kernel extension point. A host may expose
external data through its own client or module boundary today; a future provider contract must
retain capability discovery and the existing View semantics.

## UI extension

Hosts can customize progressively:

1. override semantic CSS variables;
2. pass supported classes, callbacks, and snippets;
3. compose lower-level Studio controls;
4. replace a full editor while persisting the same canonical definitions.

There is no global component override registry. Explicit Svelte composition keeps imports
tree-shakeable and host policy visible.

## Catalog extension

Catalogs combine host-selected metadata sources for Blocks, Fields, Pages, or complete application
templates. The host decides which sources are trusted, how entries are installed, and whether a
catalog UI exists. Catalogs do not load remote code or mutate the Spec by themselves.

## Adding a new portable primitive

Do this only when the concept has stable, cross-host semantics that cannot be represented through
existing definitions, module code, or a host envelope. A new primitive requires:

- language-neutral Spec semantics and runtime validation;
- reference and rename behavior;
- authorization and persistence boundaries;
- conformance fixtures for alternate consumers;
- editor treatment only if a reusable interface is justified.

This threshold keeps simple hosts small without preventing advanced products from extending the
system deliberately.

## Module scope

A host selects an optional `ExecutionContext.scope` handle `{ kind, id }` for a domain entity inside
one Workspace. `Kernel.getScopeConfig` reads optional scope-local Collections, Views, Forms, Pages,
and Rules. `applyScopeConfig` replaces this configuration and requires manage permission.
Reading an empty scope does not create configuration or record tables.

Scope configuration is instance data in `PersistenceSession.scopes`, separate from the portable
Workspace Spec. A selected context composes Workspace definitions with exactly that scope's local
definitions. Sibling scopes may reuse semantic keys but must use distinct definition IDs. Local
and Workspace keys must not collide; validation rejects ambiguous names instead of shadowing.

Local definitions are available only in the selected scope. Workspace Collections remain available,
so local records may reference shared data. A context-bound WorkspaceClient carries the selection
into Forms, Views, Pages, and Studio surfaces; Rules, domain Events, and durable executions retain
it. Persisted subscriptions select Workspace and current-scope event Rules, never sibling scopes.
Definitions are still loaded from their configuration; this index is not a compiled Rule cache.

For one shared Tasks Collection with topic-related rows, register an optional `RecordPolicy` by
Collection ID through `KernelOptions.recordPolicies`. It checks reads and writes, including Source
queries and relationship lookup. Read filtering occurs before aggregation and pagination. Write
checks receive the current row and proposed values, so a policy can reject moving a task into
another topic. Ordinary Collections require no policy. Current adapters filter reads in memory;
this is not database query pushdown.

Scope is selection, not authority. A host must authenticate and authorize domain access through
its Authorizer; a caller knowing a topic ID does not acquire permissions. Module trees and entity
lifecycle remain module-owned. `deleteScopeConfig` removes local configuration and its data, but
rejects deletion while a scoped durable execution is running or waiting. Hosts must coordinate
module-entity deletion and concurrent operations. An Attachment is explicit cross-Workspace
sharing; origin policies still apply and may reject access without the required origin context.

SQLite defaults to one database and optionally routes scope-local records to separate databases.
See [SQLite scope databases](host-architecture.md#optional-sqlite-scope-databases) for callbacks,
forward recovery, and host coordination. The logical Scope contract does not prescribe layout.

Behavioral source of truth: [scope contracts](../src/kernel/scopes.spec.ts) and
[SQLite persistence tests](../src/sqlite/catalog.spec.ts).
