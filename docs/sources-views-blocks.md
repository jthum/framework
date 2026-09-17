# Sources, Views, and Blocks

Phase 3 separates data access, saved interpretation, and presentation into three small primitives.

```text
Source -> View -> Block
 data     query    presentation
```

## Sources

A Source exposes structured rows, schema, and explicit capabilities. The built-in Workspace provider resolves both local Collections and semantic Source bindings backed by live Attachments. Consumers discover capabilities instead of assuming that every Source can filter, sort, traverse relationships, aggregate, paginate, or suggest values.

Local Collection Sources currently support filtering, stable sorting, pagination, and declared relationship traversal. A reference Field identifies its target by stable `sourceId`: either a local Collection definition ID or a declared Source-binding definition ID. Attached Sources support filtering, sorting, pagination, and batched lookup for those explicit references, but deliberately do not expose origin relationships. Neither built-in Source advertises suggestions or aggregation yet. A Source without suggestions is still a fully usable Source.

Queries identify Fields with stable Field-ID paths:

```ts
{
  filter: { path: ["field_client", "field_name"], operator: "contains", value: "Acme" },
  sort: [{ path: ["field_client", "field_name"], direction: "asc" }],
  select: [
    { path: ["field_title"], as: "title" },
    { path: ["field_client", "field_name"], as: "client_name" }
  ],
  limit: 50
}
```

Every hop except the terminal Field must be an explicitly declared reference Field. The Kernel rejects unrelated joins. Related records are fetched in batches through the Source contract and are separately authorized. Field, Collection, and Source-binding key renames therefore do not invalidate a query.

A local relationship may cross one declared Attachment boundary, such as `invoice.contact.name`. The attached record must be visible through the Attachment filter, and revocation invalidates both new reference writes and subsequent traversal. A path such as `invoice.contact.company.name` is not inferred through the origin Workspace: deeper traversal requires a separately exposed relationship rather than turning one Attachment into ambient access to its origin graph.

The current built-in provider evaluates a query after its RecordStore read. The contract allows a future provider or persistence adapter to push supported operations down without changing View or Block semantics.

## Views

A View is portable Spec data with exactly one root Source, an optional query, and an optional default presentation:

```ts
{
  id: "01...",
  key: "active_projects",
  label: "Active projects",
  source: "project",
  query: {
    filter: { path: ["field_status"], operator: "eq", value: "active" }
  },
  presentation: { block: "table" }
}
```

`queryView` resolves the current Source binding every time and returns the View, Source result, and presentation hint. It never embeds an Attachment ID in the Spec. Hosts may let a Page override presentation without duplicating the View query.

A View editor should make the common path short: list local Collection Sources first, choose one by default when appropriate, and keep query and presentation optional. Bound and future external Sources use the same contract.

## Blocks

A Block is registry metadata plus a lazy renderer loader. Metadata is cheap to list for a library or editor. Renderer code—and any heavy dependency imported by that renderer—is loaded only when `BlockRegistry.load(key)` is called, then cached.

Blocks receive a complete `BlockInput` containing resolved Source data and JSON configuration. They do not query SQLite, resolve Attachments, inspect Builder navigation, or reach into host session state. The framework publishes Table and Kanban definitions; concrete Svelte renderers remain a host/UI-package concern.

Failed loads are not cached, so a transient chunk failure can be retried. Duplicate Block keys fail immediately. Layout groups remain Page layout nodes rather than fake Blocks.

## Deliberate limits

- one root Source per View;
- no arbitrary or unrelated joins;
- no implicit traversal beyond an attached record into origin Collections;
- no external API Source implementation yet;
- no assumption that suggestions, aggregation, or every other capability exists;
- no renderer bundled into the Kernel.
