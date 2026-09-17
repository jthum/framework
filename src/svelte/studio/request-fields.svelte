<script lang="ts">
  import type { FieldDefinition } from "@jthum/framework/spec";
  import type { CollectionDraft, FieldDraft } from "./authoring.js";
  import { cloneData } from "./editor-data.js";
  import { fieldDraftFromDefinition, fieldDefinitionFromDraft, removeFieldDefinition } from "./field-adapter.js";
  import FormInputSheet from "./form-input-sheet.svelte";
  import { Button } from "../ui/button/index.js";
  import * as Field from "../ui/field/index.js";
  import { nanoid } from "nanoid";

  let { fields, types, onChange }: { fields: readonly FieldDefinition[]; types: CollectionDraft[]; onChange: (fields: readonly FieldDefinition[]) => void } = $props();
  const drafts = $derived(fields.filter(field => field.type !== "json").map(field => fieldDraftFromDefinition(field, fields, types)));
  let open = $state(false);
  let editing = $state<FieldDraft | null>(null);
  function save(patch: Partial<FieldDraft> & { key: string }) {
    const previous = fields.find(field => field.id === patch.id);
    const draft = cloneData({ ...drafts.find(field => field.id === patch.id), ...patch, id: patch.id ?? nanoid() }) as FieldDraft;
    const siblings = previous ? fields.map(field => field.id === draft.id ? draft : field) : [...fields, draft];
    const definition = fieldDefinitionFromDraft(draft, siblings, types, previous);
    onChange(previous ? fields.map(field => field.id === definition.id ? definition : field) : [...fields, definition]);
  }
  function remove(input: FieldDraft) {
    onChange(removeFieldDefinition(fields, input.id));
  }
</script>

<Field.Set>
  <Field.Legend>Response fields</Field.Legend>
  <Field.Description>Collect a decision or other information. These values are available to later steps.</Field.Description>
  <div class="flex flex-col gap-2">
    {#each fields as field (field.id)}
      {#if field.type === "json"}<p class="text-sm text-muted-foreground">{field.label} · JSON (preserved; not yet editable in the field sheet)</p>{:else}
      <Button variant="outline" class="h-auto justify-between p-3" onclick={() => { editing = drafts.find(item => item.id === field.id) ?? null; open = true; }}>
        <span>{field.label}{field.required ? " *" : ""}</span><span class="text-muted-foreground">{field.type}</span>
      </Button>
      {/if}
    {/each}
    <Button variant="outline" class="w-fit" onclick={() => { editing = null; open = true; }}>Add response field</Button>
  </div>
</Field.Set>
<FormInputSheet bind:open input={editing} inputs={drafts} {types} onSave={save} onRemove={remove} />
