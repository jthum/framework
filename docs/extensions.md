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
one Workspace. Bind a local Collection through `Kernel.bindCollection(context, key, scope)`, or
the registered `collections.bind` Action with `{ collectionId, scope }`. Passing `null` removes
the binding. Binding requires manage permission; `listCollectionScopes` is also a management read.

Bindings are instance data in `PersistenceSession.scopes`, never part of exported Spec. The current
model binds each Collection to one entity, rather than adding hidden scope columns to records.
Hosts create separate Collection definitions when separate entities need separate record sets.
Collection key renames preserve the binding; deleting a Collection or Workspace removes it.

Scoped Collections require an exact matching kind/id context for local record operations and
Source queries. Source and View listings omit other scopes. Unbound Collections remain available
in scoped contexts, so topic-local data can reference shared workspace-local data. Relationships
use the same scope checks. A context-bound WorkspaceClient carries the selection into existing
Forms, Views, Pages, and Studio surfaces; Rules, domain Events, and durable executions retain it.

Scope is selection, not authority. A host must authenticate and authorize domain access through
its Authorizer; a caller knowing a topic ID does not acquire permissions. Module trees and entity
lifecycle remain module-owned. Deleting a module entity should explicitly remove its bindings or
Collections. An Attachment is explicit cross-Workspace sharing and does not require the recipient
to select the origin's module entity.

Behavioral source of truth: [scope contracts](../src/kernel/scopes.spec.ts) and
[SQLite persistence tests](../src/sqlite/catalog.spec.ts).
