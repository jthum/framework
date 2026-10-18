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
		"[--table-row-surface:var(--card)] [--table-row-pattern:none] [&>td]:transition-colors",
		"hover:[--table-row-surface:color-mix(in_oklab,var(--muted)_30%,var(--card))]",
		"data-[state=selected]:[--table-row-surface:color-mix(in_oklab,var(--foreground)_1.5%,var(--card))] data-[state=selected]:hover:[--table-row-surface:color-mix(in_oklab,var(--foreground)_2.5%,var(--card))]",
		"data-[state=selected]:[--table-row-pattern:repeating-linear-gradient(135deg,color-mix(in_oklab,var(--foreground)_2%,transparent)_0_1px,transparent_1px_8px)]",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
