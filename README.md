# Framework

Framework is a portable specification and reference TypeScript kernel for building configurable
information systems. It provides the shared language and runtime for Workspaces, Collections,
Views, Forms, Rules, Pages, Blocks, Actors, permissions, and live cross-Workspace Attachments.

The portable Spec is the contract. The TypeScript Kernel is one implementation of that contract;
another stack can consume the same Spec without importing this package.

## What you can use

- `@jthum/framework/spec` — portable definitions and validation
- `@jthum/framework/kernel` — the reference execution engine
- `@jthum/framework/client` — a context-bound interface for UI and transport layers
- `@jthum/framework/persistence` — persistence ports and the in-memory adapter
- `@jthum/framework/sqlite` — the driver-neutral SQLite adapter
- `@jthum/framework/blocks` — Block definitions and lazy renderer registry
- `@jthum/framework/catalog` — host-selected discovery catalogs
- `@jthum/framework/svelte/studio/*` — reusable Svelte 5 authoring surfaces
- `@jthum/framework/svelte/ui/*` — semantic Svelte UI primitives

Hosts may adopt the complete stack, use only the portable Spec, replace the Studio, or supply
their own persistence and transport implementations. Framework does not own application routing,
authentication, navigation, product vocabulary, or domain-specific modules.

## Status

Framework is greenfield and pre-release. The implemented surface includes:

- Workspace, Actor, Membership, ACL, and Attachment semantics;
- Collection schemas and validated record operations;
- local and attached Sources, Views, and declared relationship traversal;
- create, edit, and standalone Forms;
- Page layout trees and lazily loaded Blocks;
- short and durable Rules, Events, waits, and User requests;
- provider-neutral AI-assisted execution with authorized Action and Rule tools;
- interchangeable memory and SQLite persistence;
- reusable Svelte editors for Collections, Views, Forms, Rules, and Pages;
- inert catalogs for host-owned template and resource discovery.

There is currently no backwards-compatibility promise. Prefer one clean current contract over
aliases or migration baggage.

## Start here

- [Build an application](docs/getting-started.md)
- [Understand the core model](docs/concepts.md)
- [Choose package boundaries](docs/host-architecture.md)
- [Extend a host safely](docs/extensions.md)
- [Find public APIs and authoritative code](docs/public-api.md)
- [Integrate an Agent runtime](docs/agents.md)
- [Develop Framework itself](docs/developing-framework.md)
- [Browse all documentation](docs/README.md)

## Repository development

```bash
vp install
vp check
vp test
vp pack
```

The executable example in [`examples/minimal-host.ts`](examples/minimal-host.ts) is tested with the
library and mirrors the getting-started guide.
