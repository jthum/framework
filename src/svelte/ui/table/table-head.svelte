<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLThAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		scope = "col",
		...restProps
	}: WithElementRef<HTMLThAttributes> = $props();
</script>

<th
	bind:this={ref}
	data-slot="table-head"
	{scope}
	class={cn(
		"h-11 px-4 py-3 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground aria-[sort=ascending]:font-semibold aria-[sort=ascending]:text-foreground aria-[sort=descending]:font-semibold aria-[sort=descending]:text-foreground [&:has([role=checkbox])]:pr-0",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</th>
