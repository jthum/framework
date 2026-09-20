# Coding-agent guide

This guide helps a coding agent build on or contribute to Framework without guessing its contracts.
It concerns software-development agents. Runtime AI Agents are documented separately in
[Agents](agents.md).

Canonical source repository: [github.com/jthum/framework](https://github.com/jthum/framework).
A host may provide a local checkout for faster source inspection; use the path supplied by that
host rather than assuming a relative filesystem location.

## Working in a consuming application

Read only the path needed for the task:

1. [Building a host](building-a-host.md) for composition and ownership.
2. [Core concepts](concepts.md) for portable versus instance data.
3. [Domain modules](domain-modules.md) when the product owns intrinsic entities.
4. The relevant capability guide from the [documentation router](README.md).
5. [Public API and code map](public-api.md) to find exact exports, source, and tests.

TypeScript exports and behavioral tests are authoritative for exact shapes. Guides explain intent,
ownership, and constraints. Before inventing a wrapper or alternate data model, inspect the linked
contract and its tests.

### Copyable host instruction

```text
Framework source: https://github.com/jthum/framework

Before implementing Framework-backed behavior:
- Read docs/building-a-host.md and the relevant capability guide in Framework source.
- Use docs/public-api.md to locate the authoritative exported symbol and behavioral tests.
- Keep direct Kernel, persistence, and concrete driver imports inside composition roots.
- Keep intrinsic product entities behind domain-owned clients; do not force them into Collections.
- Use canonical Specs and public clients rather than creating parallel persisted shapes or mutations.
- Preserve portable/instance boundaries and derive trusted Actor identity on the server.
- Prefer granular Svelte imports and lazy optional dependencies.
- Run the consuming application's checks, deterministic tests, and relevant integration smoke.
```

If the host supplies a local Framework checkout, inspect it directly. If it supplies only a pinned
Git revision, consult that revision rather than the default branch so source and installed behavior
cannot diverge.

## Source-first lookup

Use these stable entry points instead of searching the entire repository blindly:

| Question                                | Start at                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------- |
| What can a host import?                 | [`docs/public-api.md`](public-api.md) and [`package.json`](../package.json)                  |
| What is portable Spec data?             | [`src/spec/model.ts`](../src/spec/model.ts) and Spec validation tests                        |
| What can UI or transport call?          | [`src/client/workspace-client.ts`](../src/client/workspace-client.ts)                        |
| Where is runtime behavior orchestrated? | [`src/kernel/kernel.ts`](../src/kernel/kernel.ts) and focused Kernel services                |
| What must an adapter implement?         | [`src/persistence`](../src/persistence) and shared contract suites                           |
| How does SQLite differ physically?      | [`src/sqlite`](../src/sqlite) and adapter-specific tests                                     |
| What can Svelte editors accept?         | component props under [`src/svelte`](../src/svelte) and [Authoring](authoring.md)            |
| How do optional packages work?          | the package's `README.md`, `package.json`, source, and tests under [`packages`](../packages) |

## Decision rules

- Portable, language-neutral system meaning belongs in the Spec or Kernel.
- Physical storage behavior belongs in an adapter.
- Environment, authentication, navigation, and product language belong in the host.
- Intrinsic product entities and their invariants belong in a domain module.
- Reusable Svelte capability UI belongs under the matching Svelte taxonomy only when it has no host
  session, router, or persistence dependency.
- An optional dependency belongs in an optional package; do not make it a core dependency for
  convenience.
- Unknown `meta` is annotation space, not an unvalidated behavior protocol.
- A missing cross-layer capability should become an intentional public contract, not a private
  import around the boundary.

## Working on Framework itself

Start with the repository `AGENTS.md`, then [Developing Framework](developing-framework.md),
[Architecture](architecture.md), [Coding standards](coding-standards.md), and
[Testing](testing.md). Locate the existing contract suite before changing an implementation.

Do not update prose merely to legitimize accidental behavior. When a public contract changes,
update the contract, validation, all affected adapters, deterministic tests, public API map, and the
canonical guide together.

Framework is greenfield. Do not add compatibility aliases, dual reads/writes, or migration paths
unless an explicit compatibility policy is adopted.

## Keeping agent context small

- Begin with the documentation router and one capability guide.
- Load exact interfaces from source only when needed.
- Read the focused behavioral test before editing semantics.
- Link to canonical code rather than pasting large interfaces into host documentation.
- Record host-specific policy in the host repository, not in Framework docs.
- Escalate to architecture only when changing ownership or a public semantic contract.

This keeps coding-agent context precise while ensuring implementation decisions remain grounded in
the current source revision.
