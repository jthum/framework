<script lang="ts">
  import { onMount, type Snippet } from "svelte";
  import { Button } from "../ui/button/index.js";
  import { cn } from "../utils.js";
  import XIcon from "@lucide/svelte/icons/x";
  import ExternalLinkIcon from "@lucide/svelte/icons/external-link";

  let { title, description, href, onClose, navigation, summary, children, class: className }: {
    title: string;
    description?: string;
    href?: string;
    onClose: () => void;
    navigation?: Snippet;
    summary?: Snippet;
    children?: Snippet;
    class?: string;
  } = $props();
  const id = $props.id();
  let panel: HTMLElement;
  // A normal complementary region: no modal overlay, scroll lock or focus trap.
  onMount(() => panel.focus({ preventScroll: true }));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions (Escape closes this non-modal complementary region; focus is never trapped.) -->
<aside bind:this={panel} tabindex="-1" aria-labelledby={`${id}-title`} aria-describedby={description ? `${id}-description` : undefined}
  data-record-style="chrome"
  class={cn("flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface-chrome p-1 outline-none", className)}
  onkeydown={(event) => {
    if (event.key === "Escape" && !event.defaultPrevented) { event.stopPropagation(); onClose(); }
  }}>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl">
    <header class="flex shrink-0 items-center gap-3 px-5 py-2.5">
      <div class="min-w-0 flex-1">
        <div data-slot="record-identity" class="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 id={`${id}-title`} class="min-w-0 text-lg leading-snug font-medium tracking-tight break-words text-balance">{title}</h2>
          {#if summary}<div class="flex items-center gap-2 empty:hidden">{@render summary()}</div>{/if}
        </div>
        {#if description}<p id={`${id}-description`} class="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>{/if}
      </div>
      <Button variant="ghost" size="icon-sm" onclick={onClose} aria-label="Close details"><XIcon /></Button>
    </header>
    <div data-slot="record-panel-content" class="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border bg-card">{@render children?.()}</div>
    {#if href || navigation}
      <footer data-slot="record-navigation" class="flex shrink-0 flex-wrap items-center justify-between gap-3 px-4 py-1.5">
        {#if href}<Button {href} variant="ghost" size="sm">Open full page<ExternalLinkIcon data-icon="inline-end" /></Button>{/if}
        <div class="ml-auto flex items-center gap-1 empty:hidden">{@render navigation?.()}</div>
      </footer>
    {/if}
  </div>
</aside>
