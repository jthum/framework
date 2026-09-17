<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLUListElement>> = $props();
</script>

<ul
	bind:this={ref}
	data-slot="sidebar-menu-sub"
	data-sidebar="menu-sub"
	class={cn("mx-3.5 flex min-w-0 translate-x-px flex-col gap-px border-l border-sidebar-border px-2.5 py-0 group-data-[collapsible=icon]:hidden", className)}
	{...restProps}
>
	{@render children?.()}
</ul>
