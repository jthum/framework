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
      input: { record: { $ref: "vars.expense" }, values: { "field_…": "approved" } }
    }
  }]
}
```

The primitives are gate, compute, action, nested Rule invocation, delay, wait, foreach, repeat,
and parallel branches. Predicates compose with `all`, `any`, and `not`. Values are JSON plus a
`{ $ref }` binding rooted at `trigger`, `actor`, `vars`, or `meta`. A record binding may add one
stable `fieldId`; Studio projects that to an ordinary friendly field selector.

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

Record Actions identify their target with a stable `sourceId`; their authored `values` maps use
stable Field IDs, and resolved record values carry both the Source ID and an internal stable Field
map. Studio and direct Form/record APIs remain key-oriented. This keeps simple authoring readable
while persisted Rules survive Collection and Field key renames—including Rules over attached
Sources—without rewriting consumer Specs. Reads therefore work uniformly across local Collections and attached Sources. Update and
delete may cross an Attachment only when its permission, target-side policy, resolved Actor membership,
and origin resource policy all permit the operation. `runAs` changes only the Actor—it never
bypasses those checks. Creating through an attached Source is deliberately unsupported until the
Phase 6 write/filter policy is complete.

Record mutation Actions publish `record.created`, `record.updated`, `record.field_changed`, and
`record.deleted`; Form submission publishes `form.submitted`. Event-triggered source inputs are
filled from the published record when their stable Source ID matches. Cascaded Rules share the
same step and nesting budgets. Direct CRUD remains a deliberately quiet lower-level primitive for
imports, migrations, and hosts that explicitly control Event publication.
Custom/module Actions receive the same scoped `publish` callback, so contracts such as
`message.posted` stay string-key extensions rather than new Kernel schema nodes.

The execution Actor is inherited by Actions and nested Rules. The built-in `system` binding uses a
System Actor that is actually a member of the active Workspace; a host may install a resolver for
other semantic bindings. The resolved Actor is passed back through ordinary context and Action
authorization rather than becoming a permission shortcut.

The short runner bounds nesting, cascaded steps, loops, and repeats. Retries are process-local, parallel
branches use deterministic in-process emulation, and successful compensations capture their
resolved input before later work can mutate the scope. Delay and signal waits fail preflight as
unsupported in this short path; durable execution uses the explicit API below rather than hidden
in-process approximations.

`views.snapshot` takes a stable `viewId`, a target `label`, and optional `key`, `description`,
View `parameters`, and Collection `meta`. It evaluates the View once and creates a new independent
local Collection. Projection aliases become Field keys; reference-shaped and structured values are
flattened to JSON rather than retaining a live relationship to the origin. The Spec change and all
initial records commit atomically through the persistence adapter. Subsequent edits on either side
do not synchronize unless an explicit Rule does so.

## Durable execution

Hosts opt in with `EnvironmentProfile.durableRuleExecution`. `startRule(context, key, input)`
stores a `RuleExecution` and runs until a wait or completion. `resumeRule(context, executionId,
{ signal?, payload? })` continues a matching signal wait or an elapsed delay/timeout. Numeric
durations are seconds; strings use `ms`, `s`, `m`, `h`, or `d` (for example `"30m"`). Unsupported
durations and executable semantics are rejected before the first Action. An elapsed deadline wins
over a late signal. Hosts arrange delivery/polling; the Kernel does not start timers, a scheduler,
or webhook listeners. `dispatchEvent` and Action-published events still use the short runner.

The immutable `rule` snapshot fixes the original definition. Invoked Rules are also snapshotted;
editing the Spec while paused cannot silently replace the next steps. Persisted continuations
retain scopes, loop positions, nested invocation frames, remaining budget, trace, and compensation
inputs. Memory and SQLite implement the same execution port. Closing and reopening SQLite during
a wait does not rerun completed Actions.

A User task is the same wait primitive, not a second workflow shape:

```json
{
  "id": "approve",
  "wait": {
    "request": {
      "label": "Approve this expense",
      "fields": [
        {
          "id": "answer",
          "key": "approved",
          "label": "Approved",
          "type": "boolean",
          "required": true
        }
      ]
    },
    "as": "approval",
    "timeout": "2d"
  }
}
```

Assignment defaults to the execution Actor, which must be a User. Optional `request.actor` uses
the host's existing semantic Actor binding resolver. System and Agent cannot satisfy a request.
`listActorRequests(context, executionId)` lists only the caller's assigned requests;
`getActorRequest` requires management permission to inspect another Actor's request.
`respondToActorRequest(context, executionId, requestId, values)` validates the declared Fields,
claims the continuation, and returns the responded request—not another Actor's full checkpoint.
The values become the wait's `as` variable, and `onSignal` handles successful responses;
`onTimeout` handles expiration. Requests are instance state co-located in the execution checkpoint,
so request satisfaction and claiming the continuation commit in one atomic revision update.

The original execution Actor stays the Actor after a reviewer responds. Resume checks current
membership and Rule authorization; Actions use ordinary current authorization and optional
`runAs`. Inspection/resumption of another Actor's execution and explicit termination require
management permission. A duplicate response or concurrent resume cannot claim the same revision.

This is **not exactly-once external delivery**. A waiting-to-running compare-and-swap happens
before resumed effects. A crash or storage failure after an Action can leave its outcome uncertain;
a `running` execution is never automatically replayed. `failRuleExecution` explicitly terminates
it without replay or compensation. Hosts must investigate external outcomes; Actions should use
idempotency where appropriate. Known execution failures attempt captured compensations and become
terminal failures. If a response committed and subsequent work failed, inspect the request's
status before retrying it.

`getDurableRuleRuntimeProfile` reports the environment opt-in and installed contracts. Gates,
bounded loops, nested Rules, process-local retries, compensation, and Action overrides are supported.
Durable parallel joins and per-item failure continuation are deliberately rejected, not emulated
incorrectly; they remain Spec capabilities and are still available in the short runner. The durable
runner is a cooperative reference implementation, not a distributed workflow engine.
