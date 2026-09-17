<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		size = "default",
		variant = "default",
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		size?: "default" | "sm";
		variant?: "default" | "inset";
	} = $props();
</script>

<div
	bind:this={ref}
	data-slot="card"
	data-size={size}
	data-variant={variant}
	class={cn(
		"group/card flex h-full flex-col gap-[2px] overflow-hidden rounded-2xl bg-surface-chrome p-[4px] text-sm text-card-foreground has-[>img:first-child]:p-0 [--chrome:4px] [--frame-radius:var(--radius-2xl)] data-[size=sm]:rounded-xl data-[size=sm]:[--frame-radius:var(--radius-xl)] data-[variant=inset]:gap-0 data-[variant=inset]:bg-card data-[variant=inset]:p-0 data-[variant=inset]:[--chrome:0px]",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</div>
