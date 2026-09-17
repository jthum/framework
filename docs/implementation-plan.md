# Framework implementation plan

**Date:** 2026-09-16  
**Status:** Canonical greenfield phase plan.  
**Architecture:** [architecture.md](./architecture.md)

Build the shared framework Kernel in this repository, then rebase the separate Builder.run host onto it. Do not rewrite or discard the current frontend. Extract its proven editors, Page system, navigation, design language, and Block implementations behind new framework contracts.

Do not implement Teamloop or Workspaces-app production UI in this plan. Encode their demanding cases as Kernel conformance scenarios so the framework does not become Builder-specific.

No compatibility with the current Spec, `Host`, `TypeDef`, `WorkflowDef`, widget terminology, or catalog inference rules. Use one current shape. Temporary side-by-side implementation is allowed only while vertical slices move; delete the old path after parity.

## Progress

| Phase | Status      | Delivered                                                                                               |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------- |
| 0     | Complete    | Package boundary, Kernel, Workspace/Actor/Membership, authorization, environment, SQLite                |
| 1     | Complete    | Collection/Field Spec, runtime validation, RecordStore contracts, CRUD, schema materialization          |
| 2     | Complete    | Persisted live Attachments, semantic binding, filtered reads, origin schema, permissions and revocation |
| 3     | Complete    | Sources, Views, relationship traversal, Block contracts, lazy renderer registry                         |
| 4     | Complete    | Forms, Pages, Builder projection, executable S1 slice, browser SQLite bridge                            |
| 5     | Complete    | Short Rules, Action/Condition registries, Events, snapshots, attached mutations                         |
| 6     | Complete    | Membership ACL, `others`, attenuation, explicit re-share, spawn policy, S3 proof                        |
| 7     | In progress | Durable RuleExecution checkpoint persistence and atomic revision checks                                 |

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
7. A derived Attachment cannot exceed received permissions; re-sharing is off by default.
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

**In:** canonical Attachment instance data: origin Workspace and Collection, target Workspace Source definition, optional filter, permissions, re-share permission (default false), provenance, and revocation. Field schema comes from the origin Collection; never place concrete Workspace or Attachment IDs in a portable Spec. Phase 0's permissive authorizer is sufficient for mechanical S1 wiring; complete `others` enforcement lands in Phase 6.

**Out:** rolling materialisation; implicit copies; full spawn UI.

**Tests:** S1 and S2 shared records live once; target loses access after revocation; concrete binding is absent from exported Spec.

**Delivered:** Attachment uses `originId`, `targetId`, `collectionId`, and stable target `sourceId`; permissions (`read`, `update`, `delete`), `allowReshare` default false, creation provenance, and terminal idempotent revocation. Memory and SQLite persist detached bindings. Creation requires an origin member acting in the origin, explicit target Membership, and an existing target Source declaration, with separate create/accept authorization checks. Target Source declarations resolve live schema/records by semantic key without copying definitions or records; changing that key preserves the instance binding. Reads check target Attachment authority, declared read permission, and the origin resource with `attachmentId` conveyed to the Authorizer. Filter conditions reuse stable Field IDs and the existing condition primitive; current schema is revalidated on every access, failing closed on removed filter Fields. No binding/schema cache bypasses revocation.

Phase 6 subsequently adds attached updates/deletes, derived re-sharing, current member/`others` policy, and permission attenuation. Attached creation is intentionally not exposed because its interaction with filtered slices needs an explicit product contract. See [live Attachments](./attachments.md).

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

**Current checkpoints delivered:** Forms are a discriminated create/edit/standalone primitive. Collection Forms reference stable Collection and Field IDs and submit through the existing record CRUD authorization spine. Standalone Forms own the same Field definitions, apply defaults, conditions, validation, and attached-reference checks, and return an event-ready value payload without inventing a storage model. Pages own stable Block/Group layout-node IDs; Groups carry layout only and are not registry Blocks. Page and Form read/submit services expose cloned portable definitions.

Builder now has an explicit old-Spec-to-framework projection whose unsupported semantics are reported rather than dropped. An executable S1 integration proves a root Space, child App, attached shared Contact Collection, local Invoice Form, related View, and Page without copying shared records. Builder's low-level browser/Node SQLite gateway is bridged to `SqlitePersistenceAdapter` with queued transaction boundaries and single-session ownership; the new Kernel does not import the old Host, catalog, or record services. Its composition root uses trusted persistence reads to discover an existing locally issued User and accessible App, seeds only an empty catalog, and reopens the same topology and records after Kernel restart. Builder Page layout nodes and lifecycle transitions retain stable IDs instead of deriving identity from position or editable keys.

The context-bound `WorkspaceClient` contract and in-process adapter now provide the injectable interface boundary for Spec, records, Sources, Views, Forms, and Pages. Builder exposes separate Space and App clients and its executable S1 integration consumes them. Builder's composition layer also creates and lists selectable Apps using child Workspaces, current Actor Memberships, projected Specs, and explicit Attachments—without adding an App concept to the Kernel. The adapter does not own Kernel lifetime or cache permissions; every operation retains the Kernel authorization spine. Server hosts may implement the same client contract over their transport with Actor identity derived from authentication. See [Workspace client](./workspace-client.md).

The remaining Phase 4 work is replacing Builder's old Host-facing editor/runtime seams with the public client contract while retaining its frontend, followed by deleting the temporary projection and old persisted shape. The current application shell and editors still use the old Host; the integration seam is not yet a migrated user-facing UI. `form.submitted` publication lands with the Phase 5 Event/Action spine rather than introducing a Phase 4-only event mechanism.

**Phase 4 Studio extraction checkpoint:** Framework owns the semantic Svelte theme,
shadcn-Svelte primitives, editor actions, form-purpose choices, vertical drag interaction,
catalog-driven Block picker/settings, canonical Page listing/editor, and recursive Page
content. Page authoring receives explicit callbacks and renderer snippets, without host
registry, session, persistence, or SvelteKit imports. Builder's Page components now supply
host routing, lazy renderers, and data queries. A temporary host adapter maps the existing
Page storage shape to canonical definitions; it is not a supported legacy import format.
**Collection/View/Form/Rule extraction checkpoint:** all four full editor interfaces and
their field, lifecycle, predicate, value-binding and nested-step controls now live in
Framework Svelte Studio. Builder.run supplies thin wrappers for routing, queries, previews,
sharing labels, persistence and runtime compatibility. Standalone deterministic rendering
tests prove there is no SvelteKit or host singleton requirement. These editors expose
explicit authoring working models; see [Studio editors](studio-editors.md) for the boundary.
View authoring now has a canonical adapter and complete Kernel query contract for ordinary
projection, caller/context parameters, relation paths, grouped measures and aggregate sorting.
The adapter preserves stable identities and metadata and rejects unrepresentable options rather
than losing them. Rule authoring maps losslessly into the canonical nested Rule
contract: stable step/branch IDs, stable Source/Form/Rule references, Actions, triggers, bindings,
predicates, retries, compensation, waits, loops, parallel branches and run-as intent are validated.
Runtime compatibility is a separate preflight over installed Event/Action contracts and extensible
capabilities. Action execution and Event dispatch remain Phase 5 work.

This does **not** close Phase 4: the main session still uses Host, draft-to-canonical runtime
integration remains, and the old projection/storage path has not been deleted.

**Sequencing decision before deleting Host:** canonical Rule definitions and Studio translation
are now complete, but Builder's current executor remains authoritative until the Phase 5
Action/Event execution spine lands. Do not duplicate execution or silently skip unsupported
Actions during the cutover.

### Phase 5 — Primitive Actions, Rules, and snapshots

**Goal:** One mutation spine and simple structured orchestration.

**In:** primitive Action registry (`records.*`); Rule Spec with nested steps rather than graph storage; in-tab short executor; callable and triggered Rules; Events carry execution Actor context; Actions inherit `ExecutionContext.actorId`; optional step `runAs` using `trigger`, `system`, or a semantic Actor binding resolved by the Workspace instance; ordinary authorization on every Action; `form.submitted` and record Events; snapshot Action that creates an independent local Collection from a View. S2 stub module publishes `message.posted`.

**Out:** durable waits; activation grants; Rule-revision permission diffing; rolling snapshot refresh; AgentRuntime.

**Tests:** S1 record Rules; S2 event trigger; nested Rule inherits execution Actor; a fake authorizer denies the candidate's upstream write and allows the explicit `runAs` binding resolved to Jane. Full origin ACL policy and origin-resource assertions complete in Phase 6.

**Short-run checkpoint:** the executable Action and Condition registries, callable Rules, explicit
Event dispatch, compatibility preflight, bounded nested and cascaded execution, inherited Actor
context, semantic Actor resolution, retries, and compensation now live in the Kernel. Built-in
record Actions reuse authorized CRUD and publish record Events; Form submission publishes its
Event. Direct Action calls and custom Action authorization use the same registry path as Rules.
The `views.snapshot` Action now creates an independent Collection and atomically seeds its records.
An attached record update now proves that the triggering candidate is denied at the origin while
an explicit semantic Actor binding succeeds only through Jane's current origin authority. A stub
module Action publishes `message.posted` through the same bounded cascade. This closes the planned
Phase 5 execution slice; durable delay/signal execution stays in Phase 7 and full Attachment policy
semantics continue in Phase 6.

### Phase 6 — ACL, `others`, spawn policy, and narrow S3 proof

**Goal:** Implement the people-world semantics demanded by delegated Workspaces without building the whole product.

**In:** real Membership roles and permissions; ACL member permissions plus `others` ceiling; filtered Attachment enforcement; permission attenuation; re-sharing default off and requiring both Workspace policy and Attachment permission; local Actors with Membership only in the delegated Workspace; minimal Workspace creation policy needed by S3. Builder remains a restricted host policy.

**Out:** recursive ACLs; generic topology engine; every spawn flag and invitation UI; writable overlays; rolling refresh.

**Tests:** complete all eight S3 minimum-proof assertions. In particular, target permission cannot elevate origin `others`, derived permissions cannot exceed received permissions, the candidate cannot enumerate HR, Jane's current permission is checked for `runAs`, and revocation invalidates the live Source.

**Delivered:** five local permissions (`read`, `create`, `update`, `delete`, `manage`) are persisted on Memberships and bounded by Workspace `members` access. Attachment-mediated access is additionally bounded by the origin's current `others` access and declared Attachment permissions. Initial and derived permissions attenuate; derived filters are conjunctive; re-sharing requires both target Workspace policy and explicit permission on the received Attachment. Revoking any Attachment in the provenance chain invalidates its derived live Sources. Direct origin members may use an attached Source as a binding while their current origin Membership—not the narrower mediated permission—authorizes the resource operation. Workspace policy independently gates child spawning, local Actor creation, and re-sharing. Root-wide discovery requires `manage`; ordinary rosters remain issuance- or Membership-scoped. No Workspace ancestry is consulted for authorization.

### Phase 7 — Durable Rules and ActorRequest

**Goal:** Wait and resume without holding a browser tab.

**In:** RuleExecution persistence; wait and User ActorRequest; in-tab path retained for short Rules. System cannot satisfy an ActorRequest. Schedules/webhooks exist only where EnvironmentProfile advertises them.

**Out:** distributed workflow engine and every retry policy.

**Tests:** reload during a wait and resume as a User; execution Actor preserved across resume.

**First checkpoint:** the persistence session now exposes an ExecutionStore, implemented by Memory and SQLite. RuleExecution stores its original execution context, immutable Rule snapshot, serializable checkpoint, status, and revision. Updates atomically advance exactly one revision and reject competing/stale writes or changes to execution identity. Workspace-scoped reads never return another Workspace's execution. This is trusted infrastructure, not an actor-facing API. The short runner is unchanged; pause/resume and ActorRequest are not exposed yet. Revision checks prevent competing checkpoint updates, but do not promise exactly-once external Action effects; the resumable runner must define claim/recovery and idempotency semantics before advertising those guarantees.

**Execution checkpoint:** an opt-in cooperative runner now exposes start/resume, scoped execution
inspection, assigned User requests and validated responses. SQLite close/reopen preserves the
continuation, original Actor, nested Rule snapshots, loop positions, traces and compensation inputs.
Concurrent resumes claim one revision before effects; uncertain `running` executions are never
automatically replayed. Explicit management-only termination leaves external reconciliation to the
host. Requests and their continuation claim persist atomically in one checkpoint. The short runner
is retained unchanged for ordinary calls and published Events. Hosts supply signal/deadline delivery;
durable parallel joins and per-item failure continuation remain unsupported, explicitly rejected
before side effects. No scheduler/webhook or distributed worker is implied by the environment flag.

### Phase 8 — AgentRuntime

**Goal:** Agent is an Actor; Rules and UI call an AgentRuntime port; SDK details stay outside the Kernel.

**In:** AgentRuntime port; one Embedded adapter chosen at this phase; tools project primitive Actions and callable Rules; Action authorization uses the Agent execution Actor; SecretStore for credentials.

**Out:** ACP implementation; Strands as Kernel dependency; conversation history as the Agent's only mode.

**Tests:** Rule step with Agent execution Actor; fake AgentRuntime swap; agent cannot exceed its current permissions.

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
Attachment + ACL (member permissions and others)
Field + Form
Page + Block + layout node
primitive Action + Event
Rule + RuleExecution + ActorRequest
PersistenceAdapter + EnvironmentProfile + SecretStore
AgentRuntime port
Module scope binding
```

We are not buying custom multi-level ACL, permission inheritance, topology SPI, nested permission checks, rolling Materialization in the v1 Spec, user-managed Delegation, revision authorization, ModuleDefinition, KernelConfig, Template as a Kernel node, or an agent SDK as foundation. Workspace grouping columns do not implement those features.
