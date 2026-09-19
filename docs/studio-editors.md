# Svelte Studio editors

Studio owns the editor interfaces, draft interactions and reusable controls. A host owns navigation, authorization, persistence, execution and data previews. There are no SvelteKit imports, global sessions or SQL in these components.

## Code map

- Public exports: [`src/svelte/studio/index.ts`](../src/svelte/studio/index.ts)
- Working models and host-facing data contracts: [`src/svelte/studio/data.ts`](../src/svelte/studio/data.ts)
- Canonical adapter barrel: [`src/svelte/studio/adapters.ts`](../src/svelte/studio/adapters.ts)
- Context projection: [`src/svelte/studio/context-adapter.ts`](../src/svelte/studio/context-adapter.ts)
- Authoring tests: [`src/svelte/studio`](../src/svelte/studio)

Editor props in the Svelte source are authoritative. This guide documents composition and
ownership rather than duplicating every prop signature.

`CollectionEditor` takes a collection working model, editor context, explicit actions and navigation callbacks. Lifecycle editing is part of this surface. A host supplies its plural naming policy.

`ViewEditor` takes explicit save/delete/query actions, a reactive revision and a `previewContent` snippet. Querying is debounced and stale responses are ignored; rejected previews display a recoverable error. Filters, columns, sorting, aggregates and dragging remain part of Studio. The preview snippet receives draft rows, View configuration and exposed-filter state with an explicit change callback.

`FormEditor` owns field selection/order, standalone inputs, conditional editing, success hints and the related Rule UI. `FormInputSheet` and `FieldConditionControl` are also independently available. A host supplies field preparation/validation, related Rules and their links/descriptions, Rule creation and a live form preview snippet. Business logic remains in Rules; Studio does not execute form submissions.

`RuleEditor` owns the complete structured workflow authoring UI. `RuleSteps`, `RuleConditions`, `RuleValueInput` and `RuleValueMap` can be composed independently. Hosts supply save/delete actions, optional effect metadata and optional compatibility diagnostics. Custom effect metadata propagates through every nested branch; it contains no implementation functions. No supplied diagnostics means Studio makes no claim about runtime support. The executor, authorization and durable scheduling/wait implementation are outside Studio.

`WorkspaceSettings` edits user-defined Workspace settings through a `WorkspaceClient`.
`SettingsPanel` renders a host-defined `SettingsLayout` with tabs, sections, and typed Field controls.
It edits values of declared settings; the optional `WorkspaceSettings` surface manages user-defined
settings. Layout and custom-setting policy are owned by the host, not the portable Spec.

Studio does not offer a generic runtime-Action editor. Runtime Action implementations are
executor-specific capabilities, so a host that enables one supplies a purpose-built authoring
surface rather than presenting opaque implementation kinds and configuration strings.

## Working models versus the portable Spec

`CollectionDraft`, `FieldDraft`, `ViewDraft`, `FormDraft` and `RuleDraft` are UI working models, not a second accepted Spec version. They use editable keys for picker choices. Canonical adapters resolve those keys to portable definition identities when persisting. Arbitrary `meta` survives draft edits unchanged. Studio does not perform schema migrations or authorize sharing based on presentation hints.

The View adapter maps ordinary columns, flat filters, caller parameters, relationship paths,
sorting, grouped measures, presentation, identity, and metadata to the canonical View contract.
It rejects canonical options that the current editor cannot preserve—such as custom output aliases,
nested boolean filters, and query offsets—instead of silently rewriting them. Aggregate View
authoring therefore has a complete portable Spec and Kernel path. The executable structured Rule
model maps through a canonical Rule adapter. Portable Rules use Actions, stable Source/Form/Rule
references, stable step identities, nested control flow, and optional run-as bindings. Studio keeps
its key-oriented working vocabulary private and automatically assigns missing step identities.
Execution remains a Kernel responsibility rather than being copied into Studio.

Friendly Studio record steps translate to executable canonical inputs: “Update current record”
becomes `records.update`; “Create a record” resolves the selected key to stable `sourceId` and
maps its fields to identity-keyed Action `values`. Typed predicate fields become stable `fieldId`
bindings while Studio continues to show their editable keys. “Query records” becomes `records.list` with an identity-based
Source filter or `views.query` with declared View parameters. The Kernel supplies both query
Actions through its ordinary authorized Source and View services. The same translation applies
to compensation. Reading a canonical Rule restores the friendly working controls without changing
persisted contract keys, identities, Actor bindings, retries or custom Action payloads. This is an
authoring boundary, not a Kernel alias for old Actions.

`editorContextFromSpec` projects canonical Collections, Views, Forms and Rules into one Studio
context. Hosts may supply concrete schemas for attached Sources; unavailable attachments are
omitted unless another editable definition depends on them. The projection rejects canonical
features an editor cannot preserve, including JSON fields in the shared field sheet. This makes
the cutover explicit rather than creating a lossy shadow model.

`loadEditorContext(client)` is the simple host path: it loads the current authorized Workspace and
every Source schema visible to that context. `createCollectionActions(client)` is the matching
mutation path for the Collection editor: it reads the latest Spec for each focused change, maps
friendly Fields and lifecycle controls back to stable definitions, and commits through the same
context-bound client. Hosts choose the owning client (for example, a child versus root Workspace)
and receive the committed Spec through `onChange`; they do not reimplement schema transforms. The
loader obtains Source descriptors through `WorkspaceClient`, then performs the same strict
projection. Advanced hosts may fetch or cache through their own transport and call
`editorContextFromSpec` directly.

Studio consumers can style the semantic tokens and compose host preview snippets. Runtime-specific compatibility diagnostics and registries must come from the host, never an assumed browser runtime.

All four full editors accept `class` for outer layout adjustments. Their controls use the shared chrome Card and semantic tokens, so the implementing app retains its theme rather than adopting a hard-coded Studio theme. The shadcn-Svelte extraction keeps the existing chrome/header/body/footer composition intact.

## Workflow execution interface

`ExecutionList`, `RuleLauncher`, `ExecutionInspector`, and `ActorRequestCard` are reusable Svelte
components from the same Studio entry point. They use chrome Cards and inherit the host theme.
They never import a host session, router, Kernel instance, or persistence adapter.

The launcher and inspector accept the transport-neutral `RuleExecutionClient`. Hosts load
`RuleExecutionSummary` pages and the selected `RuleExecutionDetails`, plus the caller's assigned
requests. The host owns navigation, refresh, and Actor display names. The inspector distinguishes
signal delivery, elapsed deadlines, User responses, failures, and completed results. Step labels
come from the execution's immutable definitions rather than today's edited Rule. Explicit
termination is hidden unless `canTerminate` is supplied; the Kernel still authorizes the operation.

`FieldInputs` renders canonical `FieldDefinition` primitives, including typed booleans/numbers,
dates, choices, multiple choices, structured values, and references. It reuses the Kernel's
condition evaluator for visibility, enabling and conditional requirements. The runtime remains
authoritative for validation and reference resolution. Request forms preserve drafts across
refreshes, disable submission while pending, and show field-level validation issues. Their working
values are strings/choice arrays, converted to portable JSON only on submission.

Reference controls default to record-ID entry. A host can supply the `referenceInput` snippet
(Field, control ID, value, change callback, control state) to use a searchable picker without
changing the execution interface. The same snippet is available through the launcher, inspector
and standalone request card. Rule input defaults are applied by the runtime when left blank.

Hosts opt into `actorRequests` on `RuleEditor` or `RuleSteps` when their runtime supports durable
User requests. This adds “Ask a user” using the existing wait primitive: title, shared response-field
sheet (including validation and conditionals), optional actor binding, result name, timeout and
response/timeout branches. Response fields appear in later value pickers. Empty actor binding uses
the initiating Actor; the Kernel requires a User assignee. No actor directory is invented by Studio.
The field bridge retains stable option IDs, custom option labels, defaults, date constraints,
integer constraints, multiplicity and custom metadata. Existing JSON fields remain preserved and
are explicitly read-only in this sheet; the runtime response controls already support JSON.
Global assigned-task discovery remains a subsequent slice; this interface consumes actual
persisted requests.

# Imports and bundle boundaries

Import editor components from their individual subpaths, such as
`@jthum/framework/svelte/studio/rule-editor`. Import working models, authoring actions and
metadata from `@jthum/framework/svelte/studio/data`. The aggregate
`@jthum/framework/svelte/studio` barrel remains a convenience for tools and environments where
eagerly loading the full Studio is intentional. Product shells should prefer the granular paths
so route-level editors remain code-split.
