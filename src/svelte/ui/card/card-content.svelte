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
	data-slot="card-content"
	class={cn(
		"flex-1 rounded-[calc(var(--frame-radius)-var(--chrome))] bg-card px-5 py-5 text-foreground shadow-xs group-data-[size=sm]/card:px-4 group-data-[size=sm]/card:py-3.5 group-data-[variant=inset]/card:px-3 group-data-[variant=inset]/card:py-3",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
