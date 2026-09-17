# Live Attachments

An Attachment is an instance binding from an origin Collection to a declared Source in a target Workspace. It does not duplicate schema or records. Portable Specs contain the Source declaration, never concrete Workspace or Attachment IDs.

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

const schema = await kernel.getAttachedSchema(candidateContext, "hr_openings");
const rows = await kernel.listAttachedRecords(candidateContext, "hr_openings");
const row = await kernel.getAttachedRecord(candidateContext, "hr_openings", recordId);

const received = await kernel.listIncomingAttachments(recruitingContext);
const exposed = await kernel.listOutgoingAttachments(hrContext);

await kernel.revokeAttachment(hrContext, attachment.id);
```

The concrete Attachment stores the Source definition's stable ID, while callers resolve it through the Source's semantic key. Renaming that key therefore preserves the binding. Attachment creation requires the Source declaration to exist already; the Kernel does not silently edit a portable Spec as an instance-side effect. A host may wrap “declare and attach” in one command or transaction later without changing either primitive.

Candidate Membership in Recruiting does not imply Membership in HR. Direct HR CRUD remains inaccessible without HR Membership. Source reads use current origin schema and records; individual reads outside the slice return `null`. Collection, Field, and Source-key renames preserve their bindings through stable definition IDs. Removing a filter Field fails closed; removing the Collection makes the Source unavailable. Removing the target Source declaration also makes its retained Attachment unavailable.

`rights` defaults to `["read"]`; `allowReshare` defaults to `false`. Creation records `createdBy` and `createdAt`. Revocation records `revokedBy` and `revokedAt`, is idempotent, and cannot be undone. Either endpoint may revoke subject to authorization. Revoked bindings remain in both endpoint listings for provenance; the declared Source may be explicitly bound to a new Attachment afterward.

Reads check `attachments.read` against the target binding and `records.schema`, `records.list`, or `records.read` against the origin resource. The execution context remains the target Actor/Workspace; the origin resource carries `attachmentId` so policy can distinguish mediated access from direct access. Each read also checks declared read rights and rechecks revocation before returning. Neither Workspace ancestry nor root grouping conveys authority.

## Deliberate phase boundaries

Phase 2 supplies live reads, persistence, isolation, and revocation. It records all four rights (`read`, `create`, `update`, `delete`), but does not expose attached writes or derived re-sharing yet. There is no implicit copy, rolling refresh, or recursive ACL implementation.

The built-in implementation evaluates Attachment filters after the origin RecordStore returns rows. The Source query contract allows adapters to push compatible predicates down later without changing Attachment semantics.

Phase 3 permits a local reference Field to target an attached Source. Reference validation and terminal display traversal respect the Attachment slice and revocation. It deliberately does not make the attached record a bridge into further origin relationships. Phase 6 implements current origin `others` ceilings, target member policy, rights attenuation, and explicit re-sharing policy. The default local Authorizer is permissive; production multi-user hosts need a real policy implementation. Persisted rights alone must not be advertised as implemented runtime capabilities.
