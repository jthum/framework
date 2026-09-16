# Coding standards

These standards apply to the shared framework packages and the Builder.run reference host. The repository uses TypeScript, Svelte 5, SvelteKit 3, shadcn-svelte, and Vite+.

The framework is greenfield. Prefer one clean current implementation over compatibility aliases, dual formats, deprecated readers, or speculative extension systems.

## Toolchain

Use Vite+ for package management and development tasks:

```bash
vp install
vp dev
vp check
vp test
vp build
```

Run package scripts through `vp run <name>` when no Vite+ built-in command provides the operation.

Formatting is owned by Oxfmt through Vite+. Linting is owned by Oxlint. Do not add a parallel formatter or linter for local preference.

## Canonical vocabulary

Use the framework terms consistently in code, Specs, tests, and documentation:

```text
Workspace
Actor
Membership
Attachment
Collection
Source
View
Field
Form
Page
Block
Action
Rule
Event
```

Do not introduce aliases such as Type, Widget, Workflow, Automation, Loop, or Grant in new framework APIs. A host may use friendlier product copy, but it translates to one canonical framework concept.

## Package direction

Dependencies point inward toward portable contracts:

```text
Spec and shared contracts
          ↑
        Kernel
       ↑      ↑
adapters      Svelte/editor bindings
       \      /
        host composition
```

- Spec code imports no Kernel, Svelte, browser, Node, SQLite, or host modules.
- Kernel code imports no Svelte components, Builder navigation, global session, or concrete persistence adapter.
- Persistence contracts expose logical operations, not SQL.
- SQLite and future adapters implement persistence contracts and contain their own physical queries and schema policy.
- Framework Svelte code depends on public client/contracts, not a global Builder session.
- Builder host code composes the Kernel, adapters, editors, navigation, and product policy.
- Blocks receive declared values and resolved data; they do not open databases or reach into host state.

Do not bypass a package boundary for convenience. Change the public contract when a genuine cross-layer capability is missing.

## Actions own mutations

Public business mutations flow through registered primitive Actions. UI components, WebMCP tools, Rules, agents, route handlers, and modules invoke those Actions rather than implementing parallel mutation paths.

An Action need not be a class. Prefer a typed definition or focused function with declared input, output, authorization, and execution behaviour.

```ts
export const updateRecord = {
  key: "records.update",
  async execute(context, input) {
    // validate, authorize, and delegate to logical services
  },
} satisfies ActionDefinition;
```

Domain Actions may compose primitive Actions under the same execution context. “Primitive” does not imply a cross-adapter ACID transaction.

Reads use Sources and query contracts. Do not force ordinary View reads through Actions.

## Execution context

Actor authority is explicit at mutation boundaries:

```ts
interface ExecutionContext {
  workspaceId: string;
  actorId: string;
}
```

Pass the context through Actions, Rules, modules, and adapters that require attribution. Do not read the current Actor from a global singleton inside Kernel code.

Actions in a Rule inherit its execution Actor. An explicit `runAs` changes the execution Actor for that step and is authorized like any other Action. Do not add a separate implicit owner-authority path.

## Spec and instance boundaries

The portable Spec contains definitions, semantic keys, and binding intent. It does not contain records, concrete Workspaces, concrete Attachments, secrets, sessions, or deployment-specific handles.

Workspace `isRoot`, `parentId`, and `rootId` are grouping only. Actor `originId` is issuance and login realm; `rootId` is grouping only. Never authorize by ancestry, issuance, or root. Use issuance/Membership for normal rosters; root-wide Actor discovery is an explicit privileged operation. There is no Kernel Account.

- Spec values must be plain JSON-compatible data.
- Do not store functions, class instances, Svelte proxies, database handles, or framework objects in the Spec.
- Normalize and validate untrusted Specs at the boundary.
- Do not mutate a caller-owned Spec object in place.
- Export clones the mould, not operational data or authority.
- Concrete Source and Actor bindings are instance data.
- Optional `meta` remains an escape hatch for consumers; core behaviour must not silently depend on unknown metadata.

## Types and validation

- Keep TypeScript strict.
- Use `unknown` at trust boundaries and narrow it deliberately; do not replace uncertainty with `any`.
- Prefer discriminated unions for closed semantic variants.
- Make exhaustive handling visible with `never` checks where missing a variant would be a defect.
- Give exported functions and public contracts explicit return types.
- Avoid type assertions that merely silence the compiler. Validate or improve the model instead.
- Runtime validation is required for imported Specs, Action input, persisted data, adapter responses, and external events.
- Keep validation capability-aware: reject unsupported field rules and Source operations before persistence.

## Identity and references

- Portable definition nodes use opaque stable IDs and human-readable semantic keys.
- Never infer entity kind from an ID prefix.
- Renaming a key must not change stable identity.
- Runtime/provider IDs remain runtime concerns.
- Store declared references explicitly; do not search and replace arbitrary JSON strings during rename operations.
- A View has one root Source but may traverse declared relationships.

## Errors

Follow the [framework error contract](errors.md).

- Throw or return stable semantic framework errors at public boundaries.
- Preserve an existing error code when adding context.
- Never expose raw SQL, stack traces, secrets, or adapter internals to users or agents.
- Do not assign a permanent domain code to every programming defect; unexpected failures use `INTERNAL.UNEXPECTED` plus an occurrence ID.

## Configuration and environment

Kernel code does not read `process.env`, `import.meta.env`, `window`, `document`, storage globals, or route state.

Hosts construct and inject:

- PersistenceAdapter;
- EnvironmentProfile;
- SecretStore;
- clocks and ID generators when determinism matters;
- concrete Source and Actor bindings;
- host policy.

EnvironmentProfile describes capabilities, not URLs, credentials, or arbitrary configuration.

## Persistence

- SQL belongs only in a SQL persistence adapter.
- Kernel services depend on logical catalog, schema, record, and execution contracts.
- Transactions are adapter capabilities; do not assume one global transaction spans unrelated adapters.
- Physical database and table names are adapter policy.
- Adapter results are normalized into framework values before leaving the adapter boundary.
- Resource cleanup and transaction rollback must be explicit on every failure path.

## Asynchronous work

- Await work whose completion affects the caller's result.
- Do not use untracked fire-and-forget promises.
- Named background work must own error reporting and cancellation.
- Prevent stale asynchronous UI results from overwriting newer state.
- Long Rule waits become durable RuleExecutions; they do not hold an in-memory request or browser interaction open.

## Svelte and interface code

- Use Svelte 5 runes consistently.
- Keep business rules out of components; components call public clients and Actions.
- Convert reactive/proxy state to validated plain data before it crosses the Kernel boundary.
- Reuse the established shadcn-svelte primitives, design tokens, chrome cards, tables, modals, tabs, fields, and interaction patterns.
- Do not introduce a parallel component system or one-off visual language.
- Preserve accessible names, keyboard interaction, focus behaviour, and semantic HTML.
- Lazy-load Blocks and optional heavy dependencies at the registry boundary.
- Layout groups are layout nodes, not registry Blocks.

## Naming and files

| Item                 | Convention                                      | Example              |
| -------------------- | ----------------------------------------------- | -------------------- |
| Type/interface/class | PascalCase                                      | `PersistenceAdapter` |
| Function/variable    | camelCase                                       | `resolveSource`      |
| Constant             | SCREAMING_SNAKE_CASE when truly constant        | `SPEC_VERSION`       |
| File and directory   | kebab-case                                      | `record-service.ts`  |
| URL segment          | kebab-case                                      | `/library/blocks`    |
| Spec key             | snake_case unless the domain requires otherwise | `active_projects`    |
| Action/Event key     | dotted semantic namespace                       | `records.update`     |
| Error code           | uppercase category and semantic reason          | `PERMISSION.DENIED`  |

Prefer named exports for framework contracts and implementation units. Keep barrel files deliberate; do not create dependency cycles through broad re-export trees.

## Compatibility and cleanup

There are no production users to migrate during this revamp.

- Do not add legacy readers, aliases, compatibility flags, or dual writes.
- Temporary bridges used while moving a vertical slice must be clearly scoped and deleted at cutover.
- Delete superseded code after parity rather than leaving two architectural paths.
- Preserve proven user-facing behaviour and design; greenfield core does not mean discarding the frontend.
