<script lang="ts">
	import { cn, type WithElementRef, type WithoutChildren } from "../../utils.js";
	import type { HTMLTextareaAttributes } from "svelte/elements";

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		"data-slot": dataSlot = "textarea",
		...restProps
	}: WithoutChildren<WithElementRef<HTMLTextareaAttributes>> = $props();
</script>

<textarea
	bind:this={ref}
	data-slot={dataSlot}
	class={cn(
		"field-sizing-content flex min-h-20 w-full resize-none rounded-xl border border-input bg-background px-3.5 py-3 text-base shadow-xs outline-none transition-[border-color,box-shadow,background-color] placeholder:text-muted-foreground hover:border-foreground/20 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
		className
	)}
	bind:value
	{...restProps}></textarea>
