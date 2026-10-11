<script lang="ts">
  import type { PageDefinition } from "../../spec/model.ts";
  import PageEditor from "../../svelte/authoring/page-editor.svelte";
  import PageList from "../../svelte/authoring/page-list.svelte";

  let {
    page,
    listing = false,
    editing = false,
  }: { page: PageDefinition; listing?: boolean; editing?: boolean } = $props();
  const blocks = [{ key: "custom", label: "Custom Block", category: "custom" }];
</script>

{#if listing}
  <PageList
    definitions={[page]}
    upsertPage={async () => {}}
    deletePage={async () => {}}
    replacePages={async () => {}}
    pageHref={(page) => `/screens/${page.key}`}
  />
{:else}
  <PageEditor
    {page}
    title={page.label}
    {blocks}
    startEditing={editing}
    onSave={async () => {}}
  >
    {#snippet renderBlock(node)}
      <p data-block-id={node.id}>{node.config?.title ?? "Custom content"}</p>
    {/snippet}
  </PageEditor>
{/if}
