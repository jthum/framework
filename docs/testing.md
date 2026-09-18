# Testing strategy

Tests protect the portable Framework contract, adapter interchangeability, and reusable host boundaries. Prefer observable behaviour and reusable contract suites over assertions about private implementation structure.

## Commands

Vite+ owns the quality loop:

| Command                      | Purpose                                     |
| ---------------------------- | ------------------------------------------- |
| `vp test`                    | Run the complete configured test suite once |
| `vp test <filter>`           | Run matching tests while developing         |
| `vp test watch <filter>`     | Watch a focused area                        |
| `vp test related <files...>` | Run tests related to changed files          |
| `vp check`                   | Formatting, lint, and type checks           |
| `vp pack`                    | Library build and export verification       |

Use targeted tests during implementation. Before handing off a meaningful Framework change, run `vp check` and `vp test`. Run `vp pack` when exports, packaging, or delivery boundaries change. A consuming host owns its own browser smoke tests.

Purely visual changes may use proportionate browser inspection without paying for the entire suite unless behaviour also changed.

## Test layers

### Unit tests

Exercise pure semantics with no persistence or UI:

- Spec normalization and validation;
- Field capabilities;
- queries and filters;
- relationship planning;
- permission attenuation;
- Action input validation;
- Rule planning and expression evaluation;
- Block configuration;
- error mapping.

Co-locate focused tests as `*.spec.ts` beside the implementation unless a shared conformance suite or fixture belongs at package level.

### Contract tests

A contract suite is reusable and every implementation of that port must pass it.

Required suites should cover:

- PersistenceAdapter and logical repositories;
- RecordStore and schema materialization;
- Source capabilities and query semantics;
- authorization decisions;
- Action execution context propagation;
- Block definitions and lazy loaders;
- AgentRuntime event and authorization integration.

The SQLite adapter runs the same persistence contract suite as an in-memory fake or any future adapter. Adapter-specific tests supplement rather than replace the common contract.

### Portable Spec conformance fixtures

Keep language-neutral JSON or YAML fixtures for behaviours every Spec consumer must reproduce:

- valid and invalid definitions;
- normalized output;
- stable error codes and validation paths;
- query and relationship results;
- Action and Rule semantics;
- unknown capability handling;
- export behaviour.

Fixtures must not encode TypeScript object identity or SQLite implementation details. A Laravel, WordPress, or other consumer should be able to run the same cases.

### Scenario tests

The architecture defines three cross-cutting scenarios:

- **S1:** root/child Workspaces and attached shared Collections;
- **S2:** domain module scopes and module Events;
- **S3:** delegated Workspace, local Actors, filtered Attachment, attenuation, revocation, and explicit `runAs`.

Each phase implements the relevant assertions from the canonical implementation plan. These are Kernel fixtures, not production UIs for products that do not yet exist.

### Integration tests

Use real collaborating framework services where the boundary is the behaviour under test:

- Kernel plus SQLite adapter;
- schema changes plus records;
- Attachment resolution plus Sources;
- Event -> Rule -> Action;
- snapshot creation;
- durable RuleExecution persistence;
- WebMCP projection of public operations.

Do not mock the component whose contract the test is meant to validate.

### Browser tests

Browser tests in a consuming host should cover a small number of valuable flows:

- boot and persistence initialization;
- creating or opening an App;
- editing a Collection, View, Form, Rule, or Page;
- record CRUD through generated surfaces;
- Block loading;
- navigation and critical modal interactions;
- reload persistence;
- Web Worker and browser-storage integration.

Prefer stable semantic selectors and accessible roles. Do not make pixel coordinates or incidental utility classes the test contract.

### Agent evals

Agent evals are separate from deterministic tests. Add them when AgentRuntime behaviour exists and measure such outcomes as:

- correct Action/tool selection;
- valid Spec changes;
- respecting exposed capabilities;
- avoiding unauthorized operations;
- useful recovery from structured errors.

An eval never substitutes for deterministic authorization, validation, or persistence tests.

## Determinism

Inject deterministic dependencies where behaviour depends on them:

- clock;
- ID generator;
- scheduler;
- AgentRuntime;
- external Sources;
- SecretStore;
- authorization policy.

Do not weaken production randomness or time semantics globally for tests. Supply fakes through the same public ports used by real implementations.

## Persistence tests

- Use isolated temporary databases or adapter-provided in-memory storage.
- Test transaction rollback and cleanup paths.
- Test reopening and reload when durability is claimed.
- Test schema reconciliation with existing records.
- Assert logical results rather than SQLite table names except in SQLite-specific tests.
- Run queries through the public adapter contract before adding lower-level engine assertions.

## Error assertions

Expected failures assert stable code, safe details, and relevant validation paths:

```ts
await expect(operation()).rejects.toMatchObject({
  code: "ATTACHMENT.REVOKED",
});
```

Do not assert an entire human message unless wording itself is the contract. Never snapshot stack traces, generated occurrence IDs, timestamps, or unordered internal context.

## Regression tests

Framework test self-imports resolve to current TypeScript source through exact test aliases, not
previous `dist` output. Consumer integration tests also exercise the built package to verify
exports and packaging. Build the package before those consumer tests; do not rebuild its `dist`
while consumer tests are running.

Every fixed semantic defect should receive the smallest test that would have caught it at the correct layer. Prefer strengthening an existing contract suite when the bug could affect every adapter or consumer.

UI regressions receive a component/browser test when the failure is behavioural. Pure spacing and colour corrections generally require visual inspection rather than brittle snapshots.

## Coverage and test-impact analysis

Coverage is a diagnostic, not a target. High line coverage does not replace S1-S3 scenarios, adapter contracts, invalid fixtures, and failure-path tests.

Vite+ can run related or changed tests. Use that for local speed, but the complete suite remains the merge and handoff standard. Do not add a separate coverage-driven impact-analysis service until suite duration demonstrates a real need.

## Completion gates

Choose verification proportional to the change:

| Change                        | Minimum verification                                  |
| ----------------------------- | ----------------------------------------------------- |
| Pure utility or Spec semantic | focused unit tests + `vp check`                       |
| Public framework contract     | contract/conformance tests + `vp check` + `vp test`   |
| Persistence adapter           | shared contract + adapter tests + reload/cleanup path |
| Svelte interaction            | focused test or browser inspection + `vp check`       |
| Critical user flow            | browser smoke or focused browser test                 |
| Documentation only            | content review + `vp test src/docs.spec.ts`           |

`src/docs.spec.ts` checks local Markdown targets and requires every package export to appear in
the public API map. It intentionally does not validate prose or remote links. Executable examples
receive their own behavior tests.
