<script lang="ts">
  import type { ActorRequest, RuleExecutionDetails } from "@jthum/framework/kernel";
  import type { RuleExecutionClient } from "@jthum/framework/client";
  import * as Card from "../ui/card/index.js";
  import * as Alert from "../ui/alert/index.js";
  import * as Field from "../ui/field/index.js";
  import * as Empty from "../ui/empty/index.js";
  import { Badge } from "../ui/badge/index.js";
  import { Button } from "../ui/button/index.js";
  import { Textarea } from "../ui/textarea/index.js";
  import { Spinner } from "../ui/spinner/index.js";
  import ActorRequestCard from "./actor-request.svelte";
  import type { ReferenceInput } from "./field-inputs.js";
  let { execution, requests = [], client, actorName, onChange, canTerminate = false, referenceInput }: {
    execution: RuleExecutionDetails;
    requests?: readonly ActorRequest[];
    client: RuleExecutionClient;
    actorName?: string;
    onChange: () => Promise<void>;
    canTerminate?: boolean;
    referenceInput?: ReferenceInput;
  } = $props();
  let pending = $state(false);
  let error = $state("");
  let payload = $state("{}");
  let confirming = $state(false);
  async function perform(work: () => Promise<unknown>) {
    if (pending) return;
    pending = true; error = "";
    try { await work(); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Unable to update this run."; }
    finally { await onChange().catch(() => {}); pending = false; }
  }
  async function resume() {
    await perform(async () => {
      const parsed = JSON.parse(payload);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Signal payload must be a JSON object.");
      await client.resumeRule(execution.id, execution.waiting?.signal ? { signal: execution.waiting.signal, payload: parsed } : {});
    });
  }
</script>

<div class="flex min-w-0 flex-col gap-5">
  <Card.Root>
    <Card.Header class="gap-0">
      <Card.Title>{execution.rule.label}</Card.Title>
      <Card.Description>{execution.status === "waiting" ? "Paused safely. You can leave this page and return later." : execution.status === "completed" ? "All steps have finished." : execution.status === "failed" ? "This run has stopped. It will not be replayed automatically." : "Running or interrupted. Refresh to check its latest state."}</Card.Description>
      <Card.Action><Badge variant={execution.status === "failed" ? "destructive" : execution.status === "waiting" ? "default" : "outline"}>{execution.status === "waiting" ? "Waiting" : execution.status === "completed" ? "Completed" : execution.status === "failed" ? "Failed" : "Running"}</Badge></Card.Action>
    </Card.Header>
    <Card.Content>
      <dl class="grid gap-4 sm:grid-cols-2">
        <div><dt class="text-xs text-muted-foreground">Execution actor</dt><dd class="break-all text-sm">{actorName ?? execution.actorId}</dd></div>
        <div><dt class="text-xs text-muted-foreground">Started</dt><dd class="text-sm">{execution.createdAt.replace("T", " ").replace(".000Z", " UTC")}</dd></div>
        <div class="sm:col-span-2"><dt class="text-xs text-muted-foreground">Run ID</dt><dd class="break-all font-mono text-xs">{execution.id}</dd></div>
      </dl>
    </Card.Content>
    <Card.Footer class="justify-end"><Button variant="outline" disabled={pending} onclick={() => perform(onChange)}>{#if pending}<Spinner data-icon="inline-start" />{/if}Refresh</Button></Card.Footer>
  </Card.Root>

  {#if error}<Alert.Root variant="destructive"><Alert.Title>Run could not be updated</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
  {#if execution.failure}<Alert.Root variant="destructive"><Alert.Title>Why this run stopped</Alert.Title><Alert.Description>{execution.failure}</Alert.Description></Alert.Root>{/if}
  {#if execution.vars && Object.keys(execution.vars).length}
    <Card.Root><Card.Header class="gap-0"><Card.Title>{execution.status === "completed" ? "Result" : "Current values"}</Card.Title><Card.Description>{execution.status === "completed" ? "Values returned by the completed workflow." : "The workflow inputs and values at this checkpoint."}</Card.Description></Card.Header><Card.Content><dl class="flex flex-col gap-4">{#each Object.entries(execution.vars) as [key, value] (key)}<div><dt class="text-xs text-muted-foreground">{key.replaceAll("_", " ")}</dt><dd class="break-words whitespace-pre-wrap text-sm">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</dd></div>{/each}</dl></Card.Content></Card.Root>
  {/if}

  {#each requests as request (request.id)}
    <ActorRequestCard {request} {referenceInput} onRespond={async values => {
      try { await client.respondToActorRequest(execution.id, request.id, values); }
      finally { await onChange(); }
    }} />
  {/each}

  {#if execution.waiting}
    <Card.Root>
      <Card.Header class="gap-0"><Card.Title>{execution.waiting.kind === "request" ? "Waiting for a response" : execution.waiting.kind === "signal" ? "Waiting for a signal" : "Waiting until the deadline"}</Card.Title><Card.Description>{execution.waiting.dueAt ? `Deadline: ${execution.waiting.dueAt}` : "This wait has no deadline."}</Card.Description></Card.Header>
      <Card.Content>
        {#if execution.waiting.kind === "signal"}
          <Field.Group><Field.Field><Field.Label for="signal-{execution.id}">Payload for “{execution.waiting.signal}”</Field.Label><Textarea id="signal-{execution.id}" bind:value={payload} disabled={pending} /><Field.Description>Sending this signal will continue the workflow with this JSON object.</Field.Description></Field.Field></Field.Group>
        {:else if execution.waiting.kind === "request" && !requests.some(request => request.status === "pending")}
          <p class="text-sm text-muted-foreground">The assigned user must respond. Responding does not change the execution actor.</p>
        {:else if execution.waiting.kind !== "request"}
          <p class="text-sm text-muted-foreground">Continue after the deadline. The runtime checks whether this wait is due.</p>
        {/if}
      </Card.Content>
      {#if execution.waiting.kind !== "request" || execution.waiting.dueAt}
        <Card.Footer class="justify-end"><Button disabled={pending} onclick={resume}>{execution.waiting.kind === "signal" ? "Send signal" : execution.waiting.kind === "request" ? "Continue after timeout" : "Continue when due"}</Button></Card.Footer>
      {/if}
    </Card.Root>
  {/if}

  <Card.Root>
    <Card.Header class="gap-0"><Card.Title>Progress</Card.Title><Card.Description>{execution.trace.length} recorded step{execution.trace.length === 1 ? "" : "s"}. Repeated steps appear in execution order.</Card.Description></Card.Header>
    <Card.Content>
      {#if execution.trace.length}
        <ol class="flex flex-col divide-y divide-border/50">
          {#each execution.trace as step, index (`${step.stepId}-${index}`)}
            <li class="flex items-start gap-3 py-3"><span class="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs text-muted-foreground">{index + 1}</span><div class="min-w-0 flex-1"><p class="text-sm font-medium">{step.label ?? step.kind}</p><p class="break-all text-xs text-muted-foreground">{step.stepId}</p></div><Badge variant="outline">{step.status}</Badge></li>
          {/each}
        </ol>
      {:else}<Empty.Root><Empty.Header><Empty.Title>No completed steps yet</Empty.Title><Empty.Description>The run may be waiting at its first step.</Empty.Description></Empty.Header></Empty.Root>{/if}
    </Card.Content>
  </Card.Root>

  {#if canTerminate && execution.status === "running"}
    <Alert.Root><Alert.Title>Interrupted run?</Alert.Title><Alert.Description>Investigate any external effects first. Terminating marks the run failed without replay or compensation.</Alert.Description>
      {#if confirming}<div class="mt-3 flex flex-wrap gap-2"><Button variant="destructive" disabled={pending} onclick={() => perform(() => client.failRuleExecution(execution.id))}>Confirm termination</Button><Button variant="outline" onclick={() => confirming = false}>Cancel</Button></div>
      {:else}<div class="mt-3"><Button variant="outline" onclick={() => confirming = true}>Terminate interrupted run</Button></div>{/if}
    </Alert.Root>
  {/if}
</div>
