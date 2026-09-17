<script lang="ts">
	import { onMount, type Snippet } from "svelte";
	import { Button } from "../ui/button/index.js";
	import { Spinner } from "../ui/spinner/index.js";

	let {
		dirty,
		saving = false,
		saveLabel = "Save changes",
		onSave,
		left,
		beforeSave,
	}: {
		dirty: boolean;
		saving?: boolean;
		saveLabel?: string;
		onSave: () => void | Promise<void>;
		left?: Snippet;
		beforeSave?: Snippet;
	} = $props();

	let row = $state<HTMLDivElement | null>(null);
	let rowVisible = $state(true);

	onMount(() => {
		if (!row || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(
			([entry]) => {
				rowVisible = Boolean(entry?.isIntersecting);
			},
			{ threshold: 0.1 },
		);
		observer.observe(row);
		return () => observer.disconnect();
	});
</script>

<div bind:this={row} class="flex flex-wrap items-center justify-between gap-3">
	<div class="flex items-center gap-2">
		{@render left?.()}
	</div>
	<div class="flex flex-wrap items-center justify-end gap-3">
		<p class="text-xs text-muted-foreground">{dirty ? "Unsaved changes" : "All changes saved"}</p>
		{@render beforeSave?.()}
		<Button onclick={onSave} disabled={!dirty || saving}>
			{#if saving}<Spinner data-icon="inline-start" />{/if}
			{saveLabel}
		</Button>
	</div>
</div>

{#if dirty && !rowVisible}
	<div class="fixed right-4 bottom-4 z-20">
		<Button onclick={onSave} disabled={saving}>
			{#if saving}<Spinner data-icon="inline-start" />{/if}
			{saveLabel}
		</Button>
	</div>
{/if}
