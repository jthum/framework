<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLTableRowElement>> = $props();
</script>

<tr
	bind:this={ref}
	data-slot="table-row"
	class={cn(
		"border-b border-border/80 transition-colors hover:bg-muted/40 data-[state=selected]:bg-muted/50 data-[state=selected]:hover:bg-muted/60",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
