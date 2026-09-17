<script lang="ts">
  import FormEditor from "./form-editor.svelte";
  import type { EditorContext, FormDraft } from "./authoring.js";
  let { context, form }: { context: EditorContext; form: FormDraft } = $props();
  const untouched = async () => { throw new Error("Rendering must not call host services"); };
</script>
<FormEditor {context} {form}
  actions={{ save: untouched, remove: untouched, prepareField: () => { throw new Error("Rendering must not normalize fields"); } }}
  onDeleted={untouched} onCreateRule={untouched}
  ruleHref={rule => `/recipes/${rule.key}`} describeRule={rule => rule.label}
>
  {#snippet previewContent(preview)}
    <div data-host-form-preview>{preview.form.label}</div>
  {/snippet}
</FormEditor>
