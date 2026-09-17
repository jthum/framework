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
	data-slot="dialog-body"
	class={cn(
		"min-h-0 flex-1 rounded-[calc(var(--frame-radius)-var(--chrome))] bg-card px-6 py-5 text-foreground shadow-xs",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
