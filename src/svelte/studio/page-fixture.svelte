<script lang="ts">
  import type { PageDefinition } from "../../spec/model.ts";
  import PageEditor from "./page-editor.svelte";
  import PageList from "./page-list.svelte";

  let { page, listing = false }: { page: PageDefinition; listing?: boolean } = $props();
  const blocks = [{ key: "custom", label: "Custom Block", category: "custom" }];
</script>

{#if listing}
  <PageList definitions={[page]} upsertPage={async () => {}} deletePage={async () => {}}
    replacePages={async () => {}} pageHref={page => `/screens/${page.key}`} />
{:else}
  <PageEditor {page} title={page.label} {blocks} onSave={async () => {}}>
    {#snippet renderBlock(node)}
      <p data-block-id={node.id}>{node.config?.title ?? "Custom content"}</p>
    {/snippet}
  </PageEditor>
{/if}
