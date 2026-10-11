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
		"[--table-row-surface:var(--card)] hover:[--table-row-surface:color-mix(in_oklab,var(--muted)_30%,var(--card))] data-[state=selected]:[--table-row-surface:color-mix(in_oklab,var(--primary)_8%,var(--card))] data-[state=selected]:hover:[--table-row-surface:color-mix(in_oklab,var(--primary)_12%,var(--card))] [&>td]:transition-colors",
		className
	)}
	{...restProps}
>
	{@render children?.()}
</tr>
