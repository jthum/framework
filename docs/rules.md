# Rules and Actions

A Rule is portable orchestration built from nested primitives. The canonical Spec uses `action`
and `ruleId`; the authoring working model may use friendlier UI terms internally, but
its adapter never persists those terms as a second Spec format.

## Code map

- Portable Rule shape: [`src/spec/model.ts`](../src/spec/model.ts)
- Structural validation: [`src/spec/validate.ts`](../src/spec/validate.ts)
- Short execution and Event dispatch: [`src/kernel/rules.ts`](../src/kernel/rules.ts)
- Durable execution: [`src/kernel/durable-rules.ts`](../src/kernel/durable-rules.ts)
- Action and Condition extension points: [`src/kernel/action-registry.ts`](../src/kernel/action-registry.ts) and [`src/kernel/condition-registry.ts`](../src/kernel/condition-registry.ts)
- Compatibility planning: [`src/kernel/rule-compatibility.ts`](../src/kernel/rule-compatibility.ts)
- Internal definition traversal shared by compatibility, preflight and diagnostics: [`src/kernel/rule-steps.ts`](../src/kernel/rule-steps.ts)
- Behavioral tests: [`src/kernel/rules.spec.ts`](../src/kernel/rules.spec.ts), [`src/kernel/durable-rules.spec.ts`](../src/kernel/durable-rules.spec.ts), and [`src/kernel/delegated-rules.spec.ts`](../src/kernel/delegated-rules.spec.ts)

The short runner executes directly; the durable runner retains resumable continuation frames.
They share Action execution, value resolution and definition traversal. The [parity tests](../src/kernel/rule-parity.spec.ts)
pin their common results, trace order, compensation and nested-Rule preflight without forcing
ordinary short Rules through durable checkpoint machinery.

## Host execution projections

History reads return bounded `RuleExecutionSummary` pages from the execution persistence port.
SQLite selects native summary columns using the Workspace/Actor/creation-order index, without
loading Rule snapshots or checkpoint JSON. Summary metadata and the full execution commit together;
inspection and resume explicitly fetch the full execution. Memory implements the same projection.
The client-facing summary shape is unchanged. See the [shared execution contracts](../src/persistence/executions.spec.ts)
and [SQLite history query test](../src/sqlite/executions.spec.ts).

Loop `max` is bounded to 1,000 by Spec validation. Every repeat iteration spends the shared
execution budget, including an empty body; durable loops check their count before allocating.
Durations use non-negative numeric seconds or explicit `ms`, `s`, `m`, `h`, `d` units.

`ruleExecution.maxCheckpointBytes` defaults to 8 MiB of serialized UTF-8 JSON. Oversized initial
checkpoints are rejected before creating an execution. If a later final checkpoint exceeds its
budget, the run is left at its last committed running checkpoint and can be explicitly failed;
effects are never automatically replayed or compensated after an uncertain final save. Increasing
the budget is an explicit trusted host decision, not something a Rule or model can request.

`KernelOptions.ruleExecution.executionObserver` is an optional trusted host seam for associating
durable runs with module entities. `created` is awaited after execution creation and before the
first effect; a rejected association leaves a failed execution without starting effects. `changed`
runs after checkpoint commits. A projection failure is passed to `failed`, never converted into
an execution failure or an automatic replay. Change payloads contain the original context, the
public details projection and root trigger; checkpoints remain Kernel-owned.

This is not an Event outbox or guaranteed delivery across process crashes. Hosts should retain a
durable association, write reports/receipts atomically and offer idempotent projection repair. Recheck
the original Actor's current authority when publishing; a reviewer's response does not lend their
authority to the execution. Do not invoke/resume the same execution recursively from an observer.

`WorkspaceClient.getRuleExecutionDetailsMany` reads up to 100 IDs through the execution persistence
port. IDs are deduplicated; missing, foreign-Workspace and inaccessible runs are omitted. Reading
another Actor's details still requires `executions.inspect`; a host association never grants that
permission. Providers own the physical batching implementation.

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
stable `fieldId`; authoring projects that to an ordinary friendly field selector.

User requests may include `description`, a RuleValue resolving to text. It is evaluated once when
the request is created and retained with the durable request, so an approver sees the actual
review context after reload. Non-text results fail explicitly. Hosts may provide a description
snippet to the request card/inspector for Markdown or another trusted presentation; the default
renders escaped text. Request Fields and response validation remain unchanged.
`{ $select: { from, where: { path?, op: "eq" | "ne", value } } }` filters a bound array without
embedding code. `path` reads a property from each item; omitting it compares whole items. This is
deliberately a small selection operation, not a general expression language.
`meta.now` is the scope's initial ISO timestamp; `meta.today` is its UTC `YYYY-MM-DD` date.
Both use the injected runtime clock and remain checkpointed across a durable wait, rather
than changing when a saved run resumes. Use the date binding for date-only Fields.

Every step and parallel branch has a stable ID. Authoring assigns one automatically when an author
adds an item, so trace and idempotency identity adds no authoring ceremony. Rule inputs, built-in
record triggers, Form triggers, and nested invocation use stable definition IDs. Action input is
owned by the immutable semantic contract registered under its Action key; custom Actions remain
portable opaque data rather than expanding the Kernel schema.

Actions inherit the execution Actor. `runAs` is optional and defaults to `trigger`; `system` and a
semantic Actor-binding key are explicit overrides. It may also be a `{ $ref }` whose runtime value
is one of those binding keys, allowing a `foreach` item to choose its own Actor. The resolver checks
current Membership and authorization separately for every invocation. A concrete User ID does not belong in portable
Spec. Workspace clients manage the instance mapping through `listActorBindings`, `putActorBinding`,
and `deleteActorBinding`; the default Kernel resolver rechecks that the bound Actor remains a member
when the step runs.

Structural validation and runtime compatibility are separate. A Spec remains valid when a host
does not install one of its Action, Condition, or Event contracts. `checkRuleCompatibility`
derives the required contracts and extensible capability keys. The Kernel's short runner performs
that preflight—including nested Rules—before the first side effect. Unknown executable semantics
are errors, even when they sit in a branch that would not have run.

`Kernel.runRule` calls a short Rule by key. `Kernel.dispatchEvent` preflights enabled matching Rules
and runs them in stable priority order, routing each to the short or durable runner from its actual
nested capabilities. `Kernel.executeAction` is the high-level Action path. Source inputs accept a
record ID and resolve through the unified Source boundary, so attached records remain valid Rule inputs.
Built-in `sources.list`, `views.list`, `records.create`, `records.get`, `records.list`,
`records.update`, and `records.delete`
Actions deliberately call the same Kernel CRUD methods as direct consumers; validation and
authorization therefore cannot drift. Custom Actions and Conditions are installed when the Kernel
opens, and every Action receives a coarse `actions.execute` policy check before its own
resource-level checks.

`rules.list` and `rules.save` expose the canonical Rule document through the same Action/tool seam.
The save Action creates one Rule or replaces an existing Rule by stable ID, fills only missing Rule,
step, and branch IDs, validates the complete resulting Spec, and requires ordinary `spec.update`
authority. Agents can inspect a Rule, make a structural change, and save it without a separate
orchestration API. A host should still review permissions and surface validation issues to the
author; this is a canonical document-editing tool, not an intent interpreter.

Workspace-owned runtime Actions use the same execution path and may be called directly, from a
Rule, or exposed directly as an Agent tool. See [Workspace settings and runtime Actions](workspace-actions.md).

Action outputs are discarded unless an Action step names them with `as`; named values become part
of `vars` for later steps. Rules are commands by default and require no output ceremony. A Rule
that acts as a value-producing function may declare `result` using the same `RuleValue` binding
language. Direct callers and agent tools receive that value. An `invoke` step stores a
declared child result under its `as` name; when the child has no result declaration, it stores the
child variable map instead. Actions and Rules remain separate even when either is callable or
exposed as a tool.

Output contracts are optional. A registered or Workspace-defined Action may declare an `output`
contract for its own implementation; an authored Action step may declare the result it expects; and
a Rule with `result` may declare its `output`. The contract describes a JSON kind and optionally
named object fields or array items. Declared fields are checked at runtime; extra object fields
remain allowed, so third-party payloads need not be exhaustively modeled. Undeclared outputs
remain open `JsonValue`. A mismatch fails the Action or Rule with a validation error. A Rule step
with captured compensation attempts it if an already-returned Action result fails the step's
contract. A registered Action's own output failure occurs before the Rule receives a result, so
external side effects still require idempotency/recovery policy.

An Agent-exposed Rule uses its semantic `key` as the model-facing tool name and its Rule
description as the tool description by default. Authors may set `tool: { name, description }`
to make either more specific without changing the Rule key or internal ID. The tool name may be
any provider-safe name (1–64 letters, numbers, underscores, or hyphens), provided it does not
collide with another tool offered in the same model step. The internal `rule:<id>` identity still
controls tool policy, dispatch, and authorization; agents see the authored name and description.

Record Actions identify their target with a stable `sourceId`; their authored `values` maps use
stable Field IDs, and resolved record values carry both the Source ID and an internal stable Field
map. Authoring and direct Form/record APIs remain key-oriented. This keeps simple authoring readable
while persisted Rules survive Collection and Field key renames—including Rules over attached
Sources—without rewriting consumer Specs. Reads therefore work uniformly across local Collections and attached Sources. Update and
delete may cross an Attachment only when its permission, target-side policy, resolved Actor membership,
and origin resource policy all permit the operation. `runAs` changes only the Actor—it never
bypasses those checks. Creating through an attached Source is deliberately unsupported because a
filtered slice does not yet define creation membership.

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

`inference.run` calls an installed InferenceRuntime and collects its final JSON result. It inherits the
Rule's current Actor; a semantic Agent binding in `runAs` is optional when the work needs an
independent identity. Agent Actors use their persisted instructions and ModelConfig; User/System
inference can supply a model selection or use a runtime default. Conversation storage remains host
state. See [Inference and Agents](agents.md).

The short runner bounds nesting, cascaded steps, loops, and repeats. `foreach` can run one item at a
time or concurrently with a positive concurrency limit (default four), with isolated item scopes.
`collect` evaluates one value per successful item and produces an array in source order; continued
failed items contribute `null`. `repeat.until` is checked after each iteration, while `times` is
always the hard upper bound. Parallel branches actually overlap asynchronous work, but all branches
settle before the join: `all` requires every branch to succeed, and `any` requires at least one.
No losing branch is abandoned in the background. Retries are process-local, and successful compensations capture their
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
{ waitId?, signal?, payload? })` continues a matching signal wait or an elapsed delay/timeout. When
several waits are pending, pass the `waitId` from `getRuleExecutionDetails().waits` (or a unique
signal). Numeric
durations are seconds; strings use `ms`, `s`, `m`, `h`, or `d` (for example `"30m"`). Unsupported
durations and executable semantics are rejected before the first Action. An elapsed deadline wins
over a late signal. Hosts arrange delivery/polling; the Kernel does not start timers, a scheduler,
or webhook listeners. Event dispatch creates ordinary persisted RuleExecutions for matching
durable Rules when the environment enables durable subscriptions.

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

Public execution summaries and details retain the optional original module `scope` handle.
Hosts can use it to associate a shared Rule's runs with the correct conversation or local surface.
The workspace history remains Actor-authorized, not implicitly filtered by the caller's current
scope. Placement metadata never grants inspection or resumption permission.

The original execution Actor stays the Actor after a reviewer responds. Resume checks current
membership and Rule authorization; Actions use ordinary current authorization and optional
`runAs`. Inspection/resumption of another Actor's execution and explicit termination require
management permission. A duplicate response or concurrent resume cannot claim the same revision.

Pending waits and the public `waiting` state commit together once the driver is quiescent. Parallel
lanes may have internal pending waits while other lanes still run; these are not published as
actionable requests until the driver suspends. A failed checkpoint acknowledgement cannot trigger
compensation or replay of preceding effects.

This is **not exactly-once external delivery**. A waiting-to-running compare-and-swap happens
before resumed effects. A crash or storage failure after an Action can leave its outcome uncertain;
a `running` execution is never automatically replayed. `failRuleExecution` explicitly terminates
it without replay or compensation. Hosts must investigate external outcomes; Actions should use
idempotency where appropriate. Known execution failures attempt captured compensations and become
terminal failures. If a response committed and subsequent work failed, inspect the request's
status before retrying it.

`getDurableRuleRuntimeProfile` reports the environment opt-in and installed contracts. Gates,
bounded loops, nested Rules, process-local retries, compensation, and Action overrides are supported.
The durable runner supports independent waits and ActorRequests inside static parallel branches
or a bounded parallel `foreach`. Branches are launched cooperatively up to the authored concurrency
limit (default four for `foreach`), then remain pending at the same time; responses may arrive in
any order, and fan-in preserves branch/item order. `join: any`
waits for every branch to settle and succeeds if at least one succeeded; it does not abandon
in-flight work. A failed branch in that mode attempts its own captured compensations. A failure
under `join: all` fails the execution and cancels outstanding requests. Per-item failure
continuation is supported only when the loop body does not wait; a wait inside such a loop is
rejected during preflight. The durable runner is a cooperative reference implementation, not a
distributed workflow engine.
