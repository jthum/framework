<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> = $props();
</script>

<div
	bind:this={ref}
	data-slot="card-footer"
	class={cn(
		"flex items-center px-5 py-2 group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-2 group-data-[variant=inset]/card:px-3 group-data-[variant=inset]/card:py-2",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
