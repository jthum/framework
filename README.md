# Framework

Framework is a portable information-system specification and its reference TypeScript Kernel.

Builder.run is its first host. Teamloop and future products can use the same primitives while providing their own host, modules, persistence, and deployment environment.

The portable Spec is the product contract. The TypeScript Kernel is one consumer of that contract, not a requirement for consumers implemented with Laravel, WordPress, or another stack.

The Kernel depends on persistence contracts, not a database. The package includes an in-memory
adapter for tests and ephemeral use, plus a normalized SQLite catalog behind a driver-neutral
gateway. Node.js is one optional SQLite driver; browser hosts can provide another.

## Status

Greenfield and pre-release. Phases 0–2 are implemented: the Kernel can apply portable
Collection Specs and perform validated record CRUD through interchangeable memory and SQLite
adapters, and bind live filtered Attachments between Workspaces with revocation. There is no
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
