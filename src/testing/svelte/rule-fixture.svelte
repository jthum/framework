<script lang="ts">
  import RuleEditor from "../../svelte/authoring/rule-editor.svelte";
  import RuleSteps from "../../svelte/authoring/automation-step-list.svelte";
  import type { EditorContext } from "../../svelte/authoring/authoring.js";
  import type { RuleDraft, RuleStep } from "../../svelte/authoring/rule-model.js";
  let { context, rule, steps }: { context: EditorContext; rule: RuleDraft; steps?: RuleStep[] } = $props();
  const untouched = async () => { throw new Error("Rendering must not call host services"); };
  const effects = [{ key: "mail.send", label: "Send a message", input: { subject: "text" } }];
</script>
{#if steps}
  <RuleSteps {steps} {effects} types={context.collections} workflows={context.rules} spec={context} inputName="record" inputType="contact" onStepsChange={untouched} />
{:else}
  <RuleEditor {rule} {context} {effects} actions={{ save: untouched, remove: untouched }} onDeleted={untouched}
    checkCompatibility={() => ({ diagnostics: [{ capability: "durable_waits", support: "unsupported", message: "Host-provided diagnostic" }] })} />
{/if}
