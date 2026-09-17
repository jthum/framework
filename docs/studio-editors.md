# Svelte Studio editors

Studio owns the editor interfaces, draft interactions and reusable controls. A host owns navigation, authorization, persistence, execution and data previews. There are no SvelteKit imports, global sessions or SQL in these components.

`CollectionEditor` takes a collection working model, editor context, explicit actions and navigation callbacks. Lifecycle editing is part of this surface. A host supplies its plural naming policy.

`ViewEditor` takes explicit save/delete/query actions, a reactive revision and a `previewContent` snippet. Querying is debounced and stale responses are ignored; rejected previews display a recoverable error. Filters, columns, sorting, aggregates and dragging remain part of Studio. The preview snippet receives draft rows, View configuration and exposed-filter state with an explicit change callback.

`FormEditor` owns field selection/order, standalone inputs, conditional editing, success hints and the related Rule UI. `FormInputSheet` and `FieldConditionControl` are also independently available. A host supplies field preparation/validation, related Rules and their links/descriptions, Rule creation and a live form preview snippet. Business logic remains in Rules; Studio does not execute form submissions.

`RuleEditor` owns the complete structured workflow authoring UI. `RuleSteps`, `RuleConditions`, `RuleValueInput` and `RuleValueMap` can be composed independently. Hosts supply save/delete actions, optional effect metadata and optional compatibility diagnostics. Custom effect metadata propagates through every nested branch; it contains no implementation functions. No supplied diagnostics means Studio makes no claim about runtime support. The executor, authorization and durable scheduling/wait implementation are outside Studio.

## Working models versus the portable Spec

`CollectionDraft`, `FieldDraft`, `ViewDraft`, `FormDraft` and `RuleDraft` are UI working models, not a second accepted Spec version. They use editable keys for picker choices. Canonical adapters resolve those keys to portable definition identities when persisting. Arbitrary `meta` survives draft edits unchanged. Studio does not perform schema migrations or authorize sharing based on presentation hints.

The View adapter maps ordinary columns, flat filters, caller parameters, relationship paths,
sorting, grouped measures, presentation, identity, and metadata to the canonical View contract.
It rejects canonical options that the current editor cannot preserve—such as custom output aliases,
nested boolean filters, and query offsets—instead of silently rewriting them. Aggregate View
authoring therefore has a complete portable Spec and Kernel path. The executable structured Rule
model remains ahead of the Kernel contract; extraction preserves that surface rather than deleting
functionality or copying an executor into Studio.

Studio consumers can style the semantic tokens and compose host preview snippets. Runtime-specific compatibility diagnostics and registries must come from the host, never an assumed browser runtime.

All four full editors accept `class` for outer layout adjustments. Their controls use the shared chrome Card and semantic tokens, so the implementing app retains its theme rather than adopting a hard-coded Studio theme. The shadcn-Svelte extraction keeps the existing chrome/header/body/footer composition intact.
