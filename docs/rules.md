# Rules and Actions

A Rule is portable orchestration built from nested primitives. The canonical Spec uses `action`
and `ruleId`; Studio's editable working model may use friendlier or older UI terms internally, but
its adapter never persists those terms as a second Spec format.

```ts
{
  id: "…",
  key: "approve_expense",
  label: "Approve expense",
  input: { expense: { sourceId: "…" } },
  trigger: { event: "record.field_changed", sourceId: "…", fieldId: "…" },
  steps: [{
    id: "…",
    action: {
      key: "records.update",
      input: { record: { $ref: "vars.expense" }, values: { status: "approved" } }
    }
  }]
}
```

The primitives are gate, compute, action, nested Rule invocation, delay, wait, foreach, repeat,
and parallel branches. Predicates compose with `all`, `any`, and `not`. Values are JSON plus a
sole-key `{ $ref }` binding rooted at `trigger`, `actor`, `vars`, or `meta`.

Every step and parallel branch has a stable ID. Studio assigns one automatically when an author
adds an item, so trace and idempotency identity adds no authoring ceremony. Rule inputs, built-in
record triggers, Form triggers, and nested invocation use stable definition IDs. Action input is
owned by the immutable semantic contract registered under its Action key; custom Actions remain
portable opaque data rather than expanding the Kernel schema.

Actions inherit the execution Actor. `runAs` is optional and defaults to `trigger`; `system` and a
semantic Actor-binding key are explicit overrides. A concrete User ID does not belong in portable
Spec.

Structural validation and runtime compatibility are separate. A Spec remains valid when a host
does not install one of its Action or Event adapters. `checkRuleCompatibility` derives required
Actions and extensible capability keys and reports unsupported or emulated behavior before any
side effect. Unknown executable semantics must never be silently skipped.

The current checkpoint defines and validates the portable contract, Studio translation, and
compatibility preflight. Action execution, Event dispatch, and short-run Rule execution land in
the next Kernel slice; durable waits remain a later phase.
