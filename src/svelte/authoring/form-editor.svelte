<script lang="ts">
	import {
		reorderAtVerticalTarget,
		startVerticalDrag,
		type VerticalDragSession,
		verticalDropTarget,
	} from "./vertical-drag.js";
	import { fieldKindLabel } from "./editor-labels.js";
	import type { EditorContext, FormActions, FormPreview, RuleDraft } from "./authoring.js";
	import OptionSelect from "../ui/option-select/option-select.svelte";
	import EditorActions from "./editor-actions.svelte";
	import FormInputSheet from "./form-input-sheet.svelte";
	import FormPurposePicker from "./form-purpose-picker.svelte";
	import PageHeader from "../ui/page-header/page-header.svelte";
	import StatusPill from "./status-pill.svelte";
	import * as AlertDialog from "@jthum/framework/svelte/ui/alert-dialog";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import * as Collapsible from "@jthum/framework/svelte/ui/collapsible";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Separator } from "@jthum/framework/svelte/ui/separator";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import { conditionFieldKeys, renameConditionField } from "./editor-data.js";
	import { cloneData, type FieldDraft, type FormDraft } from "./authoring.js";
	import { cn } from "@jthum/framework/svelte/utils";
	import { stableStringify } from "./editor-data.js";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";
	import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
	import { onDestroy, type Snippet, untrack } from "svelte";
	import { flip } from "svelte/animate";
	import { toast } from "svelte-sonner";

	let { form, context: spec, actions, onDeleted, onCreateRule, ruleHref, describeRule, relatedRules = [], previewContent, class: className }: {
		form: FormDraft; context: EditorContext; actions: FormActions;
		class?: string;
		onDeleted: () => void | Promise<void>;
		onCreateRule: (form: FormDraft) => void | Promise<void>;
		ruleHref: (rule: RuleDraft) => string;
		describeRule: (rule: RuleDraft) => string;
		relatedRules?: RuleDraft[];
		previewContent: Snippet<[FormPreview]>;
	} = $props();
	const types = $derived(spec?.collections ?? []);

	type FormFieldRow = { field: string; on: boolean };

	let initializedForm = $state("");
	let label = $state("");
	let typeKey = $state("");
	let mode = $state<FormDraft["mode"]>("create");
	let fieldRows = $state<FormFieldRow[]>([]);
	let formInputs = $state<FieldDraft[]>([]);
	let inputSheetOpen = $state(false);
	let editingInput = $state<FieldDraft | null>(null);
	let successTitle = $state("");
	let successDescription = $state("");
	let deleteOpen = $state(false);
	let advancedOpen = $state(false);
	let dragField = $state<string | null>(null);
	let fieldList = $state<HTMLDivElement | null>(null);
	let dragSession: VerticalDragSession | null = null;

	$effect(() => {
		const type = types.find((item) => item.key === form.type);
		if (form.mode !== "standalone" && !type) return;
		const identity = `${form.id}:${form.key}`;
		if (initializedForm === identity) return;
		initializedForm = identity;
		untrack(() => {
			label = form.label;
			typeKey = form.type ?? types[0]?.key ?? "";
			mode = form.mode;
			formInputs = cloneData(form.inputs ?? []);
			successTitle = form.submit?.success?.title ?? "";
			successDescription = form.submit?.success?.description ?? "";
			advancedOpen = Boolean(form.submit?.success || relatedRules.length);
			fieldRows = mergeFields([], type?.fields.map((field) => field.key) ?? [], form.fields);
		});
	});

	const sourceType = $derived(
		types.find((item) => item.key === typeKey) ?? types.find((item) => item.key === form.type),
	);
	const selected = $derived(fieldRows.filter((row) => row.on).map((row) => row.field));
	const connectedWorkflows = $derived(relatedRules);
	const availableFields = $derived(
		fieldRows.flatMap((row) => {
			const definition = sourceType?.fields.find((field) => field.key === row.field);
			return definition ? [{ ...row, definition }] : [];
		}),
	);

	$effect(() => {
		const choices = sourceType?.fields.map((field) => field.key) ?? [];
		untrack(() => {
			fieldRows = mergeFields(fieldRows, choices);
		});
	});

	const draft = $derived({
		id: form.id,
		...(form.meta ? { meta: form.meta } : {}),
		key: form.key,
		label,
		mode,
		...(mode === "standalone"
			? { inputs: formInputs }
			: { type: typeKey, fields: selected }),
		submit:
			mode === "standalone" && (successTitle.trim() || successDescription.trim())
				? {
						success: {
							...(successTitle.trim() ? { title: successTitle.trim() } : {}),
							...(successDescription.trim() ? { description: successDescription.trim() } : {}),
						},
					}
				: undefined,
	} as FormDraft);
	const dirty = $derived(stableStringify(draft) !== stableStringify(form));

	function mergeFields(current: FormFieldRow[], choices: string[], preferredOn?: string[]): FormFieldRow[] {
		const choiceSet = new Set(choices);
		const enabled = new Set(preferredOn ?? current.filter((row) => row.on).map((row) => row.field));
		if (![...enabled].some((field) => choiceSet.has(field))) {
			for (const field of choices) enabled.add(field);
		}
		const ordered = preferredOn ? [...preferredOn, ...current.map((row) => row.field)] : current.map((row) => row.field);
		return [...new Set([...ordered, ...choices])]
			.filter((field) => choiceSet.has(field))
			.map((field) => ({ field, on: enabled.has(field) }));
	}

	function setFieldOn(field: string, on: boolean) {
		if (!on && selected.length <= 1) return;
		fieldRows = fieldRows.map((row) => row.field === field ? { ...row, on } : row);
	}

	function openAddInput() {
		editingInput = null;
		inputSheetOpen = true;
	}

	function saveInput(input: Partial<FieldDraft> & { key: string }) {
		const existing = editingInput ?? formInputs.find((item) => item.id === input.id);
		const normalized = actions.prepareField(input.key, input, existing ?? undefined);
		let next = formInputs.map((item) => (item.id === normalized.id ? normalized : item));
		if (!existing) next = [...next, normalized];
		if (existing && existing.key !== normalized.key) {
			next = next.map((item) => {
				const updated = { ...item };
				for (const property of ["visible_when", "enabled_when", "required_when"] as const) {
					if (updated[property]) updated[property] = renameConditionField(updated[property], existing.key, normalized.key);
				}
				return updated;
			});
		}
		formInputs = next;
	}

	function removeInput(input: FieldDraft) {
		formInputs = formInputs
			.filter((item) => item.id !== input.id)
			.map((item) => {
				const next = { ...item };
				for (const property of ["visible_when", "enabled_when", "required_when"] as const) {
					if (next[property] && conditionFieldKeys(next[property]).includes(input.key)) delete next[property];
				}
				if (!next.visible_when) delete next.hidden_value;
				return next;
			});
	}

	function moveInput(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= formInputs.length) return;
		const next = [...formInputs];
		[next[index], next[target]] = [next[target]!, next[index]!];
		formInputs = next;
	}

	function moveField(index: number, delta: number) {
		const target = index + delta;
		if (target < 0 || target >= fieldRows.length) return;
		const next = [...fieldRows];
		[next[index], next[target]] = [next[target]!, next[index]!];
		fieldRows = next;
	}

	function onFieldDragStart(field: string, event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement;
		dragField = field;
		dragSession = startVerticalDrag({
			event,
			container: fieldList,
			item: handle.closest<HTMLElement>("[role=listitem]"),
			onMove: (clientY) => {
				const target = verticalDropTarget(fieldList, clientY);
				if (target) fieldRows = reorderAtVerticalTarget(fieldRows, field, target, (row) => row.field);
			},
			onDrop: () => {
				dragSession = null;
				dragField = null;
			},
			onCancel: () => {
				dragSession = null;
				dragField = null;
			},
		});
		if (!dragSession) dragField = null;
	}

	function onInputDragStart(input: FieldDraft, event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement;
		dragField = input.key;
		dragSession = startVerticalDrag({
			event,
			container: fieldList,
			item: handle.closest<HTMLElement>("[role=listitem]"),
			onMove: (clientY) => {
				const target = verticalDropTarget(fieldList, clientY);
				if (target) formInputs = reorderAtVerticalTarget(formInputs, input.key, target, (item) => item.key);
			},
			onDrop: () => {
				dragSession = null;
				dragField = null;
			},
			onCancel: () => {
				dragSession = null;
				dragField = null;
			},
		});
		if (!dragSession) dragField = null;
	}

	onDestroy(() => dragSession?.cancel());

	async function save() {
		try {
			await actions.save(cloneData(draft));
			toast.success("Form saved");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save form");
		}
	}

	async function addAutomation() {
		try {
			if (dirty) await actions.save(cloneData(draft));
			await onCreateRule(cloneData(draft));
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not add automation");
		}
	}

	async function remove() {
		await actions.remove(form.key);
		toast.success("Form deleted");
		await onDeleted();
	}
</script>

<div class={cn("flex flex-col gap-8", className)}>
	<PageHeader
		title={label || form.label}
		description="Choose what this form collects, arrange its inputs, and preview the result as you work."
	/>

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>Form setup</Card.Title>
			<Card.Description>Decide what the form does, then choose its records and give it a name.</Card.Description>
		</Card.Header>
		<Card.Content>
			<Field.Group>
				<FormPurposePicker bind:value={mode} />
				{#if mode !== "standalone"}
					<Field.Field>
						<Field.Label>Record type</Field.Label>
						<OptionSelect
							bind:value={typeKey}
							options={types.map((type) => ({ value: type.key, label: type.label }))}
						/>
					</Field.Field>
				{/if}
				<Field.Field>
					<Field.Label for="form-name">Name</Field.Label>
					<Input id="form-name" bind:value={label} placeholder="Contact us" />
				</Field.Field>
			</Field.Group>
		</Card.Content>
	</Card.Root>

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>{mode === "standalone" ? "Inputs" : "Fields"}</Card.Title>
			<Card.Description>
				{mode === "standalone"
					? "Define the answers this form collects and arrange their reading order."
					: "Turn fields on or off and drag them into the order people should complete them."}
			</Card.Description>
			<Card.Action><Badge variant="secondary">{mode === "standalone" ? formInputs.length : selected.length} shown</Badge></Card.Action>
		</Card.Header>
		<Card.Content>
			<div class="flex flex-col gap-2" role="list" bind:this={fieldList}>
				{#if mode === "standalone"}
					{#if !formInputs.length}
						<div class="flex flex-col items-center gap-3 rounded-2xl border border-dashed px-6 py-10 text-center">
							<div><p class="font-medium">No inputs yet</p><p class="text-sm text-muted-foreground">Add the first question this form should ask.</p></div>
							<Button variant="outline" size="sm" onclick={openAddInput}>Add input</Button>
						</div>
					{/if}
					{#each formInputs as item, index (item.id)}
						<div
							role="listitem"
							data-sort-key={item.key}
							animate:flip={{ duration: 160 }}
							class={cn(
								"flex items-center gap-3 rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10",
								dragField === item.key && "pointer-events-none opacity-0",
							)}
						>
							<button type="button" class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing" aria-label="Drag to reorder {item.label}" onpointerdown={(event) => onInputDragStart(item, event)}><GripVerticalIcon class="size-4" /></button>
							<button type="button" class="min-w-0 flex-1 text-start" onclick={() => ((editingInput = item), (inputSheetOpen = true))}>
								<div class="font-medium">{item.label}</div>
								<div class="text-sm text-muted-foreground">{fieldKindLabel[item.type]}{#if item.description} · {item.description}{/if}</div>
							</button>
							{#if item.required}<Badge variant="outline">Required</Badge>{/if}
							{#if item.visible_when || item.enabled_when || item.required_when}<Badge variant="outline">Conditional</Badge>{/if}
							<div class="flex shrink-0 items-center">
								<Button variant="ghost" size="icon-sm" disabled={index === 0} onclick={() => moveInput(index, -1)} aria-label="Move {item.label} up"><ChevronUpIcon /></Button>
								<Button variant="ghost" size="icon-sm" disabled={index === formInputs.length - 1} onclick={() => moveInput(index, 1)} aria-label="Move {item.label} down"><ChevronDownIcon /></Button>
							</div>
						</div>
					{/each}
				{:else}
				{#each availableFields as item, index (item.field)}
					<div
						role="listitem"
						data-sort-key={item.field}
						animate:flip={{ duration: 160 }}
						class={cn(
							"flex items-center gap-3 rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10",
							!item.on && "opacity-65",
							dragField === item.field && "pointer-events-none opacity-0",
						)}
					>
						<button
							type="button"
							class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
							aria-label="Drag to reorder {item.definition.label}"
							onpointerdown={(event) => onFieldDragStart(item.field, event)}
						>
							<GripVerticalIcon class="size-4" />
						</button>
						<Switch
							size="sm"
							checked={item.on}
							disabled={item.on && selected.length <= 1}
							onCheckedChange={(value) => setFieldOn(item.field, Boolean(value))}
							aria-label="Show {item.definition.label}"
						/>
						<div class="min-w-0 flex-1">
							<div class="font-medium">{item.definition.label}</div>
							<div class="text-sm text-muted-foreground">{fieldKindLabel[item.definition.type]}</div>
						</div>
						{#if item.definition.required}<Badge variant="outline">Required</Badge>{/if}
						<div class="flex shrink-0 items-center">
							<Button variant="ghost" size="icon-sm" disabled={index === 0} onclick={() => moveField(index, -1)} aria-label="Move {item.definition.label} up">
								<ChevronUpIcon />
							</Button>
							<Button variant="ghost" size="icon-sm" disabled={index === availableFields.length - 1} onclick={() => moveField(index, 1)} aria-label="Move {item.definition.label} down">
								<ChevronDownIcon />
							</Button>
						</div>
					</div>
				{/each}
				{/if}
			</div>
		</Card.Content>
		<Card.Footer class="justify-between gap-3">
			<span class="text-xs text-muted-foreground">Order here becomes the form’s reading order.</span>
			{#if mode === "standalone"}
				{#if formInputs.length}<Button variant="outline" size="sm" onclick={openAddInput}>Add another</Button>{/if}
			{:else}
				<Badge variant="outline">{fieldRows.length - selected.length} hidden</Badge>
			{/if}
		</Card.Footer>
	</Card.Root>

	<Separator />
	<Collapsible.Root bind:open={advancedOpen}>
		<Collapsible.Trigger class="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-start text-muted-foreground hover:text-foreground">
			<span class="flex flex-col gap-0">
				<span class="font-medium text-foreground">Advanced</span>
				<span class="text-sm">Configure submission automations and confirmation.</span>
			</span>
			<span class="flex shrink-0 items-center gap-2">
				{#if connectedWorkflows.length}<Badge variant="secondary">{connectedWorkflows.length} {connectedWorkflows.length === 1 ? "automation" : "automations"}</Badge>{/if}
				{#if mode === "standalone" && (successTitle || successDescription)}<Badge variant="outline">Custom confirmation</Badge>{/if}
				<ChevronDownIcon class="size-4 transition-transform {advancedOpen ? 'rotate-180' : ''}" />
			</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="pt-3">
			<Card.Root class="h-auto">
				<Card.Header class="gap-0">
					<Card.Title>After submission</Card.Title>
					<Card.Description>Every successful submission emits an event that workflows can respond to.</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Group>
						<div class="flex items-start justify-between gap-4">
							<div class="flex min-w-0 flex-col gap-0.5">
								<p class="font-medium">Automations</p>
								<p class="text-sm text-muted-foreground">Business logic stays in workflows connected to this form.</p>
							</div>
							<Button variant="outline" size="sm" onclick={addAutomation}>Add automation</Button>
						</div>
						{#if connectedWorkflows.length}
							<div class="flex flex-col gap-2">
								{#each connectedWorkflows as workflow (workflow.id)}
									<a href={ruleHref(workflow)} class="flex items-center gap-3 rounded-xl border bg-background px-3 py-3 transition-colors hover:bg-muted/40">
										<div class="min-w-0 flex-1">
											<p class="font-medium">{workflow.label}</p>
											<p class="truncate text-xs text-muted-foreground">{describeRule(workflow)}</p>
										</div>
										<StatusPill path="status" value={workflow.enabled === false ? "Paused" : "Active"} tone={workflow.enabled === false ? "warning" : "info"} />
									</a>
								{/each}
							</div>
						{:else}
							<p class="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">No workflows respond to this form yet. Submissions are validated, then discarded unless an automation stores or sends them.</p>
						{/if}
						{#if mode === "standalone"}
							<Separator />
							<Field.FieldSet>
								<Field.FieldLegend>Success message</Field.FieldLegend>
								<Field.Description>Optional confirmation shown after the form is submitted.</Field.Description>
								<Field.Group>
									<Field.Field>
										<Field.Label for="success-title">Title</Field.Label>
										<Input id="success-title" bind:value={successTitle} placeholder="Response submitted" />
									</Field.Field>
									<Field.Field>
										<Field.Label for="success-description">Message</Field.Label>
										<Input id="success-description" bind:value={successDescription} placeholder="Thank you. Your response has been received." />
									</Field.Field>
								</Field.Group>
							</Field.FieldSet>
						{/if}
					</Field.Group>
				</Card.Content>
			</Card.Root>
		</Collapsible.Content>
	</Collapsible.Root>

	<Separator />

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>Live preview</Card.Title>
			<Card.Description>This is how the selected fields and their order will appear.</Card.Description>
		</Card.Header>
		<Card.Content>
			{#if mode === "standalone" || sourceType}
				<div inert>
					{@render previewContent({ collection: sourceType, form: draft, fields: mode === "standalone" ? undefined : selected })}
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<EditorActions {dirty} onSave={save}>
		{#snippet left()}
			{#if !form.implicit}
				<Button variant="destructive-outline" size="sm" onclick={() => (deleteOpen = true)}>Delete form</Button>
			{/if}
		{/snippet}
	</EditorActions>
</div>

<FormInputSheet
	bind:open={inputSheetOpen}
	input={editingInput}
	inputs={formInputs}
	{types}
	onSave={saveInput}
	onRemove={removeInput}
/>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {form.label}?</AlertDialog.Title>
			<AlertDialog.Description>The custom form is removed. The built-in add/edit screens remain.</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
