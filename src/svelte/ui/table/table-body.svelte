<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableSectionElement>> = $props();
</script>

<tbody
	bind:this={ref}
	data-slot="table-body"
	class={cn("bg-transparent", className)}
	{...restProps}
>
	{@render children?.()}
</tbody>

<style>
	/* Native table row-groups cannot clip a rounded inset. The edge cells paint one
	   continuous body panel; the shared primitive owns this, not individual screens. */
	tbody > :global(tr > td) {
		background-color: var(--table-row-surface, var(--card));
		border-bottom: 1px solid color-mix(in oklab, var(--border) 60%, transparent);
	}
	tbody > :global(tr:first-child > td) {
		border-top: var(--table-body-outline, 1px) solid var(--border);
	}
	tbody > :global(tr:last-child > td) {
		border-bottom-width: var(--table-body-outline, 1px);
		border-bottom-color: var(--border);
	}
	tbody > :global(tr > td:first-child) {
		border-inline-start: var(--table-body-outline, 1px) solid var(--border);
	}
	tbody > :global(tr > td:last-child) {
		border-inline-end: var(--table-body-outline, 1px) solid var(--border);
	}
	tbody > :global(tr:first-child > td:first-child) {
		border-start-start-radius: var(--table-body-radius, 0px);
	}
	tbody > :global(tr:first-child > td:last-child) {
		border-start-end-radius: var(--table-body-radius, 0px);
	}
	tbody > :global(tr:last-child > td:first-child) {
		border-end-start-radius: var(--table-body-radius, 0px);
	}
	tbody > :global(tr:last-child > td:last-child) {
		border-end-end-radius: var(--table-body-radius, 0px);
	}
</style>
