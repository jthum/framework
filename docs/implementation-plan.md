# Framework implementation plan

**Status:** Canonical greenfield phase plan
**Architecture:** [architecture.md](architecture.md)

This plan grows one portable Spec and one reference Kernel through independently testable vertical
slices. It does not prescribe a host's navigation, terminology, or deployment. Completed phases are
summarized here; their capability guides and tests are the detailed source of truth.

There is no legacy compatibility target. Temporary bridges must be deleted when a slice reaches its
canonical path.

## Progress

| Phase | Status      | Delivered                                                                                   |
| ----- | ----------- | ------------------------------------------------------------------------------------------- |
| 0     | Complete    | Package boundary, Kernel, Workspace, Actor, Membership, authorization, environment, SQLite  |
| 1     | Complete    | Collection and Field Spec, validation, RecordStore contracts, CRUD, schema materialization  |
| 2     | Complete    | Live Attachments, semantic Source binding, filtered reads, attenuation, and revocation      |
| 3     | Complete    | Sources, Views, declared relationships, Block contracts, lazy renderer registry             |
| 4     | Complete    | Forms, Pages, reusable Svelte Studio, context-bound client, browser-capable SQLite boundary |
| 5     | Complete    | Actions, Conditions, Events, short Rules, snapshots, and attached mutations                 |
| 6     | Complete    | Membership ACL, `others`, explicit re-share, spawn policy, delegated-Workspace proof        |
| 7     | Complete    | Durable Rules, waits, User requests, execution UI, and durable Event subscriptions          |
| 8     | In progress | Provider-neutral AgentRuntime, execution Actor propagation, and authorized tool projection  |
| 9     | Planned     | Module scope binding                                                                        |

## Conformance scenarios

The scenarios test architecture pressure without naming or implementing a particular product.

### S1 — Composed root and child Workspaces

A root Workspace owns shared Contacts. Child Workspaces own local Invoices and consume Contacts
through live Attachments. Shared records exist once. The host may present the root and children with
its own vocabulary and generate implicit list/create/edit surfaces.

The Kernel must support Workspace grouping, issued Actors, persisted Memberships, Collections,
live Attachments, and a Spec per Workspace. It must not infer access from grouping, copy shared
records into each child, or introduce a second place primitive.

### S2 — Domain module scopes

A collaboration-oriented host uses root and operational Workspaces. Recursive Channels, Topics,
Conversations, and Threads are module scopes inside a Workspace. A Collection may bind to a module
scope and a domain Event may trigger a Rule.

The Kernel must allow opaque module scope bindings and registered Actions, Sources, and Events. It
must not turn module entities into Workspaces or bake their invariants into the portable Spec.

### S3 — Delegated Workspace and local Actors

A member of an operational Workspace spawns a delegated child and attaches a filtered live Source.
Local users are issued in the child and hold Membership only there. They cannot access the parent.
A Rule inherits its triggering Actor; an upstream step works only with an explicit `runAs` binding
whose current permission is still checked. Re-sharing is off by default and all permissions
attenuate. Revocation makes the live Source unavailable.

A snapshot alternative creates an independent local Collection. Only an explicit Rule propagates
selected local changes upstream.

## Phase 0 — Framework boundary and identity

Establish the dependency direction and canonical vocabulary:

- one package with subpath boundaries for Spec, Kernel, persistence, SQLite, Svelte, Blocks, and
  catalogs;
- Workspace grouping through immutable `isRoot`, `parentId`, and `rootId`;
- Actor issuance through `originId` and `rootId`;
- persisted Membership and explicit execution context `{ workspaceId, actorId }`;
- authorization choke point and deployment `EnvironmentProfile`;
- empty portable Spec and injected clock/ID dependencies.

Grouping and issuance never authorize. There is no Account Kernel type, topology ACL, or ancestry
walk. Tests distinguish issuance rosters, membership rosters, and privileged root-wide discovery.

## Phase 1 — Collections and persistence

Add authoritative Collections, typed Fields, records, schema materialization, and the RecordStore
contract. Portable definition IDs are opaque and stable; semantic keys are editable. Physical
tables and record IDs remain adapter policy.

All adapters run shared CRUD, isolation, schema, rollback, and reopen contracts.

## Phase 2 — Live Attachments

Make a Collection or filtered slice in one Workspace available as a live Source in another.
Attachment is instance data containing origin, target, Collection binding, filter, attenuated
permissions, provenance, re-share policy, and revocation. The portable target Spec declares only a
semantic Source binding.

Field schema remains owned by the origin Collection. Concrete Workspace and Attachment IDs never
enter exported Specs. Rolling copies and writable overlays remain separate synchronization work.

See [Live Attachments](attachments.md).

## Phase 3 — Sources, Views, relationships, and Blocks

Separate data access, saved interpretation, and presentation:

```text
Source -> View -> Block
```

Sources advertise capabilities. Views query one root Source and may traverse declared reference
Fields. Blocks receive resolved input and load renderers lazily. No arbitrary joins, ambient origin
graph access, database-aware renderer, or assumption that every Source supports every capability.

See [Sources, Views, and Blocks](sources-views-blocks.md).

## Phase 4 — Forms, Pages, client, and Studio

Add create/edit/standalone Forms, stable Page layout trees, and a context-bound `WorkspaceClient`.
Extract reusable Collection, View, Form, Rule, and Page editors into Svelte Studio with explicit
injection contracts. Studio working models are authoring state, never a second persisted Spec.

The host owns routes, navigation, runtime composition, template installation, and Block rendering.
Editors import neither application sessions nor concrete persistence. Granular subpath imports keep
route-level editors code-split.

See [Forms and Pages](forms-pages.md), [Workspace client](workspace-client.md), and
[Studio editor contracts](studio-editors.md).

## Phase 5 — Actions, Events, and short Rules

Register primitive Actions and Conditions. Execute structured Rules with predicates, branches,
loops, parallel branches, retries, compensation, nested Rules, and Actor propagation. Form and
Action mutations publish Events through the same path. Provide explicit snapshot and attached
mutation operations without adding a second mutation implementation.

Built-in record and query Actions use stable definition IDs. Friendly Studio adapters translate
author-facing keys into that canonical representation and reject shapes they cannot preserve.

See [Rules and Actions](rules.md).

## Phase 6 — ACL, attenuation, and delegated Workspaces

Complete Membership permissions, member/`others` ceilings, filtered Attachment enforcement,
explicit re-share, and Workspace spawn policy. A target-local Actor cannot exceed the origin
resource's `others` ceiling. A direct origin member keeps only their current direct authority.

No recursive permission graph, ancestry authorization, or implicit Rule-owner authority is added.
S3 proves isolation, explicit `runAs`, attenuation, and revocation.

## Phase 7 — Durable Rule execution

Persist RuleExecution checkpoints, waits, User requests, responses, traces, compensation inputs,
and the effective Actor. Concurrent resume claims one revision before effects. Uncertain running
executions are not replayed automatically.

Event delivery preflights matching Rules and routes each to the short or durable runner according
to its authored capabilities. Durable subscriptions create ordinary persisted executions. External
schedule, webhook, deadline, and signal delivery remain host responsibilities.

Reusable execution history, launcher, inspector, and Actor-request components consume the smaller
`RuleExecutionClient`. They never import a Kernel, adapter, router, or global session.

## Phase 8 — AgentRuntime

**Goal:** Agent is an Actor; Rules and UI call an `AgentRuntime` port while SDK details remain
outside the Kernel.

**In:**

- transport-neutral AgentRuntime contract;
- tools projected from authorized primitive Actions and callable Rules;
- User, Agent, and System execution Actor propagation;
- deterministic contract tests and agent evals kept separate.

The Kernel contract, Action/Rule projection, context-bound client, and deterministic tests are in
place. A host-selected provider adapter and behavioral eval suite remain. Credentials are injected
into that adapter (or another host integration), not routed through the portable Spec or Kernel.

**Out:** mandatory schema-library or agent-SDK dependency in the Spec/Kernel; implicit authority;
conversation history as the Agent's only mode; multiple speculative adapters.

## Phase 9 — Module scope binding

**Goal:** Bind a Collection instance to an opaque module entity inside one Workspace.

A scope handle contains a module-defined `kind` and `id`. Sources and Views respect the binding.
A stub module proves topic-local isolation and a domain Event without adding module entities to the
portable Spec or inventing a broad module-definition SPI.

## Later, deliberately unscheduled

- rolling Materialization and writable overlays;
- synchronization products and CDC;
- external API Source implementations;
- additional AgentRuntime transports;
- remote catalog trust, signatures, and installation transactions;
- cross-root identity federation;
- independently versioned packages before distribution pressure justifies them.

## Dependency order

```text
0 boundary -> 1 collections -> 2 attachments -> 3 views/blocks -> 4 forms/pages/studio
                                  \-> 5 actions/rules -> 6 ACL -> 7 durable rules -> 8 agents
                                                       \-> 9 module scope
```

## Complexity budget

The closed core remains:

```text
Workspace + grouping (not ACL)
Actor + issuance + persisted Membership
Collection + Field + Record
Attachment + Source + View
Form + Page + Block
Action + Event + Rule + RuleExecution + ActorRequest
```

New capability must preserve the rule: simple should remain direct, while advanced composition is
possible through explicit optional primitives.
