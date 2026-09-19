# Sources, Views, and Blocks

Phase 3 separates data access, saved interpretation, and presentation into three small primitives.

```text
Source -> View -> Block
 data     query    presentation
```

## Code map

- Portable query and View definitions: [`src/spec/model.ts`](../src/spec/model.ts)
- Source execution: [`src/kernel/sources.ts`](../src/kernel/sources.ts) and [`src/kernel/source-query.ts`](../src/kernel/source-query.ts)
- View execution: [`src/kernel/views.ts`](../src/kernel/views.ts)
- Block contracts and lazy loading: [`src/blocks`](../src/blocks)
- Behavioral tests: [`src/kernel/sources.spec.ts`](../src/kernel/sources.spec.ts), [`src/kernel/views.spec.ts`](../src/kernel/views.spec.ts), and [`src/blocks/registry.spec.ts`](../src/blocks/registry.spec.ts)

## Sources

A Source exposes structured rows, schema, and explicit capabilities. The built-in Workspace provider resolves both local Collections and semantic Source bindings backed by live Attachments. Consumers discover capabilities instead of assuming that every Source can filter, sort, traverse relationships, aggregate, paginate, or suggest values.

Local Collection Sources currently support filtering, stable sorting, pagination, aggregation, and declared relationship traversal. A reference Field identifies its target by stable `sourceId`: either a local Collection definition ID or a declared Source-binding definition ID. Attached Sources support filtering, sorting, pagination, aggregation, and batched lookup for those explicit references, but deliberately do not expose origin relationships. Neither built-in Source advertises suggestions. A Source without suggestions is still a fully usable Source.

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

Record lists and non-aggregate queries without an explicit sort use stable ascending
`createdAt`, then record-ID order. Aggregate callers that need a stable presentation order should
declare aggregate sorting; no semantic order is implied between otherwise unsorted groups.

Every hop except the terminal Field must be an explicitly declared reference Field. The Kernel rejects unrelated joins. Related records are fetched in batches through the Source contract and are separately authorized. Field, Collection, and Source-binding key renames therefore do not invalidate a query.

A local relationship may cross one declared Attachment boundary, such as `invoice.contact.name`. The attached record must be visible through the Attachment filter, and revocation invalidates both new reference writes and subsequent traversal. A path such as `invoice.contact.company.name` is not inferred through the origin Workspace: deeper traversal requires a separately exposed relationship rather than turning one Attachment into ambient access to its origin graph.

SQLite executes root and declared relationship filters, sorting, aggregation, and pagination in
SQL, including Attachment and queryable row-policy restrictions. Relationship selections used only
for display resolve after the returned page; paths used by predicates, sorting, or aggregation are
projected inside SQLite before pagination. Routed record files are attached to the root query
connection for the duration of that query, then detached. A host SQLite gateway must expose a
stable attachable database name for each routed file. The memory adapter remains the reference
evaluator.

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

A query may instead define one grouped aggregate with named measures. `count`, `sum`, `avg`,
`min`, and `max` are portable operations; a multi-path average first averages each record and
then the records in its group. Group and measure aliases are stable output keys. A relation group
retains its reference identity while using `labelPath` for display. When a relation group omits
`labelPath`, the built-in Workspace Source uses the referenced Collection's title Field (falling
back to a conventional `name`, `title`, `label`, or first text Field). An explicit `labelPath`
always wins.

Views may declare caller parameters separately from their stored query. Each parameter maps a
semantic input key to a stable Field-ID path and operator. `queryView(key, { parameters })` validates
the declared inputs and adds them to the stored filter without mutating the View. `input`
parameters can be shown as exposed filters; `context` parameters are supplied by an embedding
surface, such as the current record.

`queryView` resolves the current Source binding every time and returns the View, Source result, and presentation hint. It never embeds an Attachment ID in the Spec. Hosts may let a Page override presentation without duplicating the View query.

A View editor should make the common path short: list local Collection Sources first, choose one by default when appropriate, and keep query and presentation optional. Bound and future external Sources use the same contract.

## Blocks

A Block is registry metadata plus a lazy renderer loader. Metadata is cheap to list for a library or editor. Renderer code—and any heavy dependency imported by that renderer—is loaded only when `BlockRegistry.load(key)` is called, then cached.

Block metadata may declare optional configuration inputs, catalog ordering, default configuration,
and a preferred Page height. This metadata is portable and eager so Studio can build a picker and
settings form without importing renderer code. A zero-configuration Block omits `inputs`; simple
Blocks do not need an empty schema or registration ceremony. View, Form, Rule, and Field inputs are
semantic selectors resolved by the host against the active Spec.

Blocks receive a complete `BlockInput` containing resolved Source data and JSON configuration. They do not query SQLite, resolve Attachments, inspect application navigation, or reach into host session state. Framework publishes Table and Kanban definitions; concrete Svelte renderers remain a host/UI-package concern.

Failed loads are not cached, so a transient chunk failure can be retried. Duplicate Block keys fail immediately. Layout groups remain Page layout nodes rather than fake Blocks.

## Deliberate limits

- one root Source per View;
- no arbitrary or unrelated joins;
- no implicit traversal beyond an attached record into origin Collections;
- no external API Source implementation yet;
- no assumption that suggestions, aggregation, or every other capability exists on every provider;
- no renderer bundled into the Kernel.
