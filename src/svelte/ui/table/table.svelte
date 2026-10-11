<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLTableAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		variant = "default",
		...restProps
	}: WithElementRef<HTMLTableAttributes> & { variant?: "default" | "inset" } = $props();
</script>

<div
	data-slot="table-container"
	data-variant={variant}
	class={cn(
		"relative w-full min-w-0 overflow-x-auto text-card-foreground",
		variant === "default"
			? "rounded-2xl border border-border/80 bg-surface-chrome p-1 [--table-body-radius:calc(var(--radius-2xl)-4px)] [--table-body-outline:1px]"
			: "bg-card [--table-body-radius:0px] [--table-body-outline:0px]",
	)}
>
	<table bind:this={ref} data-slot="table" class={cn("w-full border-separate border-spacing-0 caption-bottom text-sm", className)} {...restProps}>
		{@render children?.()}
	</table>
</div>
