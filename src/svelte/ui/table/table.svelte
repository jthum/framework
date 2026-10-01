<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLTableAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLTableAttributes> = $props();
</script>

<div data-slot="table-container" class="w-full rounded-2xl border border-border/80 bg-surface-chrome p-1">
	<div class="relative w-full overflow-x-auto rounded-[calc(var(--radius-2xl)-4px)] border border-border bg-card">
	<table bind:this={ref} data-slot="table" class={cn("w-full caption-bottom text-sm", className)} {...restProps}>
		{@render children?.()}
	</table>
	</div>
</div>
