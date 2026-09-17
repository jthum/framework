# Svelte Studio editors

Studio owns the editor interfaces, draft interactions and reusable controls. A host owns navigation, authorization, persistence, execution and data previews. There are no SvelteKit imports, global sessions or SQL in these components.

`CollectionEditor` takes a collection working model, editor context, explicit actions and navigation callbacks. Lifecycle editing is part of this surface. A host supplies its plural naming policy.

`ViewEditor` takes explicit save/delete/query actions, a reactive revision and a `previewContent` snippet. Querying is debounced and stale responses are ignored; rejected previews display a recoverable error. Filters, columns, sorting, aggregates and dragging remain part of Studio. The preview snippet receives draft rows, View configuration and exposed-filter state with an explicit change callback.

`FormEditor` owns field selection/order, standalone inputs, conditional editing, success hints and the related Rule UI. `FormInputSheet` and `FieldConditionControl` are also independently available. A host supplies field preparation/validation, related Rules and their links/descriptions, Rule creation and a live form preview snippet. Business logic remains in Rules; Studio does not execute form submissions.

## Working models versus the portable Spec

`CollectionDraft`, `FieldDraft`, `ViewDraft`, `FormDraft` and `RuleDraft` are UI working models, not a second accepted Spec version. They use editable keys for picker choices. Hosts resolve those keys to portable definition identities when persisting. Arbitrary `meta` survives draft edits unchanged. Studio does not perform schema migrations or authorize sharing based on presentation hints.

Some existing authoring features are ahead of the Kernel contracts: aggregate View authoring and the executable structured Rule model in particular. Extraction preserves them rather than deleting functionality or copying an executor into Studio. Completing their portable Spec/Kernel mapping remains core work. Builder.run currently supplies adapters to its existing runtime at this boundary; this is not old-spec compatibility inside Framework.

Studio consumers can style the semantic tokens and compose host preview snippets. Runtime-specific compatibility diagnostics and registries must come from the host, never an assumed browser runtime.
