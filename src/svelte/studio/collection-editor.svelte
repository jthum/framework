<script lang="ts">
	import { fieldKindHint, fieldKindLabel } from "./editor-labels.js";
	import type { CollectionActions, EditorContext } from "./authoring.js";
	import {
		reorderAtVerticalTarget,
		startVerticalDrag,
		type VerticalDragSession,
		verticalDropTarget,
	} from "./vertical-drag.js";
	import OptionSelect from "./option-select.svelte";
	import FieldConditionControl from "./field-condition-control.svelte";
	import LifecycleEditor from "./lifecycle-editor.svelte";
	import PageHeader from "./page-header.svelte";
	import StatusPill from "./status-pill.svelte";
	import * as AlertDialog from "@jthum/framework/svelte/ui/alert-dialog";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import * as Collapsible from "@jthum/framework/svelte/ui/collapsible";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Separator } from "@jthum/framework/svelte/ui/separator";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import * as Sheet from "@jthum/framework/svelte/ui/sheet";
	import { Spinner } from "@jthum/framework/svelte/ui/spinner";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import { slugify, uniqueKey } from "./editor-data.js";
	import {
		FIELD_KINDS,
		VALUE_SEMANTICS,
		cloneData,
		fieldCapability,
		type FieldDraft,
		type FieldCondition,
		type FieldFormat,
		type FieldKind,
		type FieldPresentation,
		type CollectionDraft,
		type ValueSemantic,
	} from "./authoring.js";
	import { cn } from "@jthum/framework/svelte/utils";
	import CalendarIcon from "@lucide/svelte/icons/calendar";
	import ClockIcon from "@lucide/svelte/icons/clock";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import ChevronUpIcon from "@lucide/svelte/icons/chevron-up";
	import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
	import HashIcon from "@lucide/svelte/icons/hash";
	import LinkIcon from "@lucide/svelte/icons/link";
	import ListIcon from "@lucide/svelte/icons/list";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import ToggleLeftIcon from "@lucide/svelte/icons/toggle-left";
	import TypeIcon from "@lucide/svelte/icons/type";
	import XIcon from "@lucide/svelte/icons/x";
	import { onDestroy, type Component, untrack } from "svelte";
	import { flip } from "svelte/animate";
	import { toast } from "svelte-sonner";

	let { collection: type, context: spec, actions, onOpen, onDeleted, defaultCollectionLabel, description = "Define the record shape and its fields.", canDelete = true, referenceLabel = (item: CollectionDraft) => item.label, class: className }: {
		collection: CollectionDraft;
		class?: string;
		context: EditorContext;
		actions: CollectionActions;
		onOpen: (key: string) => void | Promise<void>;
		onDeleted: () => void | Promise<void>;
		defaultCollectionLabel: (label: string) => string;
		description?: string;
		canDelete?: boolean;
		referenceLabel?: (collection: CollectionDraft) => string;
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
	const semanticOptions: Array<{ value: ValueSemantic; label: string }> = VALUE_SEMANTICS.map(
		(value) => ({
			value,
			label: value === "neutral" ? "Normal" : value.charAt(0).toUpperCase() + value.slice(1),
		}),
	);

	const targets = $derived(spec?.collections ?? []);
	const targetOptions = $derived(
		targets
			.filter((item) => item.key !== type.key)
			.map((item) => ({
				value: item.key,
				label: referenceLabel(item),
			})),
	);
	const inbound = $derived(
		(spec?.collections ?? []).flatMap((item) =>
			item.fields
				.filter((field) => field.type === "reference" && field.target?.split(".").at(-1) === type.key)
				.map((field) => ({ type: item, field })),
		),
	);

	let sheetOpen = $state(false);
	let namingTypeId = $state("");
	let typeLabel = $state("");
	let collectionName = $state("");
	let namingPending = $state(false);
	let technicalKey = $state("");
	let renameTypeOpen = $state(false);
	let typeKeyPending = $state(false);
	let fieldPending = $state(false);
	let editing = $state<FieldDraft | null>(null);
	let fieldKey = $state("");
	let fieldLabel = $state("");
	let fieldType = $state<string>("text");
	let fieldRequired = $state(false);
	let fieldDescription = $state("");
	let fieldPlaceholder = $state("");
	let fieldFormat = $state<"" | FieldFormat>("");
	let fieldCurrency = $state("USD");
	let fieldChoices = $state<string[]>([]);
	let fieldValueSemantics = $state<Record<string, ValueSemantic>>({});
	let choiceDraft = $state("");
	let fieldTarget = $state("");
	let fieldPresentation = $state<"" | FieldPresentation>("");
	let fieldRatingVariant = $state<"segments">("segments");
	let fieldRatingMax = $state("10");
	let fieldValidationMin = $state("");
	let fieldValidationMax = $state("");
	let fieldValidationMinLength = $state("");
	let fieldValidationMaxLength = $state("");
	let fieldValidationPattern = $state("");
	let fieldValidationMessage = $state("");
	let fieldVisibleWhen = $state<FieldCondition | undefined>();
	let fieldEnabledWhen = $state<FieldCondition | undefined>();
	let fieldRequiredWhen = $state<FieldCondition | undefined>();
	let fieldHiddenValue = $state<"preserve" | "clear">("preserve");
	let advanced = $state(false);
	let schemaAdvanced = $state(false);
	let removeKey = $state<string | null>(null);
	let deleteOpen = $state(false);
	let dragKey = $state<string | null>(null);
	let dragSession: VerticalDragSession | null = null;
	let dragOriginOrder: string[] = [];
	let fieldList = $state<HTMLDivElement | null>(null);
	let fieldOrder = $state<string[]>([]);
	let syncedFieldOrder = "";
	const orderedFields = $derived(
		fieldOrder.length
			? fieldOrder
					.map((key) => type.fields.find((field) => field.key === key))
					.filter((field): field is FieldDraft => Boolean(field))
			: type.fields,
	);
	const inferredCollectionName = $derived(defaultCollectionLabel(typeLabel.trim() || type.label));

	$effect(() => {
		const keys = type.fields.map((field) => field.key);
		const signature = keys.join("\u0000");
		if (signature === syncedFieldOrder) return;
		syncedFieldOrder = signature;
		untrack(() => {
			fieldOrder = keys;
		});
	});

	$effect(() => {
		if (type.id === namingTypeId) return;
		namingTypeId = type.id;
		typeLabel = type.label;
		collectionName = type.collection_label ?? "";
		technicalKey = type.key;
	});

	async function saveNaming(event: SubmitEvent) {
		event.preventDefault();
		const label = typeLabel.trim();
		if (!label) return;
		namingPending = true;
		try {
			await actions.save({
				key: type.key,
				label,
				collection_label: collectionName.trim(),
				expose: type.expose,
			});
			toast.success("Collection naming saved");
		} finally {
			namingPending = false;
		}
	}

	function confirmTypeRename() {
		const key = slugify(technicalKey);
		if (!key || key === type.key) return;
		technicalKey = key;
		renameTypeOpen = true;
	}

	async function renameTechnicalKey() {
		const key = slugify(technicalKey);
		if (!key || key === type.key) return;
		typeKeyPending = true;
		try {
			await actions.rename(type.key, key);
			renameTypeOpen = false;
			toast.success("Technical key renamed");
			await onOpen(key);
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not rename the collection key");
		} finally {
			typeKeyPending = false;
		}
	}

	const selectedKind = $derived((FIELD_KINDS.includes(fieldType as FieldKind) ? fieldType : "text") as FieldKind);
	const selectedCapability = $derived(fieldCapability(selectedKind));
	const presentationOptions = $derived([
		{ value: "", label: selectedCapability.defaultPresentationLabel },
		...selectedCapability.presentations.map((option) => ({ value: option.value, label: option.label })),
	]);
	const formatOptions = $derived([
		{ value: "", label: selectedCapability.defaultFormatLabel },
		...selectedCapability.formats.map((option) => ({ value: option.value, label: option.label })),
	]);
	const supportsNumberRange = $derived(selectedCapability.validation.includes("min" as never));
	const supportsTextRules = $derived(selectedCapability.validation.includes("min_length" as never));
	const presentationCapability = $derived(
		selectedCapability.presentations.find((option) => option.value === fieldPresentation),
	);
	const presentationVariantOptions = $derived(
		(presentationCapability?.variants ?? []).map((variant) => ({
			value: variant.value,
			label: variant.label,
		})),
	);

	function openAdd(kind: FieldKind = "text") {
		editing = null;
		fieldKey = "";
		fieldLabel = "";
		fieldType = kind;
		fieldRequired = false;
		fieldDescription = "";
		fieldPlaceholder = "";
		fieldFormat = "";
		fieldCurrency = "USD";
		fieldChoices = kind === "enum" ? ["draft", "active"] : [];
		fieldValueSemantics = {};
		choiceDraft = "";
		fieldTarget = targetOptions[0]?.value ?? "";
		fieldPresentation = "";
		fieldRatingVariant = "segments";
		fieldRatingMax = "10";
		fieldValidationMin = "";
		fieldValidationMax = "";
		fieldValidationMinLength = "";
		fieldValidationMaxLength = "";
		fieldValidationPattern = "";
		fieldValidationMessage = "";
		fieldVisibleWhen = undefined;
		fieldEnabledWhen = undefined;
		fieldRequiredWhen = undefined;
		fieldHiddenValue = "preserve";
		advanced = false;
		sheetOpen = true;
	}

	function openEdit(field: FieldDraft) {
		editing = field;
		fieldKey = field.key;
		fieldLabel = field.label;
		fieldType = field.type;
		fieldRequired = Boolean(field.required);
		fieldDescription = field.description ?? "";
		fieldPlaceholder = field.placeholder ?? "";
		fieldFormat = field.format ?? "";
		fieldCurrency = field.currency ?? "USD";
		fieldChoices = [...(field.values ?? [])];
		fieldValueSemantics = field.value_semantics ? { ...field.value_semantics } : {};
		choiceDraft = "";
		fieldTarget = field.target ?? "";
		fieldPresentation = field.presentation ?? "";
		fieldRatingVariant = field.variant ?? "segments";
		fieldRatingMax = String(field.max ?? 10);
		fieldValidationMin = valueString(field.validation?.min);
		fieldValidationMax = valueString(field.validation?.max);
		fieldValidationMinLength = valueString(field.validation?.min_length);
		fieldValidationMaxLength = valueString(field.validation?.max_length);
		fieldValidationPattern = field.validation?.pattern ?? "";
		fieldValidationMessage = field.validation?.message ?? "";
		fieldVisibleWhen = field.visible_when ? cloneData(field.visible_when) : undefined;
		fieldEnabledWhen = field.enabled_when ? cloneData(field.enabled_when) : undefined;
		fieldRequiredWhen = field.required_when ? cloneData(field.required_when) : undefined;
		fieldHiddenValue = field.hidden_value ?? "preserve";
		advanced = Boolean(
			field.description || field.placeholder || field.validation || field.visible_when || field.enabled_when || field.required_when,
		);
		sheetOpen = true;
	}

	function addChoice() {
		const value = slugify(choiceDraft);
		if (!value || fieldChoices.includes(value)) {
			choiceDraft = "";
			return;
		}
		fieldChoices = [...fieldChoices, value];
		fieldValueSemantics = { ...fieldValueSemantics, [value]: "neutral" };
		choiceDraft = "";
	}

	function removeChoice(value: string) {
		fieldChoices = fieldChoices.filter((item) => item !== value);
		const next = { ...fieldValueSemantics };
		delete next[value];
		fieldValueSemantics = next;
	}

	function setChoiceSemantic(value: string, semantic: string) {
		fieldValueSemantics = { ...fieldValueSemantics, [value]: semantic as ValueSemantic };
	}

	function setFieldType(kind: FieldKind) {
		if (fieldType !== kind) {
			fieldPresentation = "";
			fieldFormat = "";
		}
		fieldType = kind;
	}

	function valueString(value: number | undefined) {
		return value === undefined ? "" : String(value);
	}

	function optionalNumber(value: string): number | undefined {
		if (!value.trim()) return undefined;
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	}

	async function saveField() {
		if (fieldPending) return;
		const enteredKey = fieldKey.trim();
		const baseKey = enteredKey || slugify(fieldLabel);
		const key =
			editing || enteredKey
				? baseKey
				: uniqueKey(baseKey, type.fields.map((field) => field.key), "field");
		if (!key) return;
		if (fieldType === "reference" && !fieldTarget) {
				toast.error("Pick a collection to link to");
			return;
		}
		if (fieldType === "enum" && fieldChoices.length === 0) {
			toast.error("Add at least one choice");
			return;
		}
		fieldPending = true;
		try {
			if (editing && editing.key !== key) {
				await actions.renameField(type.key, editing.key, key);
			}
			const fieldDraft: Partial<FieldDraft> & { key: string } = {
				key,
				label: fieldLabel || undefined,
				type: fieldType as FieldKind,
				description: fieldDescription.trim() || undefined,
				placeholder: fieldPlaceholder.trim() || undefined,
				required: fieldRequired,
				values: fieldType === "enum" ? fieldChoices : undefined,
				target: fieldType === "reference" ? fieldTarget : undefined,
				format:
					(fieldType === "text" ||
						(fieldType === "number" && fieldPresentation !== "rating")) &&
					fieldFormat
						? fieldFormat
						: undefined,
				currency:
					fieldType === "number" && fieldPresentation !== "rating" && fieldFormat === "currency"
						? fieldCurrency.trim().toUpperCase()
						: undefined,
				presentation:
					fieldType === "text" && fieldPresentation === "textarea"
						? "textarea"
						: fieldType === "number" && fieldPresentation === "rating"
							? "rating"
							: fieldType === "enum" && fieldPresentation === "badge"
								? "badge"
								: undefined,
				variant:
					fieldType === "number" && fieldPresentation === "rating"
						? fieldRatingVariant
						: undefined,
				max:
					fieldType === "number" && fieldPresentation === "rating"
						? Math.min(10, Math.max(2, Math.round(Number(fieldRatingMax) || 10)))
						: undefined,
				value_semantics:
					fieldType === "enum" && fieldPresentation === "badge"
						? Object.fromEntries(
								fieldChoices.map((value) => [value, fieldValueSemantics[value] ?? "neutral"]),
							)
						: undefined,
				validation: {
					min: supportsNumberRange ? optionalNumber(fieldValidationMin) : undefined,
					max: supportsNumberRange ? optionalNumber(fieldValidationMax) : undefined,
					min_length: supportsTextRules ? optionalNumber(fieldValidationMinLength) : undefined,
					max_length: supportsTextRules ? optionalNumber(fieldValidationMaxLength) : undefined,
					pattern: supportsTextRules ? fieldValidationPattern.trim() || undefined : undefined,
					message: fieldValidationMessage.trim() || undefined,
				},
				visible_when: fieldVisibleWhen,
				enabled_when: fieldEnabledWhen,
				required_when: fieldRequiredWhen,
				hidden_value: fieldVisibleWhen && fieldHiddenValue === "clear" ? "clear" : undefined,
			};
			await actions.saveField(type.key, cloneData(fieldDraft));
			sheetOpen = false;
			toast.success(editing ? "Field saved" : "Field added");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save field");
		} finally {
			fieldPending = false;
		}
	}

	async function move(index: number, delta: number) {
		const next = [...fieldOrder];
		const target = index + delta;
		if (target < 0 || target >= next.length) return;
		[next[index], next[target]] = [next[target]!, next[index]!];
		fieldOrder = next;
		await actions.reorderFields(type.key, next);
	}

	function onDragStart(key: string, event: PointerEvent) {
		const handle = event.currentTarget as HTMLElement;
		const row = handle.closest<HTMLElement>("[data-field-key]");
		const currentOrder = fieldOrder.length ? [...fieldOrder] : orderedFields.map((field) => field.key);
		fieldOrder = currentOrder;
		dragOriginOrder = currentOrder;
		dragKey = key;
		dragSession = startVerticalDrag({
			event,
			container: fieldList,
			item: row,
			onMove: (clientY) => {
				const target = verticalDropTarget(fieldList, clientY);
				if (target) fieldOrder = reorderAtVerticalTarget(fieldOrder, key, target, (item) => item);
			},
			onDrop: async () => {
				const next = [...fieldOrder];
				dragSession = null;
				dragKey = null;
				if (next.join("\u0000") !== type.fields.map((field) => field.key).join("\u0000")) {
					await actions.reorderFields(type.key, next);
				}
			},
			onCancel: () => {
				dragSession = null;
				fieldOrder = dragOriginOrder;
				dragKey = null;
			},
		});
		if (!dragSession) dragKey = null;
	}

	onDestroy(() => dragSession?.cancel());

	async function remove() {
		if (!removeKey) return;
		try {
			await actions.deleteField(type.key, removeKey);
			removeKey = null;
			toast.success("Field removed");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not remove field");
		}
	}

	async function removeType() {
		try {
			await actions.remove(type.key);
			toast.success("Collection removed");
			await onDeleted();
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not remove collection");
		}
	}

	const removing = $derived(type.fields.find((field) => field.key === removeKey));
	const fieldKeyConflict = $derived(
		Boolean(fieldKey.trim()) &&
			type.fields.some(
				(field) => field.key === slugify(fieldKey) && field.id !== editing?.id,
			),
	);
	const canSave = $derived(
		Boolean(fieldLabel.trim()) &&
			!fieldKeyConflict &&
			(fieldType !== "reference" || Boolean(fieldTarget)) &&
			(fieldType !== "enum" || fieldChoices.length > 0) &&
			(fieldPresentation === "rating" ||
				fieldFormat !== "currency" ||
				/^[A-Za-z]{3}$/.test(fieldCurrency.trim())),
	);
</script>

<div class={cn("flex flex-col gap-8", className)}>
	<PageHeader
		title={type.label}
		{description}
	>
		{#snippet actions()}
			{#if canDelete}
				<Button variant="destructive-outline" onclick={() => (deleteOpen = true)}>Delete</Button>
			{/if}
		{/snippet}
	</PageHeader>

	{#if inbound.length}
		<p class="text-sm text-muted-foreground">
			Linked from
			{inbound.map((item) => `${item.type.label} (${item.field.label})`).join(", ")}.
		</p>
	{/if}

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>Naming</Card.Title>
			<Card.Description>Choose how one record and the full collection are named.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form id="collection-naming" onsubmit={saveNaming}>
				<Field.Group class="grid gap-4 sm:grid-cols-2">
					<Field.Field>
						<Field.Label for="collection-label">Singular name</Field.Label>
						<Input id="collection-label" bind:value={typeLabel} placeholder="Person" />
						<Field.Description>Used when referring to one record.</Field.Description>
					</Field.Field>
					<Field.Field>
						<Field.Label for="collection-label">Collection name</Field.Label>
						<Input id="collection-label" bind:value={collectionName} placeholder={inferredCollectionName} />
						<Field.Description>
							Optional. Defaults to {inferredCollectionName}; set it for unusual or translated names.
						</Field.Description>
					</Field.Field>
				</Field.Group>
			</form>
		</Card.Content>
		<Card.Footer class="justify-end">
			<Button type="submit" form="collection-naming" disabled={!typeLabel.trim() || namingPending}>
				{#if namingPending}<Spinner data-icon="inline-start" />{/if}
				Save naming
			</Button>
		</Card.Footer>
	</Card.Root>

	<Card.Root class="h-auto">
		<Card.Header class="gap-0">
			<Card.Title>Fields</Card.Title>
			<Card.Description>Define the information stored on every {type.label.toLowerCase()} record.</Card.Description>
			<Card.Action>
				<Button size="sm" onclick={() => openAdd()}><PlusIcon data-icon="inline-start" /> Add field</Button>
			</Card.Action>
		</Card.Header>
		<Card.Content>
		{#if type.fields.length === 0}
			<div class="flex flex-col gap-4">
				<div class="flex flex-col gap-1">
					<p class="font-medium">What does a {type.label.toLowerCase()} remember?</p>
					<p class="text-sm text-muted-foreground">
						Pick a field kind to start. You can reorder and edit anything after.
					</p>
				</div>
				<div class="grid gap-2 sm:grid-cols-2">
					{#each FIELD_KINDS as kind (kind)}
						{@const Icon = kindIcons[kind]}
						<button
							type="button"
							class="flex items-start gap-3 rounded-xl border bg-background p-3 text-start transition-colors hover:bg-muted/40"
							onclick={() => openAdd(kind)}
						>
							<span class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
								<Icon class="size-4" />
							</span>
							<span class="min-w-0">
								<span class="block text-sm font-medium">{fieldKindLabel[kind]}</span>
								<span class="block text-xs text-muted-foreground">{fieldKindHint[kind]}</span>
							</span>
						</button>
					{/each}
				</div>
			</div>
		{:else}
			<div class="flex flex-col gap-2" role="list" bind:this={fieldList}>
			{#each orderedFields as field, index (field.id)}
				{@const Icon = kindIcons[field.type] ?? TypeIcon}
				<div
					role="listitem"
					data-field-key={field.key}
					data-sort-key={field.key}
					animate:flip={{ duration: 160 }}
					class={cn(
						"relative flex items-center gap-3 rounded-2xl bg-card px-3 py-3 ring-1 ring-foreground/10 transition-[box-shadow,opacity] duration-150",
						dragKey === field.key && "pointer-events-none opacity-0",
					)}
				>
					<button
						type="button"
						class="touch-none cursor-grab text-muted-foreground select-none hover:text-foreground active:cursor-grabbing"
						aria-label="Drag to reorder"
						onpointerdown={(event) => onDragStart(field.key, event)}
					>
						<GripVerticalIcon class="size-4" />
					</button>
					<button type="button" class="flex min-w-0 flex-1 items-center gap-3 text-start" onclick={() => openEdit(field)}>
						<div class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
							<Icon class="size-4" />
						</div>
						<div class="min-w-0 flex-1">
							<div class="font-medium">{field.label}</div>
							<div class="text-sm text-muted-foreground">
								{fieldKindLabel[field.type]}
								{#if field.target}
									{@const target = targets.find((item) => item.key === field.target?.split(".").at(-1))}
									→ {target?.label ?? field.target}
								{/if}
								{#if field.type === "enum" && field.values?.length}
									· {field.values.map((value) => value.replaceAll("_", " ")).join(", ")}
								{/if}
								{#if field.type === "enum" && field.presentation === "badge"}
									· Badges
								{/if}
								{#if field.type === "number" && field.presentation === "rating"}
									· Rating · {field.max ?? 10} points
								{/if}
								{#if field.type === "text" && field.presentation === "textarea"}
									· Long answer
								{/if}
								{#if field.format}
									· {field.format === "currency" && field.currency ? field.currency : field.format.replaceAll("_", " ")}
								{/if}
							</div>
						</div>
					</button>
					<div class="flex shrink-0 items-center gap-1">
						{#if field.required}
							<Badge variant="secondary">Required</Badge>
						{/if}
						{#if field.validation}<Badge variant="outline">Validated</Badge>{/if}
						{#if field.visible_when || field.enabled_when || field.required_when}
							<Badge variant="outline">Conditional</Badge>
						{/if}
						<Button size="icon-sm" variant="ghost" disabled={index === 0} onclick={() => move(index, -1)}>
							<ChevronUpIcon />
							<span class="sr-only">Move up</span>
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							disabled={index === orderedFields.length - 1}
							onclick={() => move(index, 1)}
						>
							<ChevronDownIcon />
							<span class="sr-only">Move down</span>
						</Button>
					</div>
				</div>
			{/each}
			</div>
		{/if}
		</Card.Content>
		<Card.Footer class="justify-between gap-3">
			<span class="text-xs text-muted-foreground">{type.fields.length} {type.fields.length === 1 ? "field" : "fields"} in this schema</span>
			{#if type.fields.length}<Button variant="outline" size="sm" onclick={() => openAdd()}><PlusIcon data-icon="inline-start" /> Add another</Button>{/if}
		</Card.Footer>
	</Card.Root>

	<Separator />
	<Collapsible.Root bind:open={schemaAdvanced}>
		<Collapsible.Trigger class="flex w-full items-center justify-between gap-3 rounded-xl px-1 py-2 text-start text-muted-foreground hover:text-foreground">
			<span class="flex flex-col gap-0">
				<span class="font-medium text-foreground">Advanced</span>
				<span class="text-sm">Schema identity and optional lifecycle behavior.</span>
			</span>
			<span class="flex shrink-0 items-center gap-2">
				{#if type.lifecycle}<Badge variant="secondary">Lifecycle configured</Badge>{/if}
				<ChevronDownIcon class="size-4 transition-transform {schemaAdvanced ? 'rotate-180' : ''}" />
			</span>
		</Collapsible.Trigger>
		<Collapsible.Content class="flex flex-col gap-3 pt-3">
			<Card.Root class="h-auto">
				<Card.Header class="gap-0">
					<Card.Title>Technical key</Card.Title>
					<Card.Description>
						Used in the spec, URLs, and runtime storage. Use Naming above for ordinary wording changes.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Field>
						<Field.Label for="collection-technical-key">Key</Field.Label>
						<Input id="collection-technical-key" bind:value={technicalKey} placeholder="project" />
						<Field.Description>
							Renaming preserves the collection identity and records, and updates references throughout the workspace.
						</Field.Description>
					</Field.Field>
				</Card.Content>
				<Card.Footer class="justify-end">
					<Button
						variant="outline"
						disabled={!slugify(technicalKey) || slugify(technicalKey) === type.key || typeKeyPending}
						onclick={confirmTypeRename}
					>
						Rename key
					</Button>
				</Card.Footer>
			</Card.Root>
			<LifecycleEditor {type} onSave={actions.save} />
		</Collapsible.Content>
	</Collapsible.Root>
</div>

<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content class="sm:max-w-md" side="right">
		<Sheet.Header>
			<Sheet.Title>{editing ? "Edit field" : "Add field"}</Sheet.Title>
			<Sheet.Description>
				{editing ? "Change how this field is stored and shown." : "People see the name. The kind decides the control."}
			</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-col gap-4 overflow-y-auto px-6">
			<Field.Group>
				<Field.Field>
					<Field.Label>Name</Field.Label>
					<Input bind:value={fieldLabel} placeholder="Name" />
				</Field.Field>
				<Field.Field>
					<Field.Label>Kind</Field.Label>
					<div class="grid grid-cols-2 gap-2">
						{#each FIELD_KINDS as kind (kind)}
							{@const Icon = kindIcons[kind]}
							<button
								type="button"
								class="flex items-start gap-2 rounded-xl border p-2.5 text-start transition-colors hover:bg-muted/40 {selectedKind ===
								kind
									? 'border-primary bg-primary/5 ring-2 ring-primary/20'
									: 'border-border'}"
								onclick={() => setFieldType(kind)}
							>
								<Icon class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
								<span class="min-w-0">
									<span class="block text-sm font-medium">{fieldKindLabel[kind]}</span>
									<span class="block text-xs text-muted-foreground">{fieldKindHint[kind]}</span>
								</span>
							</button>
						{/each}
					</div>
				</Field.Field>
				{#if fieldType === "enum"}
					<Field.Field>
						<Field.Label>Choices</Field.Label>
						<div class="flex flex-wrap gap-1.5">
							{#each fieldChoices as value (value)}
								<button
									type="button"
									class="inline-flex items-center gap-1 rounded-full border bg-background px-2.5 py-1 text-xs font-medium"
									onclick={() => removeChoice(value)}
								>
									{value.replaceAll("_", " ")}
									<XIcon class="size-3 text-muted-foreground" />
								</button>
							{/each}
						</div>
						<div class="flex flex-nowrap gap-2">
							<Input
								bind:value={choiceDraft}
								placeholder="Add a choice"
								onkeydown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										addChoice();
									}
								}}
							/>
							<Button type="button" variant="outline" class="shrink-0" onclick={addChoice}>Add</Button>
						</div>
						<Field.Description>People pick one. Click a choice to remove it.</Field.Description>
					</Field.Field>
				{/if}
				{#if fieldType === "reference"}
					<Field.Field>
						<Field.Label>Links to</Field.Label>
						<OptionSelect bind:value={fieldTarget} options={targetOptions} placeholder="Select a collection" />
						<Field.Description>
							{#if targetOptions.length}
								The other record type this field points at.
							{:else}
								Add another record type first, then you can link to it.
							{/if}
						</Field.Description>
					</Field.Field>
				{/if}
				{#if selectedCapability.presentations.length || selectedCapability.formats.length}
					{#if selectedCapability.presentations.length}
						<Field.Field>
							<Field.Label>Presentation</Field.Label>
							<OptionSelect bind:value={fieldPresentation} options={presentationOptions} />
							<Field.Description>{presentationCapability?.description ?? "Choose how people enter and see this value."}</Field.Description>
						</Field.Field>
					{/if}
					{#if selectedCapability.formats.length}
						<Field.Field>
							<Field.Label>Format</Field.Label>
							<OptionSelect bind:value={fieldFormat} options={formatOptions} />
							<Field.Description>Give the stored value additional meaning.</Field.Description>
						</Field.Field>
					{/if}
				{/if}
				{#if fieldPresentation === "badge"}
					<Field.Field>
						<Field.Label>Badge meaning</Field.Label>
						<div class="flex flex-col gap-2">
							{#each fieldChoices as value (value)}
								<div class="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 rounded-xl border bg-background p-2">
									<div class="min-w-0">
										<StatusPill path={fieldKey || slugify(fieldLabel) || "choice"} {value} tone={fieldValueSemantics[value] ?? "neutral"} />
									</div>
									<OptionSelect value={fieldValueSemantics[value] ?? "neutral"} options={semanticOptions} onValueChange={(semantic) => setChoiceSemantic(value, semantic)} />
								</div>
							{/each}
						</div>
						<Field.Description>Use meaning consistently. Leave ordinary workflow stages as normal or informational.</Field.Description>
					</Field.Field>
				{/if}
				{#if fieldFormat === "currency"}
					<Field.Field>
						<Field.Label>Currency code</Field.Label>
						<Input class="uppercase" maxlength={3} bind:value={fieldCurrency} placeholder="USD" />
						<Field.Description>Use a three-letter ISO code such as USD, EUR, GBP, or INR.</Field.Description>
					</Field.Field>
				{/if}
				{#if fieldPresentation === "rating"}
					{#if presentationVariantOptions.length}
						<Field.Field>
							<Field.Label>Style</Field.Label>
							<OptionSelect bind:value={fieldRatingVariant} options={presentationVariantOptions} />
							<Field.Description>{presentationCapability?.variants?.find((variant) => variant.value === fieldRatingVariant)?.description}</Field.Description>
						</Field.Field>
					{/if}
						<Field.Field>
							<Field.Label for="rating-maximum">Highest rating</Field.Label>
							<Input
								id="rating-maximum"
								type="number"
								min="2"
								max="10"
								step="1"
								bind:value={fieldRatingMax}
							/>
							<Field.Description>Use a scale from 2 to 10. New ratings start at 1.</Field.Description>
						</Field.Field>
				{/if}
				<Field.Field orientation="horizontal">
					<Switch bind:checked={fieldRequired} id="required" />
					<Field.Label for="required">Required</Field.Label>
				</Field.Field>
			</Field.Group>
			<Separator />
			<Collapsible.Root bind:open={advanced}>
				<Collapsible.Trigger
					class="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground"
				>
					Advanced
					<ChevronDownIcon class="size-4 transition-transform {advanced ? 'rotate-180' : ''}" />
				</Collapsible.Trigger>
				<Collapsible.Content class="pt-4">
					<Field.Group>
						<div class="grid gap-3 sm:grid-cols-2">
							<Field.Field>
								<Field.Label>Help text</Field.Label>
								<Input bind:value={fieldDescription} placeholder="Explain what to enter" />
							</Field.Field>
							<Field.Field>
								<Field.Label>Placeholder</Field.Label>
								<Input bind:value={fieldPlaceholder} placeholder="Example value" />
							</Field.Field>
						</div>

						<div class="flex flex-col gap-3">
							<div>
								<p class="text-sm font-medium">Validation</p>
								<p class="text-xs text-muted-foreground">Optional limits are enforced in forms, imports, and agent calls.</p>
							</div>
							{#if supportsNumberRange}
								<div class="grid gap-3 sm:grid-cols-2">
									<Field.Field><Field.Label>Minimum</Field.Label><Input type="number" bind:value={fieldValidationMin} /></Field.Field>
									<Field.Field><Field.Label>Maximum</Field.Label><Input type="number" bind:value={fieldValidationMax} /></Field.Field>
								</div>
							{:else if supportsTextRules}
								<div class="grid gap-3 sm:grid-cols-2">
									<Field.Field><Field.Label>Minimum length</Field.Label><Input type="number" min="0" bind:value={fieldValidationMinLength} /></Field.Field>
									<Field.Field><Field.Label>Maximum length</Field.Label><Input type="number" min="1" bind:value={fieldValidationMaxLength} /></Field.Field>
								</div>
								<Field.Field>
									<Field.Label>Pattern</Field.Label>
									<Input bind:value={fieldValidationPattern} placeholder="Optional regular expression" />
								</Field.Field>
							{/if}
							<Field.Field>
								<Field.Label>Custom error</Field.Label>
								<Input bind:value={fieldValidationMessage} placeholder="Use the generated message" />
							</Field.Field>
						</div>

						<div class="flex flex-col gap-3">
							<div>
								<p class="text-sm font-medium">Conditional behavior</p>
								<p class="text-xs text-muted-foreground">React to answers elsewhere in the same form.</p>
							</div>
							<FieldConditionControl bind:value={fieldVisibleWhen} fields={type.fields} currentKey={editing?.key ?? fieldKey} title="Show conditionally" description="Hide this field until another answer matches." />
							{#if fieldVisibleWhen}
								<Field.Field orientation="horizontal">
									<Switch checked={fieldHiddenValue === "clear"} onCheckedChange={(checked) => (fieldHiddenValue = checked ? "clear" : "preserve")} />
									<div><Field.Label>Clear hidden answers</Field.Label><Field.Description>Otherwise a hidden answer is preserved.</Field.Description></div>
								</Field.Field>
							{/if}
							<FieldConditionControl bind:value={fieldEnabledWhen} fields={type.fields} currentKey={editing?.key ?? fieldKey} title="Enable conditionally" description="Show the field read-only until another answer matches." />
							<FieldConditionControl bind:value={fieldRequiredWhen} fields={type.fields} currentKey={editing?.key ?? fieldKey} title="Require conditionally" description="Make an answer mandatory only when another answer matches." />
						</div>

						<Field.Field>
							<Field.Label>Key</Field.Label>
							<Input bind:value={fieldKey} placeholder={slugify(fieldLabel) || "due_date"} />
							<Field.Description>Used in the spec. Leave blank to generate from the name.</Field.Description>
						</Field.Field>
					</Field.Group>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
		<Sheet.Footer class="flex-row justify-end">
			{#if editing}
				<Button
					variant="ghost"
					onclick={() => {
						removeKey = editing?.key ?? null;
						sheetOpen = false;
					}}
				>
					Remove
				</Button>
			{/if}
			<Button onclick={saveField} disabled={!canSave || fieldPending}>
				{#if fieldPending}<Spinner data-icon="inline-start" />{/if}
				{editing ? "Save field" : "Add field"}
			</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>

<AlertDialog.Root open={Boolean(removeKey)} onOpenChange={(open) => !open && (removeKey = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Remove {removing?.label ?? "this field"}?</AlertDialog.Title>
			<AlertDialog.Description>
				Stored values in this column will be dropped. This cannot be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={remove}>Remove</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={renameTypeOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Rename the technical key?</AlertDialog.Title>
			<AlertDialog.Description>
				This changes <span class="font-mono">{type.key}</span> to
				<span class="font-mono">{slugify(technicalKey)}</span>, renames its runtime storage, and updates
				direct references. Names you explicitly gave views, forms, pages, and rules stay unchanged.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel disabled={typeKeyPending}>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action disabled={typeKeyPending} onclick={renameTechnicalKey}>
				{#if typeKeyPending}<Spinner data-icon="inline-start" />{/if}
				Rename key
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {type.label}?</AlertDialog.Title>
			<AlertDialog.Description>
				The type, its lists, and its forms go. Records stored as {type.label.toLowerCase()} are dropped.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action variant="destructive" onclick={removeType}>Delete</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
