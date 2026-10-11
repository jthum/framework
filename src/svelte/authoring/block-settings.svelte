<script lang="ts">
  import {
    presentError,
    type PresentedError,
  } from "../internal/error-presentation.ts";
  import ErrorMessage from "../internal/error-message.svelte";
  import OptionSelect from "../ui/option-select/option-select.svelte";
  import { Button } from "../ui/button/index.ts";
  import * as Field from "../ui/field/index.ts";
  import { Input } from "../ui/input/index.ts";
  import * as Sheet from "../ui/sheet/index.ts";
  import { Switch } from "../ui/switch/index.ts";
  import { Textarea } from "../ui/textarea/index.ts";
  import type { JsonValue, PageBlockNode, SpecMeta } from "../../spec/model.ts";
  import type {
    BlockDefinition,
    BlockInputDefinition,
  } from "../../blocks/model.ts";
  import { untrack } from "svelte";

  let {
    open = $bindable(false),
    node = null,
    definition,
    inputs,
    getOptions = (input) => input.options ?? [],
    onSave,
    presentation = "sheet",
    getValue = (input, config) => config[input.key] ?? input.default ?? "",
    setValue = (input, value, config) => ({ ...config, [input.key]: value }),
    onCancel,
    onDirtyChange,
  }: {
    open?: boolean;
    node?: PageBlockNode | null;
    definition?: BlockDefinition;
    inputs?: readonly BlockInputDefinition[];
    getOptions?: (
      input: BlockInputDefinition,
      config: SpecMeta,
      definition?: BlockDefinition,
    ) => readonly { value: string; label: string }[];
    onSave: (config: SpecMeta) => void | Promise<void>;
    presentation?: "sheet" | "inline";
    getValue?: (input: BlockInputDefinition, config: SpecMeta) => JsonValue;
    setValue?: (
      input: BlockInputDefinition,
      value: JsonValue,
      config: SpecMeta,
    ) => SpecMeta;
    onCancel?: () => void;
    onDirtyChange?: (dirty: boolean) => void;
  } = $props();

  const def = $derived(definition);
  let config = $state<SpecMeta>(
    untrack(() => JSON.parse(JSON.stringify(node?.config ?? {})) as SpecMeta),
  );
  let pending = $state(false);
  let error = $state<PresentedError | null>(null);
  let initializedNode = "";
  let initial = $state(untrack(() => JSON.stringify(config)));
  const prefix = $props.id();
  $effect(() => {
    onDirtyChange?.(open && JSON.stringify(config) !== initial);
  });

  $effect(() => {
    if (!open) {
      initializedNode = "";
      return;
    }
    const identity = node?.id ?? "";
    if (initializedNode === identity) return;
    initializedNode = identity;
    untrack(() => {
      config = node
        ? (JSON.parse(JSON.stringify(node.config ?? {})) as SpecMeta)
        : {};
      initial = JSON.stringify(config);
      error = null;
    });
  });

  async function submit(event: Event) {
    event.preventDefault();
    if (pending) return;
    pending = true;
    error = null;
    try {
      await onSave(JSON.parse(JSON.stringify(config)) as SpecMeta);
      initial = JSON.stringify(config);
      if (presentation === "sheet") open = false;
    } catch (cause) {
      error = presentError(cause, "Couldn't save the block");
    } finally {
      pending = false;
    }
  }
</script>

{#if presentation === "inline"}
  {#if open}<form class="flex flex-col gap-5" onsubmit={submit}>
      <div>
        <h3 class="font-semibold">{def?.label ?? "Block"}</h3>
        {#if def?.description}<p
            class="mt-1 text-sm leading-5 text-muted-foreground"
          >
            {def.description}
          </p>{/if}
      </div>
      {@render fields()}
      <div class="flex gap-2">
        <Button type="submit" disabled={pending}
          >{pending ? "Saving…" : "Apply changes"}</Button
        ><Button
          type="button"
          variant="ghost"
          disabled={pending}
          onclick={() => {
            open = false;
            onCancel?.();
          }}>Cancel</Button
        >
      </div>
    </form>{/if}
{:else}<Sheet.Root bind:open>
    <Sheet.Content class="sm:max-w-md" side="right">
      <form class="flex h-full min-h-0 flex-col" onsubmit={submit}>
        <Sheet.Header>
          <Sheet.Title>{def?.label ?? "Block"}</Sheet.Title>
          <Sheet.Description>
            {def?.description ?? "Configure this block."}
          </Sheet.Description>
        </Sheet.Header>
        <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
          {@render fields()}
        </div>
        <Sheet.Footer class="flex-row justify-end">
          <Button
            type="button"
            variant="outline"
            onclick={() => {
              open = false;
              onCancel?.();
            }}>Cancel</Button
          >
          <Button type="submit" disabled={pending}>Save</Button>
        </Sheet.Footer>
      </form>
    </Sheet.Content>
  </Sheet.Root>{/if}

{#snippet fields()}
  <Field.Group>
    {#each inputs ?? def?.inputs ?? [] as input (input.key)}
      {#if input.type === "boolean"}
        <Field.Field orientation="horizontal">
          <Switch
            id={`${prefix}-${input.key}`}
            disabled={pending}
            checked={Boolean(getValue(input, config))}
            onCheckedChange={(checked) =>
              (config = setValue(input, checked, config))}
          />
          <Field.Label for={`${prefix}-${input.key}`}>{input.label}</Field.Label
          >
        </Field.Field>
      {:else}
        <Field.Field>
          <Field.Label for={`${prefix}-${input.key}`}>{input.label}</Field.Label
          >
          {#if input.type === "textarea"}
            <Textarea
              id={`${prefix}-${input.key}`}
              disabled={pending}
              required={input.required}
              value={String(getValue(input, config))}
              oninput={(event) =>
                (config = setValue(input, event.currentTarget.value, config))}
            />
          {:else if input.type === "number"}
            <Input
              type="number"
              id={`${prefix}-${input.key}`}
              disabled={pending}
              required={input.required}
              value={getValue(input, config) === ""
                ? ""
                : Number(getValue(input, config))}
              oninput={(event) =>
                (config = setValue(
                  input,
                  Number.isFinite(event.currentTarget.valueAsNumber)
                    ? event.currentTarget.valueAsNumber
                    : "",
                  config,
                ))}
            />
          {:else if ["view", "form", "rule", "field", "select"].includes(input.type)}
            <OptionSelect
              id={`${prefix}-${input.key}`}
              disabled={pending}
              required={input.required}
              value={String(getValue(input, config))}
              onValueChange={(value) =>
                (config = setValue(input, value, config))}
              options={getOptions(input, config, def)}
              placeholder="Select"
            />
          {:else}
            <Input
              id={`${prefix}-${input.key}`}
              disabled={pending}
              required={input.required}
              value={String(getValue(input, config))}
              oninput={(event) =>
                (config = setValue(input, event.currentTarget.value, config))}
              data-testid={input.key === "title"
                ? "block-title"
                : "block-field"}
            />
          {/if}
          {#if input.description}
            <Field.Description>{input.description}</Field.Description>
          {/if}
        </Field.Field>
      {/if}
    {/each}
  </Field.Group>
  {#if error}<ErrorMessage {error} />{/if}
{/snippet}
