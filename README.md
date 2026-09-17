# Framework

Framework is a portable information-system specification and its reference TypeScript Kernel.

Builder.run is its first host. Teamloop and future products can use the same primitives while providing their own host, modules, persistence, and deployment environment.

The portable Spec is the product contract. The TypeScript Kernel is one consumer of that contract, not a requirement for consumers implemented with Laravel, WordPress, or another stack.

The Kernel depends on persistence contracts, not a database. The package includes an in-memory
adapter for tests and ephemeral use, plus a normalized SQLite catalog behind a driver-neutral
gateway. Node.js is one optional SQLite driver; browser hosts can provide another.

## Status

Greenfield and pre-release. Phases 0–3 and the core Phase 4 contracts are implemented: the Kernel can apply portable
Collection Specs and perform validated record CRUD through interchangeable memory and SQLite
adapters, bind live filtered Attachments between Workspaces with revocation, query local or
attached Sources through Views, resolve lazily loaded Block renderers, submit Forms, and read
portable Page layouts. Builder has an executable S1 projection and browser SQLite bridge; editor/runtime migration is still in progress. There is no
backwards-compatibility contract with the current Builder.run runtime.

Workspace is the sole Kernel place. Root and parent columns group Workspaces without
inheriting permissions. Actors are issued in a Workspace; persisted Memberships determine
where they may act. There is no Kernel Account. See the [architecture](docs/architecture.md)
for identity, roster, and host terminology.

## Development

```bash
vp install
vp check
vp test
vp pack
```

Start with the [framework documentation](docs/README.md).

See [Sources, Views, and Blocks](docs/sources-views-blocks.md) for the data-to-presentation boundary.
See [Forms and Pages](docs/forms-pages.md) for the portable surface contracts.
See [Svelte UI and Studio](docs/svelte.md) for component ownership and customization boundaries.
The full Collection, View, Form, Rule and Page editors are reusable Studio exports;
see [editor contracts](docs/studio-editors.md) for host wiring and the remaining canonical runtime integration boundary.
