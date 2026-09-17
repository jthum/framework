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

<thead
	bind:this={ref}
	data-slot="table-header"
	class={cn(
		"bg-muted/75 [&_tr]:border-b [&_tr]:border-border/80 [&_tr]:bg-transparent [&_tr]:hover:bg-transparent",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</thead>
