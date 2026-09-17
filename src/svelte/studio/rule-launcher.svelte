<script lang="ts">
  import type { RuleDefinition, FieldDefinition } from "@jthum/framework/spec";
  import type { RuleExecutionDetails } from "@jthum/framework/kernel";
  import type { RuleExecutionClient } from "@jthum/framework/client";
  import * as Card from "../ui/card/index.js";
  import * as Alert from "../ui/alert/index.js";
  import { Button } from "../ui/button/index.js";
  import { Spinner } from "../ui/spinner/index.js";
  import FieldInputs from "./field-inputs.svelte";
  import { fieldInputDefaults, parseFieldInputs, type ReferenceInput } from "./field-inputs.js";
  import { untrack } from "svelte";
  let { rule, client, onStarted, referenceInput }: { rule: RuleDefinition; client: RuleExecutionClient; onStarted: (execution: RuleExecutionDetails) => Promise<void> | void; referenceInput?: ReferenceInput } = $props();
  const fields = $derived(Object.entries(rule.input ?? {}).map(([key, input]): FieldDefinition => {
    const hasDefault = "default" in input && input.default !== undefined;
    const common = { id: key, key, label: key.replaceAll("_", " "), required: input.required && !hasDefault,
      ...(hasDefault ? { description: "Leave blank to use the workflow default." } : {}) };
    return "sourceId" in input ? { ...common, type: "reference", sourceId: input.sourceId }
      : input.value === "object" || input.value === "array" ? { ...common, type: "json" }
        : { ...common, type: input.value };
  }));
  let values = $state(untrack(() => fieldInputDefaults(fields)));
  let pending = $state(false);
  let error = $state("");
  async function submit(event: SubmitEvent) {
    event.preventDefault();
    if (pending) return;
    pending = true; error = "";
    try { await onStarted(await client.startRule(rule.key, { input: parseFieldInputs(fields, values) })); }
    catch (cause) { error = cause instanceof Error ? cause.message : "Unable to start this run."; }
    finally { pending = false; }
  }
</script>

<Card.Root>
  <Card.Header class="gap-0"><Card.Title>Run {rule.label}</Card.Title><Card.Description>{rule.description ?? "Provide the workflow inputs. Completed steps will not be rerun when a wait resumes."}</Card.Description></Card.Header>
  <Card.Content>
    <form onsubmit={submit} class="flex flex-col gap-5">
      <FieldInputs {fields} bind:values disabled={pending} {referenceInput} />
      {#if !fields.length}<p class="text-sm text-muted-foreground">This workflow does not require input.</p>{/if}
      {#if error}<Alert.Root variant="destructive"><Alert.Title>Run could not be started</Alert.Title><Alert.Description>{error}</Alert.Description></Alert.Root>{/if}
      <div class="flex justify-end"><Button type="submit" disabled={pending || rule.enabled === false}>{#if pending}<Spinner data-icon="inline-start" />{/if}Start run</Button></div>
    </form>
  </Card.Content>
</Card.Root>
