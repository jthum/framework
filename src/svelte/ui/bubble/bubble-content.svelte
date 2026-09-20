<script lang="ts">
	import { cn, type WithElementRef } from "../../utils.js";
	import type { Snippet } from "svelte";
	import type { HTMLAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		class: className,
		child,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		child?: Snippet<[{ props: Record<string, unknown> }]>;
	} = $props();

	const mergedProps = $derived({
		class: cn(
			"w-fit max-w-full min-w-0 overflow-hidden rounded-3xl border border-transparent px-3.5 py-2.5 text-sm leading-relaxed wrap-break-word group-data-[align=end]/bubble:self-end [button,a]:text-left [button,a]:outline-none [button,a]:transition-colors [button,a]:focus-visible:border-ring [button,a]:focus-visible:ring-[3px] [button,a]:focus-visible:ring-ring/50",
			className,
		),
		"data-slot": "bubble-content",
		...restProps,
	});
</script>

{#if child}
	{@render child({ props: mergedProps })}
{:else}
	<div bind:this={ref} {...mergedProps}>
		{@render mergedProps.children?.()}
	</div>
{/if}
