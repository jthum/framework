<script lang="ts">
  import type { FieldDefinition } from "@jthum/framework/spec";
  import * as Field from "../ui/field/index.js";
  import { Input } from "../ui/input/index.js";
  import { Textarea } from "../ui/textarea/index.js";
  import { Checkbox } from "../ui/checkbox/index.js";
  import * as NativeSelect from "../ui/native-select/index.js";
  import { fieldInputState, parseFieldInputs, type FieldInputValues, type ReferenceInput } from "./field-inputs.js";
  let { fields, values = $bindable({}), disabled = false, errors = {}, referenceInput }: {
    fields: readonly FieldDefinition[];
    values?: FieldInputValues;
    disabled?: boolean;
    errors?: Readonly<Record<string, string>>;
    referenceInput?: ReferenceInput;
  } = $props();
  const prefix = $props.id();
  function change(field: FieldDefinition, value: string | string[]) { values = { ...values, [field.key]: value }; }
</script>

<Field.Group>
  {#each fields as field (field.id)}
    {@const state = fieldInputState(fields, field, values)}
    {@const id = `${prefix}-${field.id}`}
    {#if state.visible}
      <Field.Field data-invalid={!!errors[field.key]} data-disabled={disabled || !state.enabled}>
        {#if !(field.type === "choice" && field.multiple)}<Field.Label for={id}>{field.label}{state.required ? " *" : ""}</Field.Label>{/if}
        {#if referenceInput && field.type === "reference"}
          {@render referenceInput(field, id, parseFieldInputs([field], values, false)[field.key], value => change(field, value), { disabled: disabled || !state.enabled, required: state.required, invalid: !!errors[field.key] })}
        {:else if field.type === "boolean"}
          <NativeSelect.Root {id} class="w-full" value={String(values[field.key] ?? "")} disabled={disabled || !state.enabled} required={state.required} aria-invalid={!!errors[field.key]} onchange={event => change(field, event.currentTarget.value)}>
            <NativeSelect.Option value="">Select</NativeSelect.Option>
            <NativeSelect.Option value="true">Yes</NativeSelect.Option>
            <NativeSelect.Option value="false">No</NativeSelect.Option>
          </NativeSelect.Root>
        {:else if field.type === "choice" && field.multiple}
          {@const chosen = Array.isArray(values[field.key]) ? values[field.key] as string[] : []}
          <Field.Set aria-required={state.required} aria-invalid={!!errors[field.key]}>
            <Field.Legend variant="label">{field.label}{state.required ? " *" : ""}</Field.Legend>
            <Field.Group class="gap-3">{#each field.options as option (option.id)}
              <Field.Field orientation="horizontal"><Checkbox id={`${id}-${option.id}`} checked={chosen.includes(option.key)} disabled={disabled || !state.enabled} aria-invalid={!!errors[field.key]} onCheckedChange={checked => change(field, checked ? [...chosen, option.key] : chosen.filter(value => value !== option.key))} /><Field.Label for={`${id}-${option.id}`}>{option.label}</Field.Label></Field.Field>
            {/each}</Field.Group>
          </Field.Set>
        {:else if field.type === "choice"}
          <NativeSelect.Root {id} class="w-full" value={values[field.key]} disabled={disabled || !state.enabled} required={state.required} aria-invalid={!!errors[field.key]} onchange={event => change(field, event.currentTarget.value)}>
            <NativeSelect.Option value="">Select</NativeSelect.Option>
            {#each field.options as option (option.id)}<NativeSelect.Option value={option.key}>{option.label}</NativeSelect.Option>{/each}
          </NativeSelect.Root>
        {:else if field.type === "json" || (field.type === "reference" && field.multiple)}
          <Textarea {id} value={Array.isArray(values[field.key]) ? JSON.stringify(values[field.key]) : String(values[field.key] ?? "")} disabled={disabled || !state.enabled} required={state.required} aria-invalid={!!errors[field.key]} oninput={event => change(field, event.currentTarget.value)} />
        {:else}
          <Input {id} type={field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : field.type === "date" ? "date" : field.type === "text" && field.format === "email" ? "email" : field.type === "text" && field.format === "url" ? "url" : "text"} step={field.type === "number" || field.type === "datetime" ? "any" : undefined} value={String(values[field.key] ?? "")} disabled={disabled || !state.enabled} required={state.required} aria-invalid={!!errors[field.key]} oninput={event => change(field, event.currentTarget.value)} />
        {/if}
        {#if field.description}<Field.Description>{field.description}</Field.Description>{/if}
        {#if field.type === "reference" && !referenceInput}<Field.Description>{field.multiple ? "Enter a JSON array of record IDs." : "Enter the referenced record ID."}</Field.Description>{/if}
        {#if errors[field.key]}<Field.Error>{errors[field.key]}</Field.Error>{/if}
      </Field.Field>
    {/if}
  {/each}
</Field.Group>
