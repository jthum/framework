<script lang="ts">
  import ViewEditor from "./view-editor.svelte";
  import type { EditorContext, ViewDraft } from "./authoring.js";
  let { context, view }: { context: EditorContext; view: ViewDraft } = $props();
  const untouched = async () => { throw new Error("Rendering must not call host services"); };
</script>
<ViewEditor {context} {view} actions={{ save: untouched, remove: untouched, query: untouched }} onOpen={untouched} onDeleted={untouched}>
  {#snippet previewContent(preview)}
    <div data-host-preview>{preview.view.label}</div>
  {/snippet}
</ViewEditor>
