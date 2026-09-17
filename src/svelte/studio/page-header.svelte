<script lang="ts">
	import type { Snippet } from "svelte";

	let {
		title,
		description,
		actions,
	}: {
		title: string;
		description?: string;
		actions?: Snippet;
	} = $props();
</script>

<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
	<div class="flex min-w-0 flex-col gap-1">
		<h1 class="text-2xl font-semibold tracking-tight">{title}</h1>
		{#if description}
			<p class="max-w-2xl text-muted-foreground">{description}</p>
		{/if}
	</div>
	{#if actions}
		<div class="flex shrink-0 flex-wrap items-center gap-2">
			{@render actions()}
		</div>
	{/if}
</div>
