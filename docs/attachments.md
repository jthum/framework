# Live Attachments

An Attachment is an instance binding from an origin Collection to a semantic Source key in a target Workspace. It does not duplicate schema or records. Portable Specs contain the Source declaration, never concrete Workspace or Attachment IDs.

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
  key: "hr_openings",
  filter: { fieldId: statusFieldId, operator: "eq", value: "open" },
});

const schema = await kernel.getAttachedSchema(candidateContext, "hr_openings");
const rows = await kernel.listAttachedRecords(candidateContext, "hr_openings");
const row = await kernel.getAttachedRecord(candidateContext, "hr_openings", recordId);

const received = await kernel.listIncomingAttachments(recruitingContext);
const exposed = await kernel.listOutgoingAttachments(hrContext);

await kernel.revokeAttachment(hrContext, attachment.id);
```

Candidate Membership in Recruiting does not imply Membership in HR. Direct HR CRUD remains inaccessible without HR Membership. Source reads use current origin schema and records; individual reads outside the slice return `null`. A Collection/Field key rename preserves the binding through stable definition IDs. Removing a filter Field fails closed; removing the Collection makes the Source unavailable. Removing the target Source declaration also makes its binding unavailable.

`rights` defaults to `["read"]`; `allowReshare` defaults to `false`. Creation records `createdBy` and `createdAt`. Revocation records `revokedBy` and `revokedAt`, is idempotent, and cannot be undone. Either endpoint may revoke subject to authorization. Revoked bindings remain in both endpoint listings for provenance; the semantic key may be explicitly bound to a new Attachment afterward.

Reads check `attachments.read` against the target binding and `records.schema`, `records.list`, or `records.read` against the origin resource. The execution context remains the target Actor/Workspace; the origin resource carries `attachmentId` so policy can distinguish mediated access from direct access. Each read also checks declared read rights and rechecks revocation before returning. Neither Workspace ancestry nor root grouping conveys authority.

## Deliberate phase boundaries

Phase 2 supplies live reads, persistence, isolation, and revocation. It records all four rights (`read`, `create`, `update`, `delete`), but does not expose attached writes or derived re-sharing yet. There is no implicit copy, rolling refresh, or recursive ACL implementation.

The Phase 2 implementation evaluates Attachment filters after the origin RecordStore returns rows. Phase 3's Source query contract will express filter capabilities and allow adapters to push compatible predicates down without changing Attachment semantics.

Phase 3 introduces general Source/query contracts. Phase 6 implements current origin `others` ceilings, target member policy, rights attenuation, and explicit re-sharing policy. The default local Authorizer is permissive; production multi-user hosts need a real policy implementation. Persisted rights alone must not be advertised as implemented runtime capabilities.
