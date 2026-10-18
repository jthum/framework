<script lang="ts">
  import RecordDetails from "../../svelte/records/record-details.svelte";
  import RecordPanel from "../../svelte/records/record-panel.svelte";
  let { compact = false, panel = false }: { compact?: boolean; panel?: boolean } = $props();
</script>

{#snippet details()}
  <RecordDetails title="Spring launch" description="A focused project overview." typeLabel="Project" {compact} showHeader={!panel}
    properties={[{ key: "budget", label: "Budget", value: 100, highlight: true }, { key: "enabled", label: "Enabled", value: false }, { key: "notes", label: "Notes", value: "First paragraph\nSecond paragraph", multiline: true }]}>
    {#snippet actions()}<button>Approve</button>{/snippet}
    {#snippet summary()}{#if !panel}<span>Active</span>{/if}{/snippet}
    {#snippet renderValue(property)}<span data-field={property.key}>{String(property.value)}</span>{/snippet}
    {#snippet metadata()}<span>Updated today</span>{/snippet}
    <section aria-label="Related tasks">Related tasks</section>
  </RecordDetails>
{/snippet}

{#if panel}
  <RecordPanel title="Spring launch" href="/projects/one" onClose={() => {}} class="host-panel">
    {#snippet navigation()}<button>Next record</button>{/snippet}
    {#snippet summary()}<span data-record-status>Active</span>{/snippet}
    {@render details()}
  </RecordPanel>
{:else}{@render details()}{/if}
