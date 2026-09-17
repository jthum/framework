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
	data-slot="card-header"
	class={cn(
		"group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-[calc(var(--frame-radius)-var(--chrome))] bg-card px-5 py-2 group-has-data-[slot=card-content]/card:rounded-none group-has-data-[slot=card-content]/card:bg-transparent has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-2 group-data-[variant=inset]/card:px-3 group-data-[variant=inset]/card:py-2",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
