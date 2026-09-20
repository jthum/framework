<script lang="ts">
	import { formatCell, statusTone } from "./editor-labels.js";
	import type { ValueSemantic } from "./authoring.js";

	let { path, value, tone }: { path: string; value: unknown; tone?: ValueSemantic } = $props();

	const text = $derived(formatCell(path, value));
	const resolvedTone = $derived(tone ?? statusTone(String(value ?? "")));
	const styles = {
		success: {
			wrap: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-500/15 dark:text-emerald-400 dark:ring-emerald-400/20",
			dot: "bg-emerald-500",
		},
		danger: {
			wrap: "bg-red-50 text-red-700 ring-red-600/15 dark:bg-red-500/15 dark:text-red-400 dark:ring-red-400/20",
			dot: "bg-red-500",
		},
		warning: {
			wrap: "bg-amber-50 text-amber-800 ring-amber-600/15 dark:bg-amber-500/15 dark:text-amber-400 dark:ring-amber-400/20",
			dot: "bg-amber-500",
		},
		info: {
			wrap: "bg-sky-50 text-sky-800 ring-sky-600/15 dark:bg-sky-500/15 dark:text-sky-300 dark:ring-sky-400/20",
			dot: "bg-sky-500",
		},
		neutral: {
			wrap: "bg-muted text-muted-foreground ring-foreground/8 dark:ring-white/10",
			dot: "bg-muted-foreground/50",
		},
	} as const;
</script>

{#if text === "—"}
	<span class="text-muted-foreground">—</span>
{:else}
	<span
		class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset {styles[resolvedTone].wrap}"
	>
		<span class="size-1.5 shrink-0 rounded-full {styles[resolvedTone].dot}"></span>
		{text}
	</span>
{/if}
