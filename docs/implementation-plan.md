# Framework implementation plan

**Date:** 2026-09-16  
**Status:** Canonical greenfield phase plan.  
**Architecture:** [architecture.md](./architecture.md)

Build the shared framework Kernel in this repository, then rebase the separate Builder.run host onto it. Do not rewrite or discard the current frontend. Extract its proven editors, Page system, navigation, design language, and Block implementations behind new framework contracts.

Do not implement Teamloop or Workspaces-app production UI in this plan. Encode their demanding cases as Kernel conformance scenarios so the framework does not become Builder-specific.

No compatibility with the current Spec, `Host`, `TypeDef`, `WorkflowDef`, widget terminology, or catalog inference rules. Use one current shape. Temporary side-by-side implementation is allowed only while vertical slices move; delete the old path after parity.

## Progress

| Phase | Status   | Delivered                                                                                          |
| ----- | -------- | -------------------------------------------------------------------------------------------------- |
| 0     | Complete | Package boundary, Kernel, Workspace/Actor/Membership, authorization, environment, SQLite           |
| 1     | Complete | Collection/Field Spec, runtime validation, RecordStore contracts, CRUD, schema materialization     |
| 2     | Complete | Persisted live Attachments, semantic binding, filtered reads, origin schema, rights and revocation |

Later phases remain intentionally unimplemented; their entries below are the source of truth for scope.

---

## Stress-test scenarios

### S1 — Builder.run (Space, App, expose)

**Story:** Switch Spaces. Each Space is a root Workspace; its Apps are child Workspaces. The Space owns shared Collections such as Contacts. Apps have local Collections such as Invoices and consume shared Collections through Attachments. Shared records live once. Implicit list/create/edit is Builder host policy.

**Kernel must:** root Space Workspace + child App Workspaces + workspace-issued Actors + persisted Memberships + Collections + live Attachments + Spec on a Workspace.

**Host:** Space/App chrome, expose UX, Studio, implicit Pages, WebMCP.

**Must not:** infer access from Workspace grouping; copy Contacts into every App; introduce Account as a second Kernel place.

### S2 — Teamloop (Organisation, Workspace, module scopes)

**Story:** Switch Organisations. Each Organisation is a root Workspace with operational child Workspaces. Root-owned Collections may be attached to operational Workspaces. Recursive Channels, Topics, Conversations, and Threads are module scopes inside a Workspace. A Collection may bind to a module scope. `message.posted` may trigger a Rule. Conversation invariants remain module code.

**Kernel must:** S1 capabilities + opaque Collection scope binding + module Actions, Sources, and string-key Events.

**Must not:** Channels as Workspaces; Topics as Collections; nested Workspace ACL walks; conversation entities in the portable Spec.

**This repo:** Kernel tests with a stub conversation module. No Teamloop production UI.

### S3 — Delegated Workspace, local Actors, and attached slices

**Story:** Jane is issued in the root Space and a member of non-root Workspace **HR**, with read/write on Job Openings. Its ACL permits `others: read`. From HR she spawns Summer Recruiting, which inherits the Space's `root_id`, and attaches a filtered live slice of Job Openings. Candidates are issued in Recruiting (`origin_id = recruiting`, `root_id = space`) and receive Membership only there. They cannot access HR and are not listed as root-issued people. A candidate action may trigger a Rule. Its local Actions inherit the candidate as execution Actor. An upstream close step works only when it explicitly uses a `runAs` Actor binding resolved to Jane, whose current HR permission is still checked. Attribution is Jane.

A snapshot alternative copies selected openings into an independent local Collection. Local users may edit it. Only an explicit Rule bridges selected changes upstream.

**Minimum Kernel proof:**

1. Jane belongs to HR and Summer Recruiting through persisted Memberships.
2. HR exposes a filtered live Source to Summer Recruiting through an Attachment.
3. A candidate belongs only to Summer Recruiting.
4. The candidate cannot access HR directly.
5. Default Rule execution as the triggering candidate cannot mutate HR.
6. The explicit `runAs` binding to Jane can mutate HR while Jane retains permission.
7. A derived Attachment cannot exceed received rights; re-sharing is off by default.
8. Revoking the origin Attachment makes the live Source unavailable.

**Must not:** recursive permission graph walks; candidates as HR members; implicit `runAs`; rolling synchronization hitchhiking on Attachment; full delegated-product UI.

---

## Scenario progression

| After phase                   | S1                                                  | S2                                     | S3                                                   |
| ----------------------------- | --------------------------------------------------- | -------------------------------------- | ---------------------------------------------------- |
| 0 Kernel/package skeleton     | root Space, child Apps, Actor, persisted Membership | root Organisation and child Workspaces | fixture identities and authorization seam            |
| 1 Collections                 | local/shared Collections                            | same                                   | isolated local Collections                           |
| 2 Attachments                 | root Space -> App live Attachment                   | root Organisation -> child Workspace   | mechanical live Attachment and revocation            |
| 3 Sources, Views, Blocks      | Views over local/attached Sources                   | same                                   | filtered read and relation traversal                 |
| 4 Forms, Pages, Builder slice | usable Builder host                                 | bound-Collection surface fixture       | snapshot surface may wait for Actions                |
| 5 Primitive Actions + Rules   | record Rules                                        | `message.posted` trigger               | Actor propagation, explicit `runAs`, snapshot Action |
| 6 ACL, `others`, spawn        | restricted Builder policy                           | —                                      | complete narrow S3 proof and attenuation             |
| 7 Durable RuleExecution       | waits                                               | —                                      | optional User confirmation                           |
| 8 AgentRuntime                | Agent execution Actor                               | —                                      | —                                                    |
| 9 Module scope binding        | —                                                   | Collection bound to Topic              | —                                                    |

Builder UI tracks S1. S2 and S3 remain conformance fixtures until their products exist.

---

## Non-goals for this plan

- Teamloop or Workspaces-app production UI;
- rolling Materialization, writable overlays, or bidirectional synchronization;
- external API Sources or sync/CDC;
- custom multi-level Workspace ACL, parent permission inheritance, or topology SPI;
- nested permission evaluation;
- a full ACL algebra in Phase 0;
- user-managed Delegation/ActionAuthority for Rules;
- Templates as a Kernel primitive;
- graph Rule editor or ModuleDefinition SPI;
- Strands or another Agent SDK as a Kernel foundation;
- auth-provider implementation;
- independently versioned internal packages before a second consumer needs them;
- backwards compatibility with the current app.

---

## Phases

### Phase 0 — Framework boundary, Kernel skeleton, and canonical names

**Goal:** Establish the new core and dependency direction without rewriting the Builder frontend.

**In:** one framework package with subpath-ready boundaries for Spec, Kernel, persistence contracts, SQLite, Svelte, and Blocks; `Kernel`; Workspace with immutable `isRoot`, `parentId`, `rootId`; Actor (`user | agent | system`) with `originId`, `rootId`; persisted Membership; empty Spec v2 (`collections`, `views`, `forms`, `pages`, `rules`); `PersistenceAdapter`; browser-local `EnvironmentProfile`; execution context `{ workspaceId, actorId }`; authorization choke point `authorize(actor, action, resource)` with a coarse `ResourceRef` (`workspace` | `collection` | `record`) and a permissive local implementation. Bootstrap one root Workspace, issue User/System there, and persist Memberships. Ordinary spawning uses the active Workspace as parent and copies its root. Normal Actor rosters use issuance or Membership; universe listing is explicitly privileged. No Account Kernel type, topology ACL, or ancestry authorization. Remove Store from the new Spec. Use Block terminology. Never infer access from `created_by`.

**Out:** complete ACL semantics, Attachments, Rules running, AgentRuntime, and UI rewrite.

**Tests:** bootstrap root Workspace and locally issued User/System; spawn child and nested Workspaces from the current context; verify inherited root and immutable grouping; persist Memberships; verify issuance and membership rosters separately; reject cross-root Memberships; `authorize` is invoked with Actor, action, and ResourceRef without grouping fields; S1/S2/S3 fixtures (HR is non-root; candidate is issued in Recruiting).

**Success:** new Kernel tests never use old `Host`; Kernel imports no Svelte, Builder navigation/session globals, or SQLite implementation.

### Phase 1 — Collections and persistence

**Goal:** Authoritative Collections and records owned by Workspaces.

**In:** Collection, Field, Record, schema materialization, RecordStore adapter contract, opaque definition IDs plus semantic keys. SQLite physical table names remain SQLite adapter policy.

**Out:** Attachment, Views, full Studio migration.

**Tests:** record CRUD; shared and operational Workspace Collections; two Workspaces cannot see each other's local records; alternative fake adapter contract tests.

### Phase 2 — Live Attachments

**Goal:** A Collection or slice in Workspace A is usable as a live Source in Workspace B.

**In:** canonical Attachment instance data: origin Workspace and Collection, target Workspace Source definition, optional filter, rights, re-share permission (default false), provenance, and revocation. Field schema comes from the origin Collection; never place concrete Workspace or Attachment IDs in a portable Spec. Phase 0's permissive authorizer is sufficient for mechanical S1 wiring; complete `others` enforcement lands in Phase 6.

**Out:** rolling materialisation; implicit copies; full spawn UI.

**Tests:** S1 and S2 shared records live once; target loses access after revocation; concrete binding is absent from exported Spec.

**Delivered:** Attachment uses `originId`, `targetId`, `collectionId`, and stable target `sourceId`; rights (`read`, `create`, `update`, `delete`), `allowReshare` default false, creation provenance, and terminal idempotent revocation. Memory and SQLite persist detached bindings. Creation requires an origin member acting in the origin, explicit target Membership, and an existing target Source declaration, with separate create/accept authorization checks. Target Source declarations resolve live schema/records by semantic key without copying definitions or records; changing that key preserves the instance binding. Reads check target Attachment authority, declared read rights, and the origin resource with `attachmentId` conveyed to the Authorizer. Filter conditions reuse stable Field IDs and the existing condition primitive; current schema is revalidated on every access, failing closed on removed filter Fields. No binding/schema cache bypasses revocation.

Attachment write and derived re-share APIs are not exposed yet. Their rights are persisted, not treated as implemented capabilities. General Source contracts arrive in Phase 3; full member/`others` policy and attenuation arrive in Phase 6. The permissive local Authorizer remains intentionally unsuitable as a production multi-user ACL. See [live Attachments](./attachments.md).

### Phase 3 — Sources, Views, relationships, and Blocks

**Goal:** Views query one root Source; Blocks render returned rows and schema.

**In:** Source contract and capability discovery; local and attached Collection Sources; View query plus optional default presentation; declared relationship traversal with batched resolution; Block definition/renderer/registry contracts; lazy Block loading; View editor defaults to choosing a Collection.

**Out:** arbitrary federated joins; external API Sources; assumptions that every Source supports suggestions.

**Tests:** Table/Kanban Blocks over attached Collections; declared local and local-to-attached relationship traversal; no unrelated or deeper implicit origin join; a Source without suggestions remains usable; Block renderer imports neither SQLite nor Builder session/navigation.

**Delivered:** Sources advertise schema and granular capabilities. The built-in provider exposes local Collections and live Attachment bindings through one query contract with filters, stable sorting, pagination, projection, and runtime validation. Relationship paths use stable Field IDs; reference Fields target stable local Collection or Source-binding IDs. The Kernel authorizes and resolves each edge with batched `getMany` reads. A local relation may terminate in an attached record while its filter and revocation remain effective, but attached Sources intentionally do not become bridges into deeper origin relationships. Views persist one semantic root Source with optional query and default Block presentation. The Kernel lists, resolves, and queries Views without persistence coupling. The Block package provides eager definitions, lazy retryable renderer loading, and module caching; Table and Kanban are catalog definitions, while renderers remain host concerns. See [Sources, Views, and Blocks](./sources-views-blocks.md).

### Phase 4 — Forms, Pages, and Builder vertical slice

**Goal:** Builder S1 is usable on the framework while preserving its current frontend quality.

**In:** Form (create/edit/standalone), Page with Blocks and distinct layout nodes, Builder Space/App chrome, implicit list/create/edit as host policy, editors against injectable public Kernel/client contracts, WebMCP as a projection of Kernel operations and later Actions.

**Out:** Teamloop chrome; delegated Workspace product UI; Template as Kernel node.

**Tests:** S1 end-to-end UI; current editor behaviours retained; Spec export/import clones the mould only; Block library remains lazily loaded.

### Phase 5 — Primitive Actions, Rules, and snapshots

**Goal:** One mutation spine and simple structured orchestration.

**In:** primitive Action registry (`records.*`); Rule Spec with nested steps rather than graph storage; in-tab short executor; callable and triggered Rules; Events carry execution Actor context; Actions inherit `ExecutionContext.actorId`; optional step `runAs` using `trigger`, `system`, or a semantic Actor binding resolved by the Workspace instance; ordinary authorization on every Action; `form.submitted` and record Events; snapshot Action that creates an independent local Collection from a View. S2 stub module publishes `message.posted`.

**Out:** durable waits; activation grants; Rule-revision permission diffing; rolling snapshot refresh; AgentRuntime.

**Tests:** S1 record Rules; S2 event trigger; nested Rule inherits execution Actor; a fake authorizer denies the candidate's upstream write and allows the explicit `runAs` binding resolved to Jane. Full origin ACL policy and origin-resource assertions complete in Phase 6.

### Phase 6 — ACL, `others`, spawn policy, and narrow S3 proof

**Goal:** Implement the people-world semantics demanded by delegated Workspaces without building the whole product.

**In:** real Membership role/rights policy; ACL member rights plus `others` ceiling; filtered Attachment enforcement; rights attenuation; re-sharing default off and requiring both Workspace policy and Attachment permission; local Actors with Membership only in the delegated Workspace; minimal Workspace creation policy needed by S3. Builder remains a restricted host policy.

**Out:** recursive ACLs; generic topology engine; every spawn flag and invitation UI; writable overlays; rolling refresh.

**Tests:** complete all eight S3 minimum-proof assertions. In particular, target permission cannot elevate origin `others`, derived rights cannot exceed received rights, the candidate cannot enumerate HR, Jane's current permission is checked for `runAs`, and revocation invalidates the live Source.

### Phase 7 — Durable Rules and ActorRequest

**Goal:** Wait and resume without holding a browser tab.

**In:** RuleExecution persistence; wait and User ActorRequest; in-tab path retained for short Rules. System cannot satisfy an ActorRequest. Schedules/webhooks exist only where EnvironmentProfile advertises them.

**Out:** distributed workflow engine and every retry policy.

**Tests:** reload during a wait and resume as a User; execution Actor preserved across resume.

### Phase 8 — AgentRuntime

**Goal:** Agent is an Actor; Rules and UI call an AgentRuntime port; SDK details stay outside the Kernel.

**In:** AgentRuntime port; one Embedded adapter chosen at this phase; tools project primitive Actions and callable Rules; Action authorization uses the Agent execution Actor; SecretStore for credentials.

**Out:** ACP implementation; Strands as Kernel dependency; conversation history as the Agent's only mode.

**Tests:** Rule step with Agent execution Actor; fake AgentRuntime swap; agent cannot exceed its current rights.

### Phase 9 — Module scope binding

**Goal:** Bind a Collection to a module entity inside one Workspace.

**In:** opaque scope handle (`kind` plus `id`) on Collection instance/binding; Source and View respect it; stub conversation module supplies Topic plus `message.posted`.

**Out:** production conversation UI; recursive Channel implementation beyond tests; ModuleDefinition SPI. Leave Collection-per-topic versus one Collection filtered by `topicId` as an implementation choice so long as tests see topic-local isolation.

**Tests:** Topic-local Collection is not visible as an unbound Workspace Collection; Rule responds to `message.posted`.

### Later, deliberately unscheduled

- rolling Materialization as Kernel-owned instance data;
- writable overlays and explicit synchronization products;
- external API Sources;
- sync/CDC inside PersistenceAdapter;
- ACP AgentRuntime;
- complete Builder invitation UX;
- production Teamloop and Workspaces hosts;
- Template registry semantics;
- independent package splitting and registry publication before a second consumer is real.

---

## First vertical and dependency order

Ship Builder on the framework after Phase 4. Do not wait for Rules or AgentRuntime to validate the first vertical.

```text
0 boundary/skeleton -> 1 collections -> 2 attachments -> 3 views/blocks -> 4 Builder S1
                                              \-> 5 actions/rules/snapshot
                                                   \-> 6 ACL + narrow S3
                                              \-> 9 S2 module binding (after Events exist)

5 -> 7 durable Rules -> 8 AgentRuntime
```

Phase 5 may begin once Attachment resolution exists. Phase 6 completes security semantics that Phase 2 wires mechanically. Phase 9 needs the Event/Action seam from Phase 5 but may otherwise proceed independently.

---

## Complexity we are buying

Closed v1 set:

```text
Workspace + root/parent grouping (not ACL)
Actor + issuance/root grouping + persisted Membership
Collection + Source + View
Attachment + ACL (members and others)
Field + Form
Page + Block + layout node
primitive Action + Event
Rule + RuleExecution + ActorRequest
PersistenceAdapter + EnvironmentProfile + SecretStore
AgentRuntime port
Module scope binding
```

We are not buying custom multi-level ACL, permission inheritance, topology SPI, nested permission checks, rolling Materialization in the v1 Spec, user-managed Delegation, revision authorization, ModuleDefinition, KernelConfig, Template as a Kernel node, or an agent SDK as foundation. Workspace grouping columns do not implement those features.
