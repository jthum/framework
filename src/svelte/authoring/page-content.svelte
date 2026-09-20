<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PageBlockNode, PageLayoutNode } from "../../spec/model.ts";
  import type { BlockDefinition } from "../../blocks/model.ts";
  import { gridClass, groupHeightClass } from "./page-layout.ts";
  import { cn } from "../utils.ts";
  import PageContent from "./page-content.svelte";

  let { layout, blocks, renderBlock }: {
    layout: readonly PageLayoutNode[];
    blocks: readonly BlockDefinition[];
    renderBlock: Snippet<[PageBlockNode]>;
  } = $props();
</script>

{#each layout as node (node.id)}
  {#if node.kind === "group"}
    <div class={cn(gridClass(node.columns ?? 1), "items-stretch", groupHeightClass(node, blocks))}>
      {#each node.children as child (child.id)}
        <div class={cn("flex h-full min-h-0 flex-col", groupHeightClass(node, blocks))}>
          <PageContent layout={[child]} {blocks} {renderBlock} />
        </div>
      {/each}
    </div>
  {:else}
    {@render renderBlock(node)}
  {/if}
{/each}
