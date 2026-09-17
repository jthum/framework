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

<tfoot
	bind:this={ref}
	data-slot="table-footer"
	class={cn(
		"border-t border-border/80 bg-muted/40 font-medium [&_tr]:bg-transparent [&_tr]:hover:bg-transparent [&>tr]:last:border-b-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tfoot>
