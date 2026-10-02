# Host module persistence

Host-defined entities use the same `PersistenceAdapter` as Framework-owned data. A module owns its
logical schema, queries, invariants and authorized client; the provider owns physical storage.
Intrinsic entities do not become Collections and are not added to the portable Spec.

The canonical contracts are [`ModuleSchema`, `EntityQuery`, `ModuleTransaction` and
`ModulePersistence`](../src/persistence/modules.ts), exported from `@jthum/framework/persistence`.
Executable cross-provider examples are in [`modules.spec.ts`](../src/persistence/modules.spec.ts).

## Composition and authority

Trusted composition obtains storage through `kernel.openModuleStorage(schema)`. The returned store
binds operations to one Workspace with `storage.workspace(workspaceId)`. Schema registration is
idempotent and checks the module's required capabilities before creating storage. A module service
can receive a lazy storage factory when its Actions must be registered before Kernel construction.
There is no separate provider choice or database connection inside the module.

This is a **trusted persistence port**, not an Actor-facing API. Workspace binding prevents accidental
cross-Workspace reads, writes, joins and relationships; it does not authenticate or authorize an
Actor, verify Workspace existence, or grant access to attachments. Module services/Actions enforce
those policies before using storage. Do not expose this port on `WorkspaceClient`, over an untrusted
endpoint, or directly to interface components.

## Logical entities

Each entity implicitly has `id` and `workspaceId`. IDs remain numbers or strings without coercion:
numeric `1` and string `"1"` are different identities. Inserting without an ID returns the provider's
generated identity. Supplied IDs are preserved rather than silently remapped. Optional generated
sequence fields give stable insertion ordering independent of timestamps and the ID format.

Schemas declare text, number, boolean, identity and opaque JSON fields. Nested paths such as
`owner.name` describe logical objects, not a physical column naming convention. JSON is deliberate
for bounded payloads/snapshots; do not hide queryable business fields in a document merely to avoid
declaring them. Missing optional fields are omitted in entity reads; projections represent missing
values as null. Patch updates merge declared paths, and null/undefined clears optional scalar fields
or nested objects. Identity, Workspace and generated sequence fields are immutable.

References point to entities within the same module and Workspace. Restrict, cascade and nullable
reference deletion are provider responsibilities. Unique indexes treat missing values as equal;
atomic upsert requires a declared unique index. Query indexes are logical optimization hints, not
SQL expressions or a promise of a particular index implementation.

Module schemas are host code, not live user-authored schemas. Incompatible declarations fail rather
than silently reinterpreting existing data. Development changes currently require a reset; no schema
migrations or legacy readers are supplied by this contract. This is distinct from Collection's live,
transactional schema-edit API.

## Queries and transactions

`EntityQuery` supports typed comparisons, ordering, named projection, joins, unions, grouping and
aggregates. It also supports ordered latest-N-per-group reads, cycle-safe traversal of declared
self-references, and evenly spaced sampling of an ordered entity query. Group selection happens
before the final limit. Sampling returns sparse rows with `ordinal` and `total`, not the complete
dataset. Opaque JSON is projected as data, not exposed as provider-specific query syntax.

Capability requirements are explicit. A provider must reject unsupported operations with
`PERSISTENCE.UNSUPPORTED`; it must not silently fetch an unbounded dataset to emulate a bounded
query. Invalid combinations/type comparisons fail validation. Providers implement this logical
contract once, not a new Conversation/Billing/etc. adapter for every module.

Use `store.transaction(async tx => ...)` for operations that must commit together and for consistent
multi-query reads. All operations inside the callback use `tx`, not the outer store. The transaction
ends with the callback; retaining its handle is invalid. Throwing rolls back all entity writes and
sequence allocation. Bulk insertion belongs inside this same boundary, not a series of UI Actions.
Do not catch a persistence write failure and continue the transaction. No transaction is implied
across module storage, Framework catalog/records and external side effects; publish Events only
after a successful commit or use an explicit durable handoff where required.

Callbacks execute in the authoritative environment. This is not a protocol for shipping functions
from a browser to a server: remote UI uses the module client/Actions, and the server invokes the
same module repository with its selected provider. A future provider must implement the required
query/transaction semantics there; neither a Convex adapter nor a universal real-time subscription
protocol is implemented by adding this port.

## Reference providers

- Memory keeps entity state in memory, serializes transactions, and snapshots only on mutation.
  Bounded reads project only the selected rows; they do not clone the entire module database.
- SQLite owns STRICT tables, typed columns, identifier generation/quoting, compound scoped foreign
  keys, indexes, JSON encoding, sequence allocation and native query compilation. Window functions
  rank metadata before fetching winning rows; recursive reads are cycle-safe. Sampling uses one
  count and one batched set of indexed positional reads in a single transaction.

SQLite module tables currently live in the catalog database. Optional Workspace/scope record-file
routing concerns Framework Collections, not these entities. A physical module-layout extension can
be added to the provider without changing module types or queries. Workspace deletion removes its
module rows transactionally with provider cleanup; closing the persistence session invalidates
module handles. Browser SQLite uses the existing worker gateway, not a second host-specific driver.
