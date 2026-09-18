# Developing Framework

This guide is for changing Framework itself. Application authors should begin with
[Getting started](getting-started.md).

## Before changing a contract

1. Identify the layer that owns the behavior.
2. Read the relevant capability guide and [architecture](architecture.md).
3. Check the dependency direction in [coding standards](coding-standards.md).
4. Find the existing contract or conformance suite before adding another path.
5. Decide whether the change is portable Framework behavior or host/module policy.

Do not promote a host convenience into the Kernel merely because multiple screens need it. Do not
leave a missing cross-layer capability in host code merely to avoid changing a public contract.

## Change map

| Change                         | Primary location                        | Required companion work                           |
| ------------------------------ | --------------------------------------- | ------------------------------------------------- |
| Definition shape or validation | `src/spec`                              | conformance tests, docs, reference handling       |
| Runtime semantics              | `src/kernel`                            | authorization, failure paths, deterministic tests |
| Logical storage contract       | `src/persistence`                       | shared contract suite and every adapter           |
| SQLite behavior                | `src/sqlite`                            | adapter-specific tests plus shared contracts      |
| Context-bound API              | `src/client`                            | local implementation and remote-safe semantics    |
| Block metadata/loading         | `src/blocks`                            | lazy-loading and failure/retry tests              |
| Catalog discovery              | `src/catalog`                           | provenance, filtering, defensive-copy tests       |
| Reusable UI                    | `src/svelte/studio`                     | public injection contract and focused tests       |
| UI primitive/theme             | `src/svelte/ui`, `src/svelte/theme.css` | accessibility and semantic-token review           |

## Public contract checklist

For a public change, answer these questions in code and tests:

- What is portable definition data and what is instance data?
- Which stable IDs and semantic keys are used?
- Where is untrusted input validated?
- Which Actor and Workspace authorize the operation?
- Can every persistence adapter implement the contract?
- Can a remote client expose it without trusting browser identity?
- Does the simplest use remain direct?
- Can advanced hosts replace or extend it without forking core semantics?
- Which documentation and executable example must change?

## Verification

Use focused tests while developing, then run:

```bash
vp check
vp test
vp pack
```

See [Testing strategy](testing.md) for proportional gates. Documentation-only changes require link
and content review, but executable examples remain deterministic tests.

## Documentation discipline

- Keep the root README short and task-oriented.
- Put application-authoring guidance in the “Build an application” path.
- Put internals and contribution rules in the “Develop Framework” path.
- Describe generic capabilities and scenarios; do not couple Framework docs to named products.
- Update status text when a planned capability becomes implemented.
- Prefer links to a canonical explanation over copying the same contract into several files.
