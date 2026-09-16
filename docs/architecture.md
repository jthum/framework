# Framework architecture

**Date:** 2026-09-16  
**Status:** Canonical. Greenfield. No backwards compatibility with the current Builder.run Spec or `Host`.  
**Plan:** [implementation-plan.md](./implementation-plan.md)

This is the architecture of the shared information-system framework. Builder.run is its first **host**. Teamloop and a future Workspaces app are other hosts; Teamloop also supplies a domain **module**. The portable Spec is the hero. The TypeScript Kernel is the reference consumer, not the definition of the product.

The current Builder frontend is an asset. Preserve its editors, Pages, navigation, design system, tables, modals, and Block implementations while replacing its core incrementally from the separate Builder host repository.

---

## 1. Axes (do not collapse)

```text
Spec          portable, language-agnostic definition
Consumer      implementation of the Spec (this Kernel, Laravel, WP, GPUI)
Kernel        TypeScript reference engine
Host / shell  product IA (Builder Studio, Teamloop chrome, ...)
Module        domain code (conversation, later PMS entities)
Persistence   adapter (SQLite today; Postgres/Convex/sync later)
```

Laravel does not import the TypeScript Kernel. It reads the Spec and implements the same semantics with its own persistence and UI. Teamloop written on this stack shares the Kernel, changes the host, and adds a module. Those are different kinds of reuse.

---

## 2. Workspace, Actor issuance, and module scope

**Workspace** is the only Kernel place: Builder Space, an App, Teamloop Organisation, HR, and Summer Recruiting are all Workspaces. A host may expose only one and never use the word. There is no Kernel Account or organisation-wide people table.

Workspace grouping uses `is_root`, `parent_id`, and `root_id` (TypeScript: `isRoot`, `parentId`, `rootId`). A root has `is_root = true`, `parent_id = null`, and `root_id = id`. Bootstrap creates one root, issues the first User and System there, and persists their Memberships. Host vocabulary may be Space, Organisation, or Account; those labels do not create new Kernel types.

`createWorkspace` spawns beneath the active Workspace, not the creator's birthplace: `is_root = false`, `parent_id = context.workspaceId`, inherited `root_id`, and `createdByActorId` for provenance. Spawned Workspaces cannot become roots. Grouping is immutable in v1. These columns support children, siblings, and root-universe queries; they are never walked in authorization and imply no inherited access.

Actors have `origin_id` and `root_id` (`originId`, `rootId`). Origin is the issuing Workspace: login/invite realm and “people spawned here.” Root is copied from that Workspace for cheap privileged universe listings. Login integration remains host-owned. Jane issued in a Space has `origin_id = root_id`; a candidate issued in Recruiting has `origin_id = recruiting`, `root_id = space`. Keep one physical actors table. Normal rosters list by issuance or Membership, never by root. Root-wide listings require explicit privileged authorization.

Issuance is not access. Membership determines where an Actor may act; ACL is members + others + Attachment in the active Workspace. Jane acting in HR is checked as an HR member. A candidate issued in Recruiting is not thereby a member of HR or the root. Memberships stay within one root universe; cross-root identity federation is future host work.

**Module scope** is recursive domain structure inside the same people-world: Channel -> Topic -> Thread, portfolio -> task. It is not another identity boundary.

Test: **new people-world -> Workspace. Same people, nested places -> module scope.**

```text
Root Workspace (host: Space / Organisation)
  └── Workspace* (grouping, not inherited ACL)
        ├── Workspace* (optional delegated people-world)
        └── Module scope* (host/module-owned domain tree)
```

Do not model Channels as Workspaces. Do not model Summer Recruiting as a Topic. Workspace grouping is not a custom multi-level ACL or a replacement for module-owned navigation.

---

## 3. Primitives

### Spec and identity

| Primitive     | Meaning                                                                                                 |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| **Spec**      | Portable mould applied to a Workspace. Not tenant, records, instance bindings, credentials, or secrets. |
| **Workspace** | Instance people-and-permissions world; optional root/parent grouping. Not in a Spec.                    |
| **Field**     | Typed slot. The same shape serves Collection fields, Forms, Rule inputs, and ActorRequests.             |
| **Record**    | One member of a Collection.                                                                             |

Definition nodes have opaque portable stable IDs. Authors use semantic keys. ID format is an implementation detail. Records, executions, messages, Actors, and Workspaces use provider/runtime IDs.

### Data and surfaces

| Primitive      | Meaning                                                                                                                           |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Collection** | Authoritative schema and record set owned by a Workspace. A kind of Source. May be bound to a module scope inside that Workspace. |
| **Source**     | Structured data a View can query. It advertises capabilities; a View never connects directly to SQLite or HTTP.                   |
| **View**       | Saved interpretation of one root Source: query plus optional default presentation. A Page Block may override presentation.        |
| **Form**       | Intake: create/edit a Collection or standalone Fields producing `form.submitted`. Not a command builder.                          |
| **Page**       | Authored layout of Blocks and layout nodes.                                                                                       |
| **Block**      | Configurable visual unit resolved through a registry. Receives values, rows, and schema; it is not a data-access layer.           |

One View has one **root** Source. It may traverse explicitly declared relationships such as `project.client.name`. Arbitrary unrelated federated joins are not implicit.

Source capabilities may include schema discovery, relationship traversal, filtering, sorting, aggregation, batched relation resolution, and optional search suggestions. An external Source need not provide every capability a local Collection Source provides. External Source kinds are later work.

Components are implementation-level UI pieces. Blocks are configurable Page units. Templates are host/studio distribution artifacts that package or generate Specs; Templates are not a v1 Kernel primitive.

```text
Components -> Blocks -> Templates
```

### Live data, snapshots, and later materialisation

The schema of an **attached** Source is the **origin Collection’s** definition. The target Workspace Spec does not duplicate those Fields. It refers to the Source by a **semantic key** that the Workspace instance binds to a local Collection or an Attachment. Export never writes Attachment IDs.

A View is live by default: it queries its Source when read.

A **snapshot** is an explicit operation that reads a View and creates an independent local Collection. Its records and permissions are then local. Optional provenance may be retained as instance metadata. A Rule may deliberately propagate selected local changes upstream.

Do not put rolling materialisation on Collection definitions in the portable v1 Spec. Rolling refresh is a synchronization product with stale rows, deletion semantics, schema drift, cycle prevention, and writable-overlay concerns. A future rolling **Materialization** should be Kernel-owned instance data connecting an instance Source/View binding to a target Collection.

Initial meanings:

```text
Live View            reads the attached/local Source
Snapshot Collection  independent local copy created once
Rolling copy         later instance-level Materialization, not v1 Spec
```

Physical representation is adapter policy. “Collection” must not mean “SQL table”: SQLite may use a table, Convex documents, and WordPress posts plus metadata.

### Behaviour and operations

| Primitive         | Meaning                                                                                                              |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Action**        | Registered primitive operation (`records.create`, later `topic.update`).                                             |
| **Rule**          | Orchestration: optional trigger, steps, waits, Actor steps, and nested Rules. A triggerless Rule may be callable.    |
| **Event**         | Named occurrence (`invoice.created`, `form.submitted`, `message.posted`). String key plus payload and Actor context. |
| **RuleExecution** | Durable run of a Rule.                                                                                               |
| **ActorRequest**  | Rule waiting on a User. Presentation is host-owned.                                                                  |

Use **Rule**, not Loop, Workflow, or Automation in the Spec (`rules:`). A Rule calls Actions. Buttons and Agent tools may invoke an Action or a callable Rule. Views querying Sources are not Actions.

“Primitive Action” means a reusable foundational operation, not necessarily an ACID transaction. Domain Actions may compose primitives under one execution context. Transaction guarantees depend on adapter and resource capabilities.

### Execution Actor

Every execution has an **execution Actor**, represented simply by `ExecutionContext.actorId`.

- A user-triggered Event carries that User Actor.
- An Agent-triggered Event carries that Agent Actor.
- A nested Rule inherits the current execution Actor.
- A schedule uses System.
- A webhook uses its configured integration/System Actor.
- Actions inherit the current execution Actor by default.

An Action step may explicitly override this with **`runAs`**. In the UI this is “Run as,” with “Triggering actor” as the default. Rule ownership is authorship, not automatic authority.

`runAs` must not embed a concrete User Actor ID in a portable Spec. It may use a portable identity such as `trigger` or `system`, or a semantic Actor-binding key that the Workspace instance resolves to Jane, an Agent, or another eligible Actor. Selecting Jane in the editor creates that instance binding without adding ceremony to Rules that inherit their triggering Actor.

```yaml
then:
  - action: records.update
    source: local_applications
    values:
      status: approved

  - action: records.update
    source: hr_openings
    runAs: hr_operator # this Workspace binds hr_operator to Jane
    values:
      status: closed
```

The Action executor resolves the execution Actor, checks that Actor's **current** permission for the Action and resource, then executes or rejects. There is no separate Delegation resource, activation grant, Rule-revision authorization, or permission-diff machinery. Managing Rules (including authoring `runAs` and binding `hr_operator` → Jane) is a privileged Workspace capability. Only trusted members receive it. A candidate must not be able to edit Rules.

Audit records the effective Actor and Rule/Action. The triggering Event already provides the causal origin when execution logs need the full chain.

### People and permissions

| Primitive          | Meaning                                                                                                         |
| ------------------ | --------------------------------------------------------------------------------------------------------------- |
| **Actor**          | **User** \| **Agent** \| **System**. System is non-interactive and cannot satisfy an ActorRequest.              |
| **Membership**     | Persisted Actor x Workspace relationship with local role/rights. One Actor may belong to several Workspaces.    |
| **ACL**            | Rights within one Workspace for members plus an **`others`** ceiling for access conveyed through Attachments.   |
| **Attachment**     | Makes a Collection or filtered slice from one Workspace available as a Source in another, with narrowed rights. |
| **Spawn settings** | Workspace policy controlling Workspace creation, local Actors, and re-sharing.                                  |

Membership answers whether an Actor participates in a Workspace. Attachment answers whether a Workspace can consume a resource owned elsewhere. Membership cannot replace Attachment: a candidate may read selected HR openings without becoming an HR member.

`others` is the maximum set of rights available to Actors who reach a resource through an Attachment rather than direct membership in its owning Workspace.

Rights only attenuate:

```text
derived Attachment rights ⊆ received Attachment rights ⊆ origin ACL.others
```

Re-sharing is off by default. It requires explicit Workspace policy and permission on the received Attachment; read permission alone never implies redistribution permission. Provenance supports audit and revocation, but authorization does not walk a recursive Workspace tree.

A snapshot needs origin authority while it is created, then becomes independent. A live Attachment requires continuing authority. Target Workspace permissions can narrow but never elevate origin rights.

Auth providers (password, magic link, SSO) are outside the Spec. After authentication, the session resolves to an Actor.

### Runtime terms

| Primitive              | Meaning                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------ |
| **Kernel**             | Reference engine: Spec + adapters + environment -> running system.                                           |
| **PersistenceAdapter** | Catalog, records, and Kernel instance data. Physical layout and sync/CDC strategy are adapter policy.        |
| **EnvironmentProfile** | Deployment capabilities only: durable waits, schedules, ACP, multiplayer, and similar.                       |
| **SecretStore**        | Credentials outside the Spec and profile.                                                                    |
| **AgentRuntime**       | How an Agent reasons. The only `*Runtime`; adapters may be Embedded, ACP, or future implementations.         |
| **Host / Shell**       | Product chrome and information architecture.                                                                 |
| **Module**             | Domain entities, invariants, Actions, Events, Sources, and optional UI. Code, not a v1 ModuleDefinition SPI. |
| **Session**            | UI/process state.                                                                                            |

```text
Spec + PersistenceAdapter + EnvironmentProfile [+ SecretStore] -> Kernel
```

Do not grow a `KernelConfig` junk drawer. Adapter URLs belong to adapters. Secrets belong to SecretStore. Permissions belong to Membership, ACL, Attachment, and module policy.

---

## 4. What is not in the Kernel or v1 Spec

- recursive Workspaces, `parentWorkspaceId`, permission inheritance, and re-parenting;
- topology plugins encoding Space/App or Organisation/Workspace;
- a second Collection-owner type beside Workspace;
- Store in the Spec;
- Type, Workflow, Automation, or Loop as canonical primitive names;
- Form as arbitrary command builder;
- View as a Svelte component;
- rolling Materialization in the portable v1 Spec;
- Template as a Kernel primitive;
- user-managed Delegation/ActionAuthority for ordinary Rules;
- ModuleDefinition SPI;
- compatibility with the current `Host`, `TypeDef`, or `WorkflowDef`.

---

## 5. Host and module shapes

| Product            | Kernel                                      | Host                                                                                                  | Module                                                                        |
| ------------------ | ------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Builder.run**    | Workspaces, Collections, Attachments, Rules | Space = root Workspace; App = child Workspace; expose = Attachment; implicit list/create/edit; Studio | none required                                                                 |
| **Teamloop**       | same                                        | Organisation = root Workspace; operational Workspace = child; conversation chrome                     | Channel / Topic / Conversation; Collections bound to scopes; `message.posted` |
| **Workspaces app** | same plus spawn policy and local Actors     | delegated Workspace creation; invite versus local Actor UX                                            | none required                                                                 |

Builder is the delegated-Workspace model with advanced spawn and local-Actor controls hidden or restricted. It is not a different engine.

---

## 6. Persistence and current-catalog transition

Logical containment does not dictate physical layout. An adapter may use one database per Workspace, one per root, or shared tables keyed by IDs. An adapter-specific tenant key is not a Kernel Account.

Kernel-owned instance data includes Workspaces, Actors, Memberships, Attachments, RuleExecutions, ActorRequests, and later Materializations. Module-owned tables live beside Collections rather than masquerading as Collections.

The current Builder catalog approximates the target implicitly:

| Current                        | Current role                     | Target                                       |
| ------------------------------ | -------------------------------- | -------------------------------------------- |
| root `space` containing actors | root identity and shared data    | root Workspace; Actors issued there          |
| `space` with `created_by`      | App                              | Workspace                                    |
| `actor.space_id`               | Actor origin and inferred access | Actor origin/root plus persisted Memberships |
| App `created_by`               | discovery and access             | provenance plus Membership/ACL               |
| type `expose`                  | implicit sharing                 | Attachment                                   |
| `kv`                           | active Space and appearance      | adapter-owned preferences/settings           |

Do not preserve these inference rules as compatibility behaviour. Migrate the current product to the new model and delete the old path at cutover.

---

## 7. Spec versus instance

**Spec:** Collection and Field definitions, semantic Source and Actor-binding keys, Views, Forms, Pages, Rules, Agent definitions, Block keys, and portable metadata.

**Instance:** Records, Workspaces, Actors, Memberships, Attachments, concrete Source and Actor-binding resolution, RuleExecutions, ActorRequests, secrets, Messages, Topics, presence, and future Materializations.

A Spec never names a concrete Workspace or Attachment. Exporting a Spec clones the mould, not operational data or authority. Importing a Spec must bind semantic Sources in the destination instance.

---

## 8. Framework packaging and extraction

The framework lives in its own repository and exposes one package with subpath boundaries. Builder.run remains a separate host and integrates the package only after the public API survives a framework vertical slice.

Initial shape may be one package with subpath exports:

```text
@jthum/framework/spec
@jthum/framework/kernel
@jthum/framework/persistence
@jthum/framework/sqlite
@jthum/framework/svelte
@jthum/framework/blocks
```

Suggested internal organization:

```text
src/
  spec/
  kernel/
  persistence/
  sqlite/
  svelte/
  blocks/

Builder.run remains in its own host repository.
```

The Kernel must not import Svelte, Builder navigation, browser session globals, or SQLite-specific implementations. Framework Svelte editors depend on public Kernel/client contracts, not concrete adapters.

The repository is intended for `github.com/jthum/framework` and the package name is `@jthum/framework`. During greenfield development Builder may consume it from a local path or pinned Git revision; publication and independent package splitting can wait for a real second consumer.

Temporary side-by-side code during extraction is risk isolation, not backwards compatibility. Do not add dual persisted formats, legacy readers, aliases, or migration baggage. Delete the old `Host` path after vertical parity.

---

## 9. Open, but not blockers for the first vertical slice

- exact optional View default-presentation contract;
- `wait.signal` versus a dedicated Actor step inside a Rule;
- embedded AgentRuntime library;
- how far Form submission goes beyond Collection CRUD plus `form.submitted`;
- future rolling Materialization semantics;
- cross-root guest identity;
- exact external Source contracts;
- whether Block layout grows beyond explicit non-Block layout nodes;
- Phase 9: Collection-per-module-entity versus one Collection filtered by scope id (tests require topic-local isolation, not a final schema).

---

## 10. Glossary

```text
Spec                portable definition applied to a Workspace
Workspace           people-and-permissions world
root Workspace      Workspace with no parent; host calls it Space / Organisation
originId            Workspace in which an Actor was issued
rootId              grouping universe, never inherited authority
Module scope        nested domain place inside one Workspace
Collection          authoritative schema and records; one Source kind
Source              structured data a View can query
Record              one Collection member
Field               typed value definition
View                query over one root Source; declared relations allowed
Form                structured intake
Page                layout of Blocks and layout nodes
Block               registry-resolved visual unit
Action              primitive registered operation
Rule                callable or triggered orchestration
Event               named occurrence carrying Actor context
RuleExecution       durable Rule run
Actor               User | Agent | non-interactive System
execution Actor     Actor whose authority an Action currently uses
runAs               optional Action override of the execution Actor
ActorRequest        wait for a User
Membership          persisted Actor participation in a Workspace
ACL                 member rights plus others ceiling
Attachment          cross-Workspace Source access with narrowed rights
AgentRuntime        how an Agent reasons
Kernel              TypeScript reference engine
Module              domain code
PersistenceAdapter  storage implementation
EnvironmentProfile  deployment capabilities only
Host / Shell        product chrome
Session             UI/process state
```
