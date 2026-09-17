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
does not install one of its Action, Condition, or Event contracts. `checkRuleCompatibility`
derives the required contracts and extensible capability keys. The Kernel's short runner performs
that preflight—including nested Rules—before the first side effect. Unknown executable semantics
are errors, even when they sit in a branch that would not have run.

`Kernel.runRule` calls a Rule by key. `Kernel.dispatchEvent` runs enabled matching Rules in stable
priority order. `Kernel.executeAction` is the high-level Action path. Source inputs accept a record
ID and resolve through the unified Source boundary, so attached records remain valid Rule inputs.
Built-in `records.create`, `records.get`, `records.list`, `records.update`, and `records.delete`
Actions deliberately call the same Kernel CRUD methods as direct consumers; validation and
authorization therefore cannot drift. Custom Actions and Conditions are installed when the Kernel
opens, and every Action receives a coarse `actions.execute` policy check before its own
resource-level checks.

Record mutation Actions publish `record.created`, `record.updated`, `record.field_changed`, and
`record.deleted`; Form submission publishes `form.submitted`. Event-triggered source inputs are
filled from the published record when their stable Source ID matches. Cascaded Rules share the
same step and nesting budgets. Direct CRUD remains a deliberately quiet lower-level primitive for
imports, migrations, and hosts that explicitly control Event publication.

The execution Actor is inherited by Actions and nested Rules. The built-in `system` binding uses a
System Actor that is actually a member of the active Workspace; a host may install a resolver for
other semantic bindings. The resolved Actor is passed back through ordinary context and Action
authorization rather than becoming a permission shortcut.

The short runner bounds nesting, cascaded steps, loops, and repeats. Retries are process-local, parallel
branches use deterministic in-process emulation, and successful compensations capture their
resolved input before later work can mutate the scope. Delay and signal waits fail preflight as
unsupported: durable Rule execution and persisted traces remain later slices rather than hidden
approximations.

`views.snapshot` takes a stable `viewId`, a target `label`, and optional `key`, `description`,
View `parameters`, and Collection `meta`. It evaluates the View once and creates a new independent
local Collection. Projection aliases become Field keys; reference-shaped and structured values are
flattened to JSON rather than retaining a live relationship to the origin. The Spec change and all
initial records commit atomically through the persistence adapter. Subsequent edits on either side
do not synchronize unless an explicit Rule does so.
