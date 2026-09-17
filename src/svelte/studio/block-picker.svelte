<script lang="ts" generics="Definition extends BlockDefinition">
	import OptionSelect from "./option-select.svelte";
	import { Button } from "../ui/button/index.js";
	import * as Dialog from "../ui/dialog/index.js";
	import * as InputGroup from "../ui/input-group/index.js";
	import type { BlockDefinition } from "../../blocks/model.js";
	import { cn } from "../utils.js";
	import CheckIcon from "@lucide/svelte/icons/check";
	import FormInputIcon from "@lucide/svelte/icons/form-input";
	import HashIcon from "@lucide/svelte/icons/hash";
	import HeadingIcon from "@lucide/svelte/icons/heading";
	import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
	import ListIcon from "@lucide/svelte/icons/list";
	import MousePointerClickIcon from "@lucide/svelte/icons/mouse-pointer-click";
	import SearchIcon from "@lucide/svelte/icons/search";
	import CalendarIcon from "@lucide/svelte/icons/calendar";
	import ChartBarIcon from "@lucide/svelte/icons/chart-bar";
	import ChartLineIcon from "@lucide/svelte/icons/chart-line";
	import ChartPieIcon from "@lucide/svelte/icons/chart-pie";
	import ChartScatterIcon from "@lucide/svelte/icons/chart-scatter";
	import Columns3Icon from "@lucide/svelte/icons/columns-3";
	import GitCompareArrowsIcon from "@lucide/svelte/icons/git-compare-arrows";
	import GaugeIcon from "@lucide/svelte/icons/gauge";
	import Grid3X3Icon from "@lucide/svelte/icons/grid-3x3";
	import ActivityIcon from "@lucide/svelte/icons/activity";
	import FlagIcon from "@lucide/svelte/icons/flag";
	import LayoutTemplateIcon from "@lucide/svelte/icons/layout-template";
	import ListChecksIcon from "@lucide/svelte/icons/list-checks";
	import ListFilterIcon from "@lucide/svelte/icons/list-filter";
	import SparklesIcon from "@lucide/svelte/icons/sparkles";
	import MegaphoneIcon from "@lucide/svelte/icons/megaphone";
	import TableIcon from "@lucide/svelte/icons/table";
	import TextIcon from "@lucide/svelte/icons/text";
	import TrophyIcon from "@lucide/svelte/icons/trophy";
	import WorkflowIcon from "@lucide/svelte/icons/workflow";
	import type { Component } from "svelte";

	let {
		open = $bindable(false),
		onPick,
		blocks,
		categories,
		onPreview,
		getIcon,
	}: {
		open?: boolean;
		onPick: (block: Definition) => void;
		blocks: readonly Definition[];
		categories?: readonly { key: string; label: string }[];
		onPreview?: (key: string) => void;
		getIcon?: (block: Definition) => Component | undefined;
	} = $props();

	const icons: Record<string, Component> = {
		heading: HeadingIcon,
		text: TextIcon,
		stat: HashIcon,
		table: TableIcon,
		cards: LayoutGridIcon,
		list: ListIcon,
		form: FormInputIcon,
		action: MousePointerClickIcon,
		callout: MegaphoneIcon,
		metric: GaugeIcon,
		bar: ChartBarIcon,
		line: ChartLineIcon,
		donut: ChartPieIcon,
		stacked_bar: ChartBarIcon,
		kanban: Columns3Icon,
		calendar: CalendarIcon,
		hero: SparklesIcon,
		progress: FlagIcon,
		spotlight: LayoutTemplateIcon,
		activity_feed: ActivityIcon,
		section_heading: HeadingIcon,
		quick_actions: ListChecksIcon,
		comparison: GitCompareArrowsIcon,
		leaderboard: TrophyIcon,
		timeline: WorkflowIcon,
		funnel: ListFilterIcon,
		scatter: ChartScatterIcon,
		heatmap: Grid3X3Icon,
	};

	let query = $state("");
	let category = $state("all");
	let selected = $state("");
	const categoryOptions = $derived([
		{ value: "all", label: "All categories" },
		...(categories ?? [...new Set(blocks.map((item) => item.category))].map((key) => ({ key, label: key })))
			.map((item) => ({ value: item.key, label: item.label })),
	]);

	const filtered = $derived.by(() => {
		const needle = query.trim().toLowerCase();
		return blocks.filter((item) => {
			if (category !== "all" && item.category !== category) return false;
			if (!needle) return true;
			return `${item.label} ${item.description ?? ""} ${item.category}`.toLowerCase().includes(needle);
		});
	});
	const chosen = $derived(filtered.find((item) => item.key === selected) ?? filtered[0]);

	$effect(() => {
		if (!open) return;
		query = "";
		category = "all";
		selected = "";
	});

	function submit(event: Event) {
		event.preventDefault();
		if (!chosen) return;
		onPick(chosen);
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[min(44rem,calc(100vh-2rem))] overflow-hidden sm:max-w-3xl">
		<form class="flex min-h-0 flex-1 flex-col" onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title>Add block</Dialog.Title>
				<Dialog.Description>
					Choose content, data, charts, or actions to compose this page.
				</Dialog.Description>
			</Dialog.Header>
			<Dialog.Body class="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center">
					<p class="text-sm font-medium">Choose a block</p>
					<div class="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:justify-end">
						<OptionSelect bind:value={category} options={categoryOptions} class="sm:w-44" />
						<InputGroup.Root class="sm:max-w-64">
							<InputGroup.Addon>
								<SearchIcon />
							</InputGroup.Addon>
							<InputGroup.Input bind:value={query} placeholder="Filter blocks" />
						</InputGroup.Root>
					</div>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto pr-1">
					<div class="grid gap-3 sm:grid-cols-2">
						{#each filtered as item (item.key)}
							{@const Icon = getIcon?.(item) ?? icons[item.key] ?? LayoutGridIcon}
							<button
								type="button"
								class={cn("flex flex-col gap-2 rounded-2xl border p-4 text-start transition-colors hover:bg-muted/40", chosen?.key === item.key ? "border-primary ring-2 ring-primary/20" : "border-border")}
								aria-pressed={chosen?.key === item.key}
								data-testid="block-template"
								data-block={item.key}
								onclick={() => (selected = item.key)}
								onpointerenter={() => onPreview?.(item.key)}
								onfocus={() => onPreview?.(item.key)}
							>
								<div class="flex items-start justify-between gap-2">
									<div class="flex size-9 items-center justify-center rounded-lg bg-muted text-muted-foreground">
										<Icon />
									</div>
									{#if chosen?.key === item.key}
										<CheckIcon class="size-4 text-primary" />
									{/if}
								</div>
								<div class="font-medium">{item.label}</div>
								<p class="text-sm text-muted-foreground">{item.description}</p>
							</button>
						{/each}
					</div>
					{#if !filtered.length}
						<p class="py-8 text-center text-sm text-muted-foreground">No blocks match that filter.</p>
					{/if}
				</div>
			</Dialog.Body>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={!chosen} data-testid="insert-block">Add block</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
