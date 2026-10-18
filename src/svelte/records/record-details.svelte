<script lang="ts">
  import type { Snippet } from "svelte";
  import * as Card from "../ui/card/index.js";
  import { cn } from "../utils.js";
  import type { RecordProperty } from "./data.js";

  let { title, description, typeLabel, properties = [], compact = false,
    showHeader = true, renderValue, summary, actions, metadata, children, class: className }: {
    title: string;
    description?: string;
    typeLabel?: string;
    properties?: readonly RecordProperty[];
    compact?: boolean;
    showHeader?: boolean;
    renderValue?: Snippet<[RecordProperty]>;
    summary?: Snippet;
    actions?: Snippet;
    metadata?: Snippet;
    children?: Snippet;
    class?: string;
  } = $props();

  const highlights = $derived(compact ? [] : properties.filter((property) => property.highlight && !property.multiline).slice(0, 3));
  const highlightKeys = $derived(new Set(highlights.map((property) => property.key)));
  const facts = $derived(properties.filter((property) => !property.multiline && !highlightKeys.has(property.key)));
  const narratives = $derived(properties.filter((property) => property.multiline));

  function text(value: unknown): string {
    if (value == null || value === "") return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }
</script>

<article class={cn("@container/record flex min-w-0 flex-col gap-7", compact && "bg-card px-5 py-6", className)} data-record-style="chrome" aria-label={title}>
  {#if showHeader}
    <header class="flex flex-col gap-3">
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex min-w-0 flex-1 flex-col gap-3">
          {#if typeLabel || summary}
            <div class="flex flex-wrap items-center gap-3">
              {#if typeLabel}<p class="text-xs font-medium tracking-wide text-muted-foreground">{typeLabel}</p>{/if}
              {@render summary?.()}
            </div>
          {/if}
          <svelte:element this={compact ? "h2" : "h1"} class={cn("leading-tight tracking-tight break-words text-balance", compact ? "text-xl font-medium" : "text-3xl font-semibold @lg/record:text-4xl")}>{title}</svelte:element>
        </div>
        {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
      </div>
      {#if description && !compact}<p class="max-w-prose text-base leading-relaxed whitespace-pre-wrap text-muted-foreground">{description}</p>{/if}
    </header>
  {:else}
    {#if summary}<div class="flex flex-wrap items-center gap-3 empty:hidden">{@render summary()}</div>{/if}
    {#if description && !compact}<p class="text-base leading-relaxed whitespace-pre-wrap text-muted-foreground">{description}</p>{/if}
    {#if actions}<div class="flex flex-wrap items-center gap-2">{@render actions()}</div>{/if}
  {/if}

  {#if highlights.length}
    <dl aria-label="At a glance" data-slot="record-highlights"
      class={cn("grid gap-3", highlights.length > 1 && "@xs/record:grid-cols-2", highlights.length > 2 && "@lg/record:grid-cols-3")}>
      {#each highlights as property (property.key)}
        <div class="flex min-w-0 flex-col gap-2 rounded-2xl border border-border/70 bg-card p-4">
          <dt class="text-xs font-medium text-muted-foreground">{property.label}</dt>
          <dd class="text-3xl font-semibold tracking-tight tabular-nums break-words">
            {#if renderValue}{@render renderValue(property)}{:else}{text(property.value)}{/if}
          </dd>
        </div>
      {/each}
    </dl>
  {/if}

  {#if compact}
    {#if facts.length}
      <section data-slot="record-overview" class="@container/details min-w-0" aria-label="Details">{@render fields()}</section>
    {/if}
    {#if description || narratives.length || children || metadata}
      <div data-slot="record-reading" class="flex min-w-0 flex-col gap-7">
        {#if description}
          <section class="flex min-w-0 flex-col gap-3" aria-label="Summary">
            <h3 class="text-xs font-semibold tracking-wide text-muted-foreground">Summary</h3>
            <p class="max-w-prose text-sm leading-7 whitespace-pre-wrap">{description}</p>
          </section>
        {/if}
        {@render longForm()}
        {@render children?.()}
        {@render timestamps()}
      </div>
    {/if}
  {:else if narratives.length || facts.length}
    <div class={cn("grid min-w-0 items-start gap-7", narratives.length && facts.length && "@3xl/record:grid-cols-[minmax(0,1.6fr)_minmax(16rem,1fr)]")}>
      {@render longForm()}
      {#if facts.length}
        <Card.Root class="h-auto min-w-0">
          <Card.Header><Card.Title role="heading" aria-level={2}>Details</Card.Title></Card.Header>
          <Card.Content>
            <div class="@container/details">{@render fields()}</div>
          </Card.Content>
        </Card.Root>
      {/if}
    </div>
  {/if}
  {#if !compact}
    {@render children?.()}
    {@render timestamps()}
  {/if}
</article>

{#snippet fields()}
  <dl data-slot="record-fields" class={cn("grid gap-x-8", compact ? "gap-y-6 @xs/details:grid-cols-2" : "@2xl/details:grid-cols-2")}>
    {#each facts as property (property.key)}
      <div class={cn("min-w-0", compact ? "flex flex-col gap-1" : "grid grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)] items-baseline gap-4 border-b border-border/35 py-3 last:border-b-0")}>
        <dt class={cn("text-muted-foreground break-words", compact ? "text-[0.6875rem] font-medium tracking-wide" : "text-xs")}>{property.label}</dt>
        <dd class={cn("min-w-0 font-medium break-words", compact ? "text-[0.9375rem] leading-relaxed tabular-nums" : "text-sm")}>{#if renderValue}{@render renderValue(property)}{:else}{text(property.value)}{/if}</dd>
      </div>
    {/each}
  </dl>
{/snippet}

{#snippet longForm()}
  {#if narratives.length}
    <div class="flex min-w-0 flex-col gap-7">
      {#each narratives as property (property.key)}
        <section class="flex flex-col gap-3" aria-label={property.label}>
          <svelte:element this={compact ? "h3" : "h2"} class={cn("font-semibold", compact ? "text-xs tracking-wide text-muted-foreground" : "text-base tracking-tight")}>{property.label}</svelte:element>
          <div class="max-w-prose text-sm leading-7 whitespace-pre-wrap break-words">{#if renderValue}{@render renderValue(property)}{:else}{text(property.value)}{/if}</div>
        </section>
      {/each}
    </div>
  {/if}
{/snippet}

{#snippet timestamps()}
  {#if metadata}<footer class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground empty:hidden">{@render metadata()}</footer>{/if}
{/snippet}
