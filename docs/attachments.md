# Live Attachments

An Attachment is an instance binding from an origin Collection to a declared Source in a target Workspace. It does not duplicate schema or records. Portable Specs contain the Source declaration, never concrete Workspace or Attachment IDs.

## Code map

- Instance model: [`Attachment`](../src/kernel/model.ts)
- Kernel operations: [`src/kernel/attachments.ts`](../src/kernel/attachments.ts) and [`Kernel`](../src/kernel/kernel.ts)
- Shared adapter behavior: [`src/kernel/attachments.contract.ts`](../src/kernel/attachments.contract.ts)
- Delegated authorization scenario: [`src/kernel/delegated-rules.spec.ts`](../src/kernel/delegated-rules.spec.ts)

Change the model, persistence implementations, shared contract suite, and this guide together when
Attachment semantics change.

## Current API

The creator must be a member of both Workspaces. Creation runs in the origin context and checks `attachments.create` there plus `attachments.accept` in the target. The target declares a semantic Source such as:

```json
{ "id": "opaque-definition-id", "key": "hr_openings", "label": "HR openings" }
```

After applying that target Spec:

```ts
const attachment = await kernel.createAttachment(hrContext, {
  collectionKey: "job_opening",
  targetId: recruitingId,
  sourceId: "opaque-definition-id",
  filter: { fieldId: statusFieldId, operator: "eq", value: "open" },
});

const source = await kernel.getSource(candidateContext, "hr_openings");
const rows = await kernel.querySource(candidateContext, "hr_openings");
const row = await kernel.getSourceRecord(candidateContext, "hr_openings", recordId);

const received = await kernel.listAttachmentsTo(recruitingContext);
const exposed = await kernel.listAttachmentsFrom(hrContext);

await kernel.revokeAttachment(hrContext, attachment.id);
```

The concrete Attachment stores the Source definition's stable ID, while callers resolve it through the Source's semantic key. Renaming that key therefore preserves the binding. Attachment creation requires the Source declaration to exist already; the Kernel does not silently edit a portable Spec as an instance-side effect. A host may wrap “declare and attach” in one command or transaction later without changing either primitive.

Candidate Membership in Recruiting does not imply Membership in HR. Direct HR CRUD remains inaccessible without HR Membership. Source reads use current origin schema and records; individual reads outside the slice return `null`. Collection, Field, and Source-key renames preserve their bindings through stable definition IDs. Removing a filter Field fails closed; removing the Collection makes the Source unavailable. Removing the target Source declaration also makes its retained Attachment unavailable.

`permissions` defaults to `["read"]`; `allowReshare` defaults to `false`. Permissions cannot exceed the origin Workspace's current `others` ceiling. Creation records `createdBy` and `createdAt`. Revocation records `revokedBy` and `revokedAt`, is idempotent, and cannot be undone. Either endpoint may revoke subject to authorization. Revoked bindings remain in both endpoint listings for provenance; the declared Source may be explicitly bound to a new Attachment afterward.

Reads check `attachments.read` against the target binding and `records.schema`, `records.list`, or `records.read` against the origin resource. The execution context remains the target Actor/Workspace; the origin resource carries `attachmentId` so policy can distinguish mediated access from direct access. Each read also checks declared read permission and rechecks revocation before returning. A direct origin member may use the Source binding while the member's current origin permission authorizes the resource operation; this is how explicit `runAs` can use an otherwise read-only shared Source without granting that write to local target members. Neither Workspace ancestry nor root grouping conveys authority.

Re-sharing is explicit through `reshareAttachment`. It is disabled by default and requires both the current Workspace's `reshare` policy and `allowReshare` on the received Attachment. Derived permissions must be a subset of received permissions, added filters are combined with the inherited filter, and revoking any binding in the provenance chain invalidates downstream live Sources. Provenance traversal is a liveness check, not Workspace ACL inheritance.

## Deliberate boundaries

The implemented contract includes live reads, persistence, isolation, revocation, attached
updates/deletes, current Membership/`others` enforcement, attenuation, and derived re-sharing.
There is no implicit copy, rolling refresh, or recursive Workspace ACL implementation.

The built-in implementation evaluates Attachment filters after the origin RecordStore returns rows. The Source query contract allows adapters to push compatible predicates down later without changing Attachment semantics.

A local reference Field may target an attached Source. Reference validation and terminal display
traversal respect the Attachment slice and revocation. It deliberately does not make the attached
record a bridge into further origin relationships. The built-in Membership authorizer supplies the
production policy baseline; `AllowAllAuthorizer` remains an explicit testing or trusted-host escape hatch.
