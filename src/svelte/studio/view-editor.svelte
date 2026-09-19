<script lang="ts">
	import {
		reorderAtVerticalTarget,
		startVerticalDrag,
		type VerticalDragSession,
		verticalDropTarget,
	} from "./vertical-drag.js";
	import { columnLabel, fieldKindLabel } from "./editor-labels.js";
	import OptionSelect from "./option-select.svelte";
	import EditorActions from "./editor-actions.svelte";
	import PageHeader from "./page-header.svelte";
	import type { EditorContext, ViewActions, ViewPreview } from "./authoring.js";
	import * as AlertDialog from "@jthum/framework/svelte/ui/alert-dialog";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import { Checkbox } from "@jthum/framework/svelte/ui/checkbox";
	import * as Collapsible from "@jthum/framework/svelte/ui/collapsible";
	import * as Empty from "@jthum/framework/svelte/ui/empty";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import * as Tabs from "@jthum/framework/svelte/ui/tabs";
	import * as ToggleGroup from "@jthum/framework/svelte/ui/toggle-group";
	import { compactWhere, FILTER_OPS, normalizeFilters, type FilterOp } from "./editor-filters.js";
	import { labelFromKey, slugify, uniqueKey } from "./editor-data.js";
	const RECORD_ID_TOKEN = "$record.id";
	import {
		cloneData,
		type FieldKind,
		type SortDirection,
		type CollectionDraft,
		type ViewDraft,
		type ViewMeasure,
	} from "./authoring.js";
	import { cn } from "@jthum/framework/svelte/utils";
	import { stableStringify } from "./editor-data.js";
	import ArrowUpDownIcon from "@lucide/svelte/icons/arrow-up-down";
	import CalendarIcon from "@lucide/svelte/icons/calendar";
	import ClockIcon from "@lucide/svelte/icons/clock";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";
	import Columns3Icon from "@lucide/svelte/icons/columns-3";
	import CopyIcon from "@lucide/svelte/icons/copy";
	import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
	import Settings2Icon from "@lucide/svelte/icons/settings-2";
	import HashIcon from "@lucide/svelte/icons/hash";
	import LinkIcon from "@lucide/svelte/icons/link";
	import ListFilterIcon from "@lucide/svelte/icons/list-filter";
	import ListIcon from "@lucide/svelte/icons/list";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import SigmaIcon from "@lucide/svelte/icons/sigma";
	import ToggleLeftIcon from "@lucide/svelte/icons/toggle-left";
	import TypeIcon from "@lucide/svelte/icons/type";
	import XIcon from "@lucide/svelte/icons/x";
	import { onDestroy, type Component, type Snippet, untrack } from "svelte";
	import { flip } from "svelte/animate";
	import { toast } from "svelte-sonner";

	let { view, context, actions, onOpen, onDeleted, previewContent, revision = 0, class: className }: {
		view: ViewDraft;
		class?: string;
		context: EditorContext;
		actions: ViewActions;
		onOpen: (key: string) => void | Promise<void>;
		onDeleted: () => void | Promise<void>;
		revision?: number;
		previewContent: Snippet<[ViewPreview]>;
	} = $props();

	const kindIcons: Record<FieldKind, Component> = {
		text: TypeIcon,
		number: HashIcon,
		date: CalendarIcon,
		datetime: ClockIcon,
		boolean: ToggleLeftIcon,
		enum: ListIcon,
		reference: LinkIcon,
	};

	type ColumnRow = { field: string; on: boolean };
	type FilterRow = { field: string; op: string; value: string };
	type SortRow = { field: string; dir: SortDirection };
	type MeasureRow = ViewMeasure & { key: string };

	const types = $derived(context.collections);

	let label = $state("");
	let source = $state("");
	let columns = $state<ColumnRow[]>([]);
	let filters = $state<FilterRow[]>([]);
	let expose = $state<string[]>([]);
	let exposeOn = $state(false);
	let limit = $state("");
	let limitOn = $state(false);
	let sorts = $state<SortRow[]>([]);
	let summarize = $state(false);
	let groupBy = $state("");
	let measureRows = $state<MeasureRow[]>([]);
	let featured = $state(true);
	let deleteOpen = $state(false);
	let section = $state("columns");
	let queryMoreOpen = $state(false);
	let previewOpen = $state(true);
	let previewExpose = $state<Record<string, string>>({});
	let dragField = $state<string | null>(null);
	let dragFilter = $state<FilterRow | null>(null);
	let dragSort = $state<SortRow | null>(null);
	let columnList = $state<HTMLDivElement | null>(null);
	let filterList = $state<HTMLDivElement | null>(null);
	let sortList = $state<HTMLDivElement | null>(null);
	let dragSession: VerticalDragSession | null = null;
	let sortableIdSeed = 0;
	const sortableIds = new WeakMap<object, string>();

	function sortableId(item: object, prefix: string): string {
		const existing = sortableIds.get(item);
		if (existing) return existing;
		const id = `${prefix}-${++sortableIdSeed}`;
		sortableIds.set(item, id);
		return id;
	}

	const sourceType = $derived(
		types.find((item) => item.key === source) ?? types.find((item) => item.key === view.source),
	);
	const numericFields = $derived((sourceType?.fields ?? []).filter((field) => field.type === "number"));
	const measures = $derived(
		Object.fromEntries(
			measureRows
				.filter((measure) => measure.key)
				.map(({ key, ...measure }) => [key, measure]),
		),
	);
	const fieldChoices = $derived(
		summarize && groupBy ? [groupBy, ...Object.keys(measures)] : choicesFor(sourceType),
	);
	const selected = $derived(columns.filter((column) => column.on).map((column) => column.field));
	const previewExposeFields = $derived(
		exposeOn ? (sourceType?.fields ?? []).filter((field) => expose.includes(field.key)) : [],
	);
	const usesRecord = $derived(
		filters.some((clause) => clause.value === RECORD_ID_TOKEN),
	);

	$effect(() => {
		void view.key;
		untrack(() => {
			label = view.label;
			source = view.source;
			const type = types.find((item) => item.key === view.source);
			filters = normalizeFilters(view.where).map((clause) => ({
				field: clause.field,
				op: clause.op ?? "eq",
				value: Array.isArray(clause.value) ? clause.value.join(", ") : String(clause.value ?? ""),
			}));
			const nextExpose = [...(view.expose ?? [])];
			expose = nextExpose;
			exposeOn = nextExpose.length > 0;
			limit = view.limit ? String(view.limit) : "";
			limitOn = Boolean(view.limit);
			summarize = Boolean(view.group_by);
			groupBy = view.group_by ?? "";
			measureRows = Object.entries(view.measures ?? {}).map(([key, measure]) => ({
				key,
				...cloneData(measure),
			}));
			columns = mergeColumns(
				[],
				groupBy ? [groupBy, ...measureRows.map((measure) => measure.key)] : choicesFor(type),
				view.fields,
			);
			sorts = Object.entries(view.order_by ?? {}).map(([field, dir]) => ({
				field,
				dir: dir === "desc" ? "desc" : "asc",
			}));
			featured = !view.implicit;
			section = "columns";
			queryMoreOpen = Boolean(view.group_by || view.limit);
		});
	});

	function setQueryMoreOpen(open: boolean) {
		queryMoreOpen = open;
		if (!open && (section === "summaries" || section === "advanced")) section = "columns";
	}

	$effect(() => {
		const choices = fieldChoices;
		if (!choices.length) return;
		untrack(() => {
			columns = mergeColumns(columns, choices);
		});
	});

	function choicesFor(type: CollectionDraft | undefined): string[] {
		return (type?.fields ?? []).map((field) =>
			field.type === "reference" ? `${field.key}.name` : field.key,
		);
	}

	function mergeColumns(current: ColumnRow[], choices: string[], preferredOn?: string[]): ColumnRow[] {
		const choiceSet = new Set(choices);
		const onSet = new Set(
			preferredOn !== undefined
				? preferredOn.filter((field) => choiceSet.has(field))
				: current.filter((column) => column.on).map((column) => column.field),
		);
		if (preferredOn !== undefined && !onSet.size) {
			for (const field of choices) onSet.add(field);
		}
		const seen = new Set<string>();
		const next: ColumnRow[] = [];
		const seed =
			preferredOn !== undefined
				? [
						...preferredOn
							.filter((field) => choiceSet.has(field))
							.map((field) => ({ field, on: true })),
						...current,
					]
				: current;
		for (const column of seed) {
			if (!choiceSet.has(column.field) || seen.has(column.field)) continue;
			seen.add(column.field);
			next.push({ field: column.field, on: onSet.has(column.field) });
		}
		for (const field of choices) {
			if (seen.has(field)) continue;
			next.push({ field, on: onSet.has(field) });
		}
		return next;
	}

	function fieldDef(key: string) {
		return sourceType?.fields.find((item) => item.key === key.split(".")[0]);
	}

	function columnKind(field: string): FieldKind {
		if (measures[field]) return "number";
		return fieldDef(field)?.type ?? "text";
	}

	function needsValue(op: string) {
		return op !== "empty" && op !== "not_empty";
	}

	function addFilter() {
		filters = [...filters, { field: sourceType?.fields[0]?.key ?? "", op: "eq", value: "" }];
	}

	function removeFilter(index: number) {
		filters = filters.filter((_, item) => item !== index);
	}

	function toggleExpose(field: string, on: boolean) {
		expose = on
			? expose.includes(field)
				? expose
				: [...expose, field]
			: expose.filter((item) => item !== field);
	}

	function setExposeOn(on: boolean) {
		if (!on) expose = [];
	}

	function setLimitOn(on: boolean) {
		if (on && !limit) limit = "25";
	}

	function setColumnOn(field: string, on: boolean) {
		if (!on && selected.length <= 1) return;
		columns = columns.map((column) => (column.field === field ? { ...column, on } : column));
	}

	function moveColumn(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= columns.length) return;
		const next = [...columns];
		const item = next[index];
		const swap = next[target];
		if (!item || !swap) return;
		next[index] = swap;
		next[target] = item;
		columns = next;
	}

	function onColumnDragStart(field: string, event: PointerEvent) {
		const origin = [...columns];
		dragField = field;
		const handle = event.currentTarget as HTMLElement;
		dragSession = startVerticalDrag({
			event,
			container: columnList,
			item: handle.closest<HTMLElement>("[role=listitem]"),
			onMove: (clientY) => {
				const target = verticalDropTarget(columnList, clientY);
				if (target) columns = reorderAtVerticalTarget(columns, field, target, (column) => column.field);
			},
			onDrop: () => {
				dragSession = null;
				dragField = null;
			},
			onCancel: () => {
				dragSession = null;
				columns = origin;
				dragField = null;
			},
		});
		if (!dragSession) dragField = null;
	}

	function onFilterDragStart(clause: FilterRow, event: PointerEvent) {
		const origin = [...filters];
		const key = sortableId(clause, "filter");
		dragFilter = clause;
		const handle = event.currentTarget as HTMLElement;
		dragSession = startVerticalDrag({
			event,
			container: filterList,
			item: handle.closest<HTMLElement>("[data-sort-card]"),
			onMove: (clientY) => {
				const target = verticalDropTarget(filterList, clientY);
				if (target) filters = reorderAtVerticalTarget(filters, key, target, (item) => sortableId(item, "filter"));
			},
			onDrop: () => {
				dragSession = null;
				dragFilter = null;
			},
			onCancel: () => {
				dragSession = null;
				filters = origin;
				dragFilter = null;
			},
		});
		if (!dragSession) dragFilter = null;
	}

	function onSortDragStart(row: SortRow, event: PointerEvent) {
		const origin = [...sorts];
		const key = sortableId(row, "sort");
		dragSort = row;
		const handle = event.currentTarget as HTMLElement;
		dragSession = startVerticalDrag({
			event,
			container: sortList,
			item: handle.closest<HTMLElement>("[data-sort-card]"),
			onMove: (clientY) => {
				const target = verticalDropTarget(sortList, clientY);
				if (target) sorts = reorderAtVerticalTarget(sorts, key, target, (item) => sortableId(item, "sort"));
			},
			onDrop: () => {
				dragSession = null;
				dragSort = null;
			},
			onCancel: () => {
				dragSession = null;
				sorts = origin;
				dragSort = null;
			},
		});
		if (!dragSession) dragSort = null;
	}

	onDestroy(() => dragSession?.cancel());

	function sortFieldOptions(current: string) {
		const used = new Set(sorts.map((row) => row.field).filter((field) => field && field !== current));
		return [
			...(summarize && groupBy
				? fieldChoices.map((field) => ({ value: field, label: columnLabel(field, sourceType) }))
				: choicesFor(sourceType).map((field) => ({
						value: field,
						label: columnLabel(field, sourceType),
					}))),
			...(summarize && groupBy
				? []
				: [
						{ value: "updated_at", label: "Last updated" },
						{ value: "created_at", label: "Created" },
					]),
		].filter((option) => !used.has(option.value));
	}

	function addSort() {
		const next = sortFieldOptions("");
		if (!next[0]) return;
		sorts = [...sorts, { field: next[0].value, dir: "asc" }];
	}

	function removeSort(index: number) {
		sorts = sorts.filter((_, item) => item !== index);
	}

	function setSummarize(on: boolean) {
		summarize = on;
		if (!on) {
			const aliases = new Set(measureRows.map((measure) => measure.key));
			sorts = sorts.filter((sort) => !aliases.has(sort.field));
			columns = choicesFor(sourceType).map((field) => ({ field, on: true }));
			return;
		}
		groupBy ||= sourceType?.fields[0]?.key ?? "";
		if (!measureRows.length) addMeasure();
		columns = [groupBy, ...measureRows.map((measure) => measure.key)].map((field) => ({
			field,
			on: true,
		}));
	}

	function setGroupBy(field: string) {
		const previous = groupBy;
		groupBy = field;
		if (!field) return;
		const existing = columns.find((column) => column.field === previous);
		columns = [
			{ field, on: existing?.on ?? true },
			...columns.filter((column) => column.field !== previous && column.field !== field),
		];
		sorts = sorts.map((sort) => (sort.field === previous ? { ...sort, field } : sort));
	}

	function addMeasure() {
		const key = uniqueKey(
			`${source || "record"}_count`,
			measureRows.map((measure) => measure.key),
			"measure",
		);
		measureRows = [...measureRows, { key, op: "count" }];
		columns = [...columns, { field: key, on: true }];
	}

	function removeMeasure(index: number) {
		const removed = measureRows[index]?.key;
		measureRows = measureRows.filter((_, item) => item !== index);
		if (removed) {
			columns = columns.filter((column) => column.field !== removed);
			sorts = sorts.filter((sort) => sort.field !== removed);
		}
	}

	function updateMeasure(index: number, patch: Partial<MeasureRow>) {
		measureRows = measureRows.map((measure, item) =>
			item === index ? { ...measure, ...patch } : measure,
		);
	}

	function renameMeasure(index: number, value: string) {
		const current = measureRows[index];
		if (!current) return;
		const key = uniqueKey(
			slugify(value),
			measureRows.filter((_, item) => item !== index).map((measure) => measure.key),
			"measure",
		);
		if (key === current.key) return;
		updateMeasure(index, { key });
		columns = columns.map((column) =>
			column.field === current.key ? { ...column, field: key } : column,
		);
		sorts = sorts.map((sort) => (sort.field === current.key ? { ...sort, field: key } : sort));
	}

	function setMeasureOp(index: number, op: ViewMeasure["op"]) {
		const current = measureRows[index];
		if (!current) return;
		if (op === "count") {
			updateMeasure(index, { op, field: undefined, fields: undefined });
			return;
		}
		const selected = measureFields(current);
		const field = selected[0] ?? numericFields[0]?.key ?? "";
		updateMeasure(
			index,
			op === "avg"
				? { op, field: undefined, fields: field ? [field] : [] }
				: { op, field, fields: undefined },
		);
	}

	function measureFields(measure: ViewMeasure): string[] {
		return measure.fields?.length ? measure.fields : measure.field ? [measure.field] : [];
	}

	function toggleAverageField(index: number, field: string, on: boolean) {
		const current = measureRows[index];
		if (!current) return;
		const selected = measureFields(current);
		const fields = on
			? selected.includes(field)
				? selected
				: [...selected, field]
			: selected.filter((item) => item !== field);
		if (!fields.length) return;
		updateMeasure(index, { field: undefined, fields });
	}

	function builtOrder(): Record<string, SortDirection> | undefined {
		const usable = sorts.filter((row) => row.field);
		if (!usable.length) return undefined;
		return Object.fromEntries(usable.map((row) => [row.field, row.dir]));
	}

	function builtWhere(options: { preview?: boolean } = {}) {
		return compactWhere(
			filters
				.filter((clause) => {
					if (!clause.field) return false;
					if (options.preview && clause.value === RECORD_ID_TOKEN) return false;
					return !needsValue(clause.op) || clause.value !== "";
				})
				.map((clause) => ({
					field: clause.field,
					op: clause.op as FilterOp,
					value:
						clause.op === "in"
							? clause.value
									.split(",")
									.map((item) => item.trim())
									.filter(Boolean)
							: clause.value,
				})),
		);
	}

	function sortDirLabels(field: string) {
		if (field === "created_at" || field === "updated_at" || fieldDef(field)?.type === "date") {
			return { asc: "Oldest first", desc: "Newest first" };
		}
		if (columnKind(field) === "number") {
			return { asc: "Low to high", desc: "High to low" };
		}
		return { asc: "A to Z", desc: "Z to A" };
	}

	const draft = $derived.by((): ViewDraft => ({
		...view,
		label,
		source,
		fields: [...selected],
		where: builtWhere(),
		expose: exposeOn && expose.length ? [...expose] : undefined,
		limit: limitOn ? Number(limit) || undefined : undefined,
		order_by: builtOrder(),
		group_by: summarize ? groupBy || undefined : undefined,
		measures: summarize && groupBy ? cloneData(measures) : undefined,
		implicit: featured ? undefined : true,
	}));
	const savedView = $derived({
		...view,
		implicit: view.implicit ? true : undefined,
	});
	const dirty = $derived(stableStringify(draft) !== stableStringify(savedView));

	async function save() {
		await actions.save(cloneData(draft));
		toast.success("View saved");
	}

	async function duplicate() {
		const taken = context.views.map((item) => item.key) ?? [];
		const key = uniqueKey(view.key, taken, "view");
		await actions.save({
			key,
			label: `${label || view.label} copy`,
			source,
			fields: [...selected],
			where: builtWhere(),
			expose: exposeOn && expose.length ? [...expose] : undefined,
			limit: limitOn ? Number(limit) || undefined : undefined,
			order_by: builtOrder(),
			group_by: summarize ? groupBy || undefined : undefined,
			measures: summarize && groupBy ? cloneData(measures) : undefined,
			implicit: false,
		});
		toast.success("View duplicated");
		await onOpen(key);
	}

	async function remove() {
		await actions.remove(view.key);
		toast.success("View deleted");
		await onDeleted();
	}

	let preview = $state<Array<Record<string, unknown>> | null>(null);
	let previewError = $state("");
	const previewView = $derived(
		({
			...view,
			label,
			source,
			fields: selected,
			where: builtWhere({ preview: true }),
			expose: exposeOn ? expose : undefined,
			limit: limitOn ? Number(limit) || undefined : undefined,
			order_by: builtOrder(),
			group_by: summarize ? groupBy || undefined : undefined,
			measures: summarize && groupBy ? measures : undefined,
		}) as ViewDraft,
	);

	$effect(() => {
		const keys = previewExposeFields.map((field) => field.key);
		untrack(() => {
			const next: Record<string, string> = {};
			for (const key of keys) next[key] = previewExpose[key] ?? "";
			previewExpose = next;
		});
	});

	$effect(() => {
		void revision;
		const draft = cloneData(previewView);
		const extra = Object.fromEntries(
			Object.entries(previewExpose).filter(([, value]) => value !== ""),
		);
		preview = null;
		previewError = "";
		let cancelled = false;
		const timer = setTimeout(() => {
			void actions.query(draft, extra)
				.then((rows) => {
					if (!cancelled) preview = rows;
				}).catch((error: unknown) => {
					if (!cancelled) previewError = error instanceof Error ? error.message : "Could not load preview";
				});
		}, 150);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	});

</script>

<div class={cn("flex flex-col gap-8", className)}>
	<PageHeader
		title={label || view.label}
		description="A saved list. Change filters and columns here — the preview updates as you go."
	/>

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>View setup</Card.Title>
			<Card.Description>Name the view, choose its records, and decide where people can find it.</Card.Description>
		</Card.Header>
		<Card.Content>
			<Field.Group class="grid gap-4 sm:grid-cols-2">
				<Field.Field>
					<Field.Label for="view-name">Name</Field.Label>
					<Input id="view-name" bind:value={label} placeholder="Active projects" />
				</Field.Field>
				<Field.Field>
					<Field.Label>Show records of</Field.Label>
					<OptionSelect
						bind:value={source}
						options={types.map((item) => ({ value: item.key, label: item.label }))}
					/>
				</Field.Field>
				<Field.Field orientation="horizontal" class="justify-between rounded-xl border bg-muted/30 p-3 sm:col-span-2">
					<div class="flex flex-col gap-0.5">
						<Field.Label for="featured">{featured ? "Shown in the app menu" : "Hidden from the app menu"}</Field.Label>
						<Field.Description>{featured ? "People can open this view from the app navigation." : "The view remains available to blocks, rules, and agents."}</Field.Description>
					</div>
					<Switch bind:checked={featured} id="featured" />
				</Field.Field>
			</Field.Group>
		</Card.Content>
	</Card.Root>

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>Query</Card.Title>
			<Card.Description>Choose what appears first, then narrow or order the results when needed.</Card.Description>
		</Card.Header>
		<Card.Content class="flex flex-col gap-5">
			<Tabs.Root bind:value={section} class="gap-5">
				<div class="flex flex-wrap items-center justify-between gap-2">
					<Tabs.List class="h-auto max-w-full justify-start gap-1 overflow-x-auto p-1 group-data-horizontal/tabs:h-auto">
						<Tabs.Trigger value="columns" class="h-8 flex-none gap-2 px-3">
							<Columns3Icon data-icon="inline-start" class="hidden sm:block" />
							Columns
							<span class="text-xs text-muted-foreground tabular-nums">{selected.length}</span>
						</Tabs.Trigger>
						<Tabs.Trigger value="filters" class="h-8 flex-none gap-2 px-3">
							<ListFilterIcon data-icon="inline-start" class="hidden sm:block" />
							Filters
							{#if filters.length}
								<span class="text-xs text-muted-foreground tabular-nums">{filters.length}</span>
							{/if}
						</Tabs.Trigger>
						<Tabs.Trigger value="sort" class="h-8 flex-none gap-2 px-3">
							<ArrowUpDownIcon data-icon="inline-start" class="hidden sm:block" />
							Sort
							{#if sorts.length}
								<span class="text-xs text-muted-foreground tabular-nums">{sorts.length}</span>
							{/if}
						</Tabs.Trigger>
						{#if queryMoreOpen}
							<Tabs.Trigger value="summaries" class="h-8 flex-none gap-2 px-3">
								<SigmaIcon data-icon="inline-start" class="hidden sm:block" />
								Summaries
								{#if summarize && measureRows.length}
									<span class="text-xs text-muted-foreground tabular-nums">{measureRows.length}</span>
								{/if}
							</Tabs.Trigger>
							<Tabs.Trigger value="advanced" class="h-8 flex-none gap-2 px-3">
								<Settings2Icon data-icon="inline-start" class="hidden sm:block" />
								Results
							</Tabs.Trigger>
						{/if}
					</Tabs.List>
					<Button
						variant="ghost"
						size="sm"
						class="shrink-0 text-muted-foreground"
						onclick={() => setQueryMoreOpen(!queryMoreOpen)}
						aria-expanded={queryMoreOpen}
					>
						<Settings2Icon data-icon="inline-start" />
						{queryMoreOpen ? "Fewer options" : "More options"}
						<ChevronDownIcon class="size-4 transition-transform {queryMoreOpen ? 'rotate-180' : ''}" />
					</Button>
				</div>

				<Tabs.Content value="filters" class="flex flex-col gap-5">
					{#if !filters.length}
						<Empty.Root class="border border-dashed py-8">
							<Empty.Header>
								<Empty.Media variant="icon"><ListFilterIcon /></Empty.Media>
								<Empty.Title>All records</Empty.Title>
								<Empty.Description>
									Nothing is filtered yet. Add a condition to narrow this list — unpaid, active, overdue.
								</Empty.Description>
							</Empty.Header>
							<Empty.Content>
								<Button variant="outline" onclick={addFilter} disabled={!sourceType}>
									<PlusIcon data-icon="inline-start" />
									Add filter
								</Button>
							</Empty.Content>
						</Empty.Root>
					{:else}
						<div class="flex flex-col gap-2" role="list" bind:this={filterList}>
							{#each filters as clause, index (clause)}
								{@const def = fieldDef(clause.field)}
								<div
									role="listitem"
									data-sort-key={sortableId(clause, "filter")}
									animate:flip={{ duration: 160 }}
									class={cn("flex flex-col gap-2", dragFilter === clause && "pointer-events-none opacity-0")}
								>
									{#if index > 0}
										<p class="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">And</p>
									{/if}
									<div
										data-sort-card
										class="grid items-center gap-2 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 md:grid-cols-[auto_minmax(0,1fr)_10rem_minmax(0,1.2fr)_auto]"
									>
										<button
										type="button"
										class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
										aria-label="Drag to reorder filter"
										onpointerdown={(event) => onFilterDragStart(clause, event)}
									>
										<GripVerticalIcon class="size-4" />
									</button>
									<OptionSelect
										bind:value={clause.field}
										options={choicesFor(sourceType).map((field) => ({
											value: field,
											label: columnLabel(field, sourceType),
										}))}
									/>
									<OptionSelect
										bind:value={clause.op}
										options={FILTER_OPS.map((item) => ({ value: item.value, label: item.label }))}
									/>
									{#if needsValue(clause.op)}
										{#if def?.type === "enum" && clause.op !== "contains" && clause.op !== "in"}
											<OptionSelect
												bind:value={clause.value}
												options={(def.values ?? []).map((value) => ({
													value,
													label: labelFromKey(value),
												}))}
											/>
										{:else if def?.type === "boolean"}
											<OptionSelect
												bind:value={clause.value}
												options={[
													{ value: "true", label: "Yes" },
													{ value: "false", label: "No" },
												]}
											/>
										{:else if def?.type === "reference" && clause.op !== "contains" && clause.op !== "in"}
											<OptionSelect
												bind:value={clause.value}
												options={[
													{ value: RECORD_ID_TOKEN, label: "This record" },
													...(clause.value && clause.value !== RECORD_ID_TOKEN
														? [{ value: clause.value, label: clause.value }]
														: []),
												]}
											/>
										{:else if def?.type === "date" && clause.op !== "contains" && clause.op !== "in"}
											<Input type="date" bind:value={clause.value} />
										{:else}
											<Input
												bind:value={clause.value}
												inputmode={def?.type === "number" ? "decimal" : "text"}
												placeholder={clause.op === "in" ? "sent, overdue" : "value"}
											/>
										{/if}
									{:else}
										<div class="hidden md:block"></div>
									{/if}
										<Button
										variant="ghost"
										size="icon-xs"
										onclick={() => removeFilter(index)}
										aria-label="Remove filter"
										class="justify-self-end"
									>
										<XIcon />
										</Button>
									</div>
								</div>
							{/each}
							<div>
								<Button variant="outline" size="sm" onclick={addFilter}>
									<PlusIcon data-icon="inline-start" />
									Add filter
								</Button>
							</div>
						</div>
					{/if}

					<div class="flex flex-col gap-4 rounded-2xl bg-muted/60 p-4 ring-1 ring-foreground/5">
						<Field.Field orientation="horizontal">
							<Switch bind:checked={exposeOn} onCheckedChange={(value) => setExposeOn(Boolean(value))} id="expose" />
							<Field.Content>
								<Field.Label for="expose">People can filter this list</Field.Label>
								<Field.Description>Controls appear above the list so anyone can narrow it.</Field.Description>
							</Field.Content>
						</Field.Field>
						{#if exposeOn && sourceType?.fields.length}
							<Field.FieldSet>
								<Field.FieldLegend variant="label">Which fields</Field.FieldLegend>
								<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
									{#each sourceType.fields as field (field.key)}
										<Field.Field orientation="horizontal">
											<Checkbox
												checked={expose.includes(field.key)}
												onCheckedChange={(value) => toggleExpose(field.key, Boolean(value))}
											/>
											<Field.Label class="font-normal">{field.label}</Field.Label>
										</Field.Field>
									{/each}
								</div>
							</Field.FieldSet>
						{/if}
					</div>
				</Tabs.Content>

				<Tabs.Content value="columns" class="flex flex-col gap-3">
					<p class="text-sm text-muted-foreground">
						Drag to set the table order. Turn a column off to hide it. At least one stays on.
					</p>
					{#if columns.length}
						<div class="flex flex-col gap-2" role="list" bind:this={columnList}>
							{#each columns as column, index (column.field)}
								{@const kind = columnKind(column.field)}
								{@const Icon = kindIcons[kind] ?? TypeIcon}
								<div
									role="listitem"
									data-sort-key={column.field}
									animate:flip={{ duration: 160 }}
									class={cn(
										"flex items-center gap-3 rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10",
										!column.on && "opacity-70",
										dragField === column.field && "pointer-events-none opacity-0",
									)}
								>
									<button
										type="button"
										class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
										aria-label="Drag to reorder"
										onpointerdown={(event) => onColumnDragStart(column.field, event)}
									>
										<GripVerticalIcon class="size-4" />
									</button>
									<Switch
										size="sm"
										checked={column.on}
										disabled={column.on && selected.length <= 1}
										onCheckedChange={(value) => setColumnOn(column.field, Boolean(value))}
										aria-label="Show {columnLabel(column.field, sourceType)}"
									/>
									<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
										<Icon class="size-4" />
									</div>
									<div class="min-w-0 flex-1">
										<div class="font-medium">{columnLabel(column.field, sourceType)}</div>
										<div class="text-sm text-muted-foreground">{fieldKindLabel[kind]}</div>
									</div>
									<Badge variant={column.on ? "secondary" : "outline"}>{column.on ? "On" : "Off"}</Badge>
									<div class="flex shrink-0 items-center">
										<Button
											size="icon-sm"
											variant="ghost"
											disabled={index === 0}
											onclick={() => moveColumn(index, -1)}
										>
											<ChevronUpIcon />
											<span class="sr-only">Move up</span>
										</Button>
										<Button
											size="icon-sm"
											variant="ghost"
											disabled={index === columns.length - 1}
											onclick={() => moveColumn(index, 1)}
										>
											<ChevronDownIcon />
											<span class="sr-only">Move down</span>
										</Button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="summaries" class="flex flex-col gap-5">
					<div class="flex flex-col gap-4 rounded-2xl bg-muted/60 p-4 ring-1 ring-foreground/5">
						<Field.Field orientation="horizontal">
							<Switch
								checked={summarize}
								onCheckedChange={(value) => setSummarize(Boolean(value))}
								id="summarize"
							/>
							<Field.Content>
								<Field.Label for="summarize">Group and summarize records</Field.Label>
								<Field.Description>
									Return one row per group with live totals, averages, minimums, or maximums.
								</Field.Description>
							</Field.Content>
						</Field.Field>
						{#if summarize}
							<Field.Field>
								<Field.Label>Group by</Field.Label>
								<OptionSelect
									value={groupBy}
									onValueChange={setGroupBy}
									options={(sourceType?.fields ?? []).map((field) => ({
										value: field.key,
										label: field.label,
									}))}
									placeholder="Choose a field"
								/>
								<Field.Description>
									Reference fields use the referenced record as the group and show its label.
								</Field.Description>
							</Field.Field>
						{/if}
					</div>

					{#if summarize}
						<div class="flex items-center justify-between gap-3">
							<div>
								<h3 class="font-medium">Summary columns</h3>
								<p class="text-sm text-muted-foreground">Each calculation becomes a column in the grouped list.</p>
							</div>
							<Button variant="outline" size="sm" onclick={addMeasure}>
								<PlusIcon data-icon="inline-start" />
								Add summary
							</Button>
						</div>

						{#if !measureRows.length}
							<Empty.Root class="border border-dashed py-8">
								<Empty.Header>
									<Empty.Media variant="icon"><SigmaIcon /></Empty.Media>
									<Empty.Title>No summary columns</Empty.Title>
									<Empty.Description>Add a count, total, average, minimum, or maximum.</Empty.Description>
								</Empty.Header>
								<Empty.Content>
									<Button variant="outline" onclick={addMeasure}>
										<PlusIcon data-icon="inline-start" />
										Add summary
									</Button>
								</Empty.Content>
							</Empty.Root>
						{:else}
							<div class="flex flex-col gap-3">
								{#each measureRows as measure, index (index)}
									<div class="flex flex-col gap-4 rounded-2xl bg-card p-4 ring-1 ring-foreground/10">
										<div class="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
											<Field.Field>
												<Field.Label for="measure-{index}">Column name</Field.Label>
												<Input
													id="measure-{index}"
													value={measure.key}
													onchange={(event) => renameMeasure(index, event.currentTarget.value)}
													placeholder="overall_score"
												/>
											</Field.Field>
											<Field.Field>
												<Field.Label>Calculation</Field.Label>
												<OptionSelect
													value={measure.op}
													onValueChange={(value) => setMeasureOp(index, value as ViewMeasure["op"])}
													options={[
														{ value: "count", label: "Count" },
														...(numericFields.length
															? [
																{ value: "sum", label: "Sum" },
																{ value: "avg", label: "Average" },
																{ value: "min", label: "Minimum" },
																{ value: "max", label: "Maximum" },
															]
															: []),
													]}
												/>
											</Field.Field>
											<Button
												variant="ghost"
												size="icon-sm"
												onclick={() => removeMeasure(index)}
												aria-label="Remove {labelFromKey(measure.key)} summary"
											>
												<XIcon />
											</Button>
										</div>

										{#if measure.op === "avg"}
											<Field.FieldSet>
												<Field.FieldLegend variant="label">Fields to average</Field.FieldLegend>
												<Field.Description>
													With several fields, each record is averaged first, then the group is averaged.
												</Field.Description>
												<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
													{#each numericFields as field (field.key)}
														<Field.Field orientation="horizontal">
															<Checkbox
																checked={measureFields(measure).includes(field.key)}
																disabled={measureFields(measure).length === 1 && measureFields(measure).includes(field.key)}
																onCheckedChange={(value) =>
																	toggleAverageField(index, field.key, Boolean(value))}
															/>
															<Field.Label class="font-normal">{field.label}</Field.Label>
														</Field.Field>
													{/each}
												</div>
											</Field.FieldSet>
										{:else if measure.op !== "count"}
											<Field.Field>
												<Field.Label>Number field</Field.Label>
												<OptionSelect
													value={measure.field ?? ""}
													onValueChange={(value) => updateMeasure(index, { field: value })}
													options={numericFields.map((field) => ({ value: field.key, label: field.label }))}
													placeholder="Choose a number field"
												/>
											</Field.Field>
										{:else}
											<p class="text-sm text-muted-foreground">Counts every record in the group.</p>
										{/if}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</Tabs.Content>

				<Tabs.Content value="sort" class="flex flex-col gap-3">
					{#if !sorts.length}
						<Empty.Root class="border border-dashed py-8">
							<Empty.Header>
								<Empty.Media variant="icon"><ArrowUpDownIcon /></Empty.Media>
								<Empty.Title>Default order</Empty.Title>
								<Empty.Description>
									Records keep their usual order. Add a sort to put newest, largest, or A–Z first — then another
									for ties.
								</Empty.Description>
							</Empty.Header>
							<Empty.Content>
								<Button variant="outline" onclick={addSort} disabled={!sourceType}>
									<PlusIcon data-icon="inline-start" />
									Add sort
								</Button>
							</Empty.Content>
						</Empty.Root>
					{:else}
						<div class="flex flex-col gap-2" role="list" bind:this={sortList}>
							{#each sorts as row, index (row)}
								{@const dirs = sortDirLabels(row.field)}
								<div
									role="listitem"
									data-sort-key={sortableId(row, "sort")}
									animate:flip={{ duration: 160 }}
									class={cn("flex flex-col gap-2", dragSort === row && "pointer-events-none opacity-0")}
								>
									{#if index > 0}
										<p class="px-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Then by</p>
									{/if}
									<div
										data-sort-card
										class="grid items-center gap-2 rounded-2xl bg-card p-3 ring-1 ring-foreground/10 md:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
									>
										<button
										type="button"
										class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
										aria-label="Drag to reorder sort"
										onpointerdown={(event) => onSortDragStart(row, event)}
									>
										<GripVerticalIcon class="size-4" />
									</button>
									<OptionSelect bind:value={row.field} options={sortFieldOptions(row.field)} />
									<ToggleGroup.Root type="single" bind:value={row.dir} variant="outline">
										<ToggleGroup.Item value="asc">{dirs.asc}</ToggleGroup.Item>
										<ToggleGroup.Item value="desc">{dirs.desc}</ToggleGroup.Item>
									</ToggleGroup.Root>
										<Button
										variant="ghost"
										size="icon-xs"
										onclick={() => removeSort(index)}
										aria-label="Remove sort"
									>
										<XIcon />
										</Button>
									</div>
								</div>
							{/each}
							{#if sortFieldOptions("").length}
								<div>
									<Button variant="outline" size="sm" onclick={addSort}>
										<PlusIcon data-icon="inline-start" />
										Then by
									</Button>
								</div>
							{/if}
						</div>
					{/if}
				</Tabs.Content>

				<Tabs.Content value="advanced" class="flex flex-col gap-4">
					<div class="flex flex-col gap-4 rounded-2xl bg-muted/60 p-4 ring-1 ring-foreground/5">
						<Field.Field orientation="horizontal">
							<Switch bind:checked={limitOn} onCheckedChange={(value) => setLimitOn(Boolean(value))} id="limit" />
							<Field.Content>
								<Field.Label for="limit">Limit results</Field.Label>
								<Field.Description>
									Caps how many matching records this list returns. Sort still applies first.
								</Field.Description>
							</Field.Content>
						</Field.Field>
						{#if limitOn}
							<Field.Field>
								<Field.Label for="limit-count">How many</Field.Label>
								<Input id="limit-count" bind:value={limit} inputmode="numeric" placeholder="25" class="max-w-48" />
							</Field.Field>
						{/if}
					</div>
				</Tabs.Content>
			</Tabs.Root>
		</Card.Content>
		<Card.Footer class="flex-wrap justify-between gap-2">
			<span class="text-xs text-muted-foreground">Current shape</span>
			<div class="flex flex-wrap justify-end gap-1.5">
				<Badge variant="outline">{selected.length} {selected.length === 1 ? "column" : "columns"}</Badge>
				{#if filters.length}<Badge variant="outline">{filters.length} {filters.length === 1 ? "filter" : "filters"}</Badge>{/if}
				{#if sorts.length}<Badge variant="outline">{sorts.length} {sorts.length === 1 ? "sort" : "sorts"}</Badge>{/if}
				{#if summarize}<Badge variant="secondary">Grouped</Badge>{/if}
				{#if limitOn}<Badge variant="secondary">Limited to {Number(limit) || "…"}</Badge>{/if}
			</div>
		</Card.Footer>
	</Card.Root>

	<Card.Root class="h-auto">
		<Collapsible.Root bind:open={previewOpen}>
			<Card.Header class="p-0">
				<Collapsible.Trigger
					class="flex w-full items-start justify-between gap-3 px-4 py-2.5 text-start hover:bg-muted/40"
				>
					<span class="flex min-w-0 flex-col gap-1">
						<span class="font-heading text-base font-medium">Live preview</span>
						<span class="text-sm text-muted-foreground">
							Live results from the query above. Nothing is saved until you press Save.
						</span>
					</span>
					<span class="flex shrink-0 items-center gap-2">
						<Badge variant="secondary">{preview == null ? "…" : `${preview.length}`}</Badge>
						<ChevronDownIcon
							class="size-4 text-muted-foreground transition-transform {previewOpen ? 'rotate-180' : ''}"
						/>
					</span>
				</Collapsible.Trigger>
			</Card.Header>
			<Collapsible.Content>
				<Card.Content class="flex flex-col gap-4">
					{#if usesRecord}
						<p class="text-sm text-muted-foreground">
							This list is filtered by the record you open it from. Preview shows the rest of the query
							without that.
						</p>
					{/if}
					{#if previewError}
						<p role="alert" class="text-sm text-destructive">{previewError}</p>
					{:else}
						{@render previewContent({ rows: preview, view: previewView, exposedFields: previewExposeFields, exposedValues: previewExpose, onFiltersChange: values => { previewExpose = values; } })}
					{/if}
				</Card.Content>
			</Collapsible.Content>
		</Collapsible.Root>
	</Card.Root>

	<EditorActions {dirty} onSave={save}>
		{#snippet left()}
			{#if !view.implicit}
				<Button variant="destructive-outline" size="sm" onclick={() => (deleteOpen = true)}>Delete view</Button>
			{/if}
		{/snippet}
		{#snippet beforeSave()}
			<Button variant="outline" onclick={duplicate}>
				<CopyIcon data-icon="inline-start" />
				Duplicate
			</Button>
		{/snippet}
	</EditorActions>
</div>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {view.label}?</AlertDialog.Title>
			<AlertDialog.Description>The list disappears from the app. Records stay.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
