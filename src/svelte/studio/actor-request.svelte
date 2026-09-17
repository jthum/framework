<script lang="ts">
  import type { ActorRequest } from "@jthum/framework/kernel";
  import type { JsonValue } from "@jthum/framework/spec";
  import * as Card from "../ui/card/index.js";
  import * as Alert from "../ui/alert/index.js";
  import { Badge } from "../ui/badge/index.js";
  import { Button } from "../ui/button/index.js";
  import { Spinner } from "../ui/spinner/index.js";
  import FieldInputs from "./field-inputs.svelte";
  import { fieldInputDefaults, parseFieldInputs, type FieldInputValues, type ReferenceInput } from "./field-inputs.js";
  import { untrack } from "svelte";
  let { request, onRespond, referenceInput }: { request: ActorRequest; onRespond: (values: Readonly<Record<string, JsonValue>>) => Promise<unknown>; referenceInput?: ReferenceInput } = $props();
  let values = $state<FieldInputValues>(untrack(() => fieldInputDefaults(request.fields)));
  let identity = $state(untrack(() => request.id));
  let pending = $state(false);
  let error = $state("");
  let errors = $state<Record<string, string>>({});
  $effect.pre(() => {
    if (identity === request.id) return;
    identity = request.id;
    untrack(() => { values = fieldInputDefaults(request.fields); error = ""; errors = {}; });
  });
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending || request.status !== "pending") return;
    pending = true; error = ""; errors = {};
    try { await onRespond(parseFieldInputs(request.fields, values)); }
    catch (cause) {
      error = cause instanceof Error ? cause.message : "Unable to submit this response.";
      const issues = (cause as { issues?: readonly { path: string; message: string }[] } | null)?.issues ?? [];
      errors = Object.fromEntries(issues.filter(issue => issue.path.startsWith("values.")).map(issue => [issue.path.slice(7), issue.message]));
    } finally { pending = false; }
  }
</script>

<Card.Root>
  <Card.Header class="gap-0">
    <Card.Title>{request.label}</Card.Title>
    <Card.Description>{request.status === "pending" ? "Your response will continue this workflow." : request.status === "responded" ? "Your response has been recorded." : "This request has expired."}</Card.Description>
    <Card.Action><Badge variant={request.status === "pending" ? "default" : "outline"}>{request.status === "pending" ? "Needs your response" : request.status === "responded" ? "Responded" : "Expired"}</Badge></Card.Action>
  </Card.Header>
  <Card.Content>
    {#if request.status === "pending"}
      <form onsubmit={submit} class="flex flex-col gap-5">
        <FieldInputs fields={request.fields} bind:values disabled={pending} {errors} {referenceInput} />
        {#if !request.fields.length}<p class="text-sm text-muted-foreground">Confirm when you are ready to continue.</p>{/if}
        {#if error}<Alert.Root variant="destructive"><Alert.Title>Response could not be completed</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
        <div class="flex justify-end"><Button type="submit" disabled={pending}>{#if pending}<Spinner data-icon="inline-start" />{/if}Submit response</Button></div>
      </form>
    {:else if request.values}
      <dl class="flex flex-col gap-3">{#each request.fields as field (field.id)}<div><dt class="text-xs text-muted-foreground">{field.label}</dt><dd class="break-words text-sm">{JSON.stringify(request.values[field.key] ?? null)}</dd></div>{/each}</dl>
    {/if}
  </Card.Content>
</Card.Root>
