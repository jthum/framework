<script lang="ts">
	import OptionSelect from "./option-select.svelte";
	import FieldConditionControl from "./field-condition-control.svelte";
	import StatusPill from "./status-pill.svelte";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Collapsible from "@jthum/framework/svelte/ui/collapsible";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Separator } from "@jthum/framework/svelte/ui/separator";
	import * as Sheet from "@jthum/framework/svelte/ui/sheet";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import * as ToggleGroup from "@jthum/framework/svelte/ui/toggle-group";
	import { fieldKindHint, fieldKindLabel } from "./editor-labels.js";
	import { slugify, uniqueKey } from "./editor-data.js";
	import {
		FIELD_KINDS,
		cloneData,
		fieldCapability,
		type FieldCondition,
		type FieldDraft,
		type FieldFormat,
		type FieldKind,
		type FieldPresentation,
		type CollectionDraft,
		type ValueSemantic,
		VALUE_SEMANTICS,
	} from "./authoring.js";
	import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
	import XIcon from "@lucide/svelte/icons/x";
	import { untrack } from "svelte";
	import { toast } from "svelte-sonner";

	let {
		open = $bindable(false),
		input = null,
		inputs,
		types,
		onSave,
		onRemove,
	}: {
		open?: boolean;
		input?: FieldDraft | null;
		inputs: FieldDraft[];
		types: CollectionDraft[];
		onSave: (draft: Partial<FieldDraft> & { key: string }) => void;
		onRemove: (input: FieldDraft) => void;
	} = $props();

	let initialized = $state("");
	let label = $state("");
	let key = $state("");
	let kind = $state<FieldKind>("text");
	let required = $state(false);
	let description = $state("");
	let placeholder = $state("");
	let format = $state<"" | FieldFormat>("");
	let presentation = $state<"" | FieldPresentation>("");
	let currency = $state("USD");
	let target = $state("");
	let choices = $state<string[]>([]);
	let valueSemantics = $state<Record<string, ValueSemantic>>({});
	let choice = $state("");
	let ratingMax = $state("10");
	let validationMin = $state("");
	let validationMax = $state("");
	let validationMinLength = $state("");
	let validationMaxLength = $state("");
	let validationPattern = $state("");
	let validationMessage = $state("");
	let visibleWhen = $state<FieldCondition | undefined>();
	let enabledWhen = $state<FieldCondition | undefined>();
	let requiredWhen = $state<FieldCondition | undefined>();
	let hiddenValue = $state<"preserve" | "clear">("preserve");
	let advanced = $state(false);

	$effect(() => {
		if (!open) return;
		const identity = input?.id ?? "new";
		if (initialized === identity) return;
		initialized = identity;
		untrack(() => {
			label = input?.label ?? "";
			key = input?.key ?? "";
			kind = input?.type ?? "text";
			required = Boolean(input?.required);
			description = input?.description ?? "";
			placeholder = input?.placeholder ?? "";
			format = input?.format ?? "";
			presentation = input?.presentation ?? "";
			currency = input?.currency ?? "USD";
			target = input?.target ?? types[0]?.key ?? "";
			choices = [...(input?.values ?? [])];
			valueSemantics = { ...input?.value_semantics };
			choice = "";
			ratingMax = String(input?.max ?? 10);
			validationMin = valueString(input?.validation?.min);
			validationMax = valueString(input?.validation?.max);
			validationMinLength = valueString(input?.validation?.min_length);
			validationMaxLength = valueString(input?.validation?.max_length);
			validationPattern = input?.validation?.pattern ?? "";
			validationMessage = input?.validation?.message ?? "";
			visibleWhen = input?.visible_when ? cloneData(input.visible_when) : undefined;
			enabledWhen = input?.enabled_when ? cloneData(input.enabled_when) : undefined;
			requiredWhen = input?.required_when ? cloneData(input.required_when) : undefined;
			hiddenValue = input?.hidden_value ?? "preserve";
			advanced = Boolean(
				input?.description ||
					input?.placeholder ||
					input?.validation ||
					input?.visible_when ||
					input?.enabled_when ||
					input?.required_when,
			);
		});
	});

	const capability = $derived(fieldCapability(kind));
	const supportsNumberRange = $derived(capability.validation.includes("min" as never));
	const supportsTextRules = $derived(capability.validation.includes("min_length" as never));
	const formatOptions = $derived([
		{ value: "", label: capability.defaultFormatLabel },
		...capability.formats.map((item) => ({ value: item.value, label: item.label })),
	]);
	const presentationOptions = $derived([
		{ value: "", label: capability.defaultPresentationLabel },
		...capability.presentations.map((item) => ({ value: item.value, label: item.label })),
	]);
	const semanticOptions = VALUE_SEMANTICS.map((value) => ({
		value,
		label: value === "neutral" ? "Normal" : value.charAt(0).toUpperCase() + value.slice(1),
	}));
	const normalizedKey = $derived(slugify(key || label));
	const conflict = $derived(
		Boolean(normalizedKey) && inputs.some((item) => item.key === normalizedKey && item.id !== input?.id),
	);
	const canSave = $derived(
		Boolean(label.trim() && normalizedKey) &&
			!conflict &&
			(kind !== "enum" || choices.length > 0) &&
			(kind !== "reference" || Boolean(target)) &&
			(format !== "currency" || /^[A-Za-z]{3}$/.test(currency.trim())),
	);

	function valueString(value: number | undefined): string {
		return value === undefined ? "" : String(value);
	}
	function optionalNumber(value: string): number | undefined {
		if (!value.trim()) return undefined;
		const number = Number(value);
		return Number.isFinite(number) ? number : undefined;
	}
	function changeKind(next: string) {
		kind = next as FieldKind;
		format = "";
		presentation = "";
		if (kind === "enum" && !choices.length) choices = ["option_one", "option_two"];
	}
	function addChoice() {
		const value = slugify(choice);
		if (value && !choices.includes(value)) {
			choices = [...choices, value];
			valueSemantics = { ...valueSemantics, [value]: "neutral" };
		}
		choice = "";
	}
	function remove() {
		if (!input) return;
		try { onRemove(input); open = false; }
		catch (error) { toast.error(error instanceof Error ? error.message : "Unable to remove field."); }
	}
	function save() {
		if (!canSave) return;
		const resolvedKey = input
			? normalizedKey
			: uniqueKey(normalizedKey, inputs.map((item) => item.key), "input");
		try {
			onSave({
				...(input ? { id: input.id } : {}),
				key: resolvedKey,
				label: label.trim(),
				type: kind,
				required,
				description: description.trim() || undefined,
				placeholder: placeholder.trim() || undefined,
				values: kind === "enum" ? choices : undefined,
				target: kind === "reference" ? target : undefined,
				format:
					(kind === "text" || (kind === "number" && presentation !== "rating")) && format
						? format
						: undefined,
				currency: kind === "number" && format === "currency" ? currency.toUpperCase() : undefined,
				presentation:
					(kind === "text" && presentation === "textarea") ||
					(kind === "number" && presentation === "rating") ||
					(kind === "enum" && presentation === "badge")
						? presentation
						: undefined,
				variant: kind === "number" && presentation === "rating" ? "segments" : undefined,
				max:
					kind === "number" && presentation === "rating"
						? Math.min(10, Math.max(2, Math.round(Number(ratingMax) || 10)))
						: undefined,
				value_semantics:
					kind === "enum" && presentation === "badge"
						? Object.fromEntries(
								choices.map((value) => [value, valueSemantics[value] ?? "neutral"]),
							)
						: undefined,
				validation: {
					min: supportsNumberRange ? optionalNumber(validationMin) : undefined,
					max: supportsNumberRange ? optionalNumber(validationMax) : undefined,
					min_length: supportsTextRules ? optionalNumber(validationMinLength) : undefined,
					max_length: supportsTextRules ? optionalNumber(validationMaxLength) : undefined,
					pattern: supportsTextRules ? validationPattern.trim() || undefined : undefined,
					message: validationMessage.trim() || undefined,
				},
				visible_when: visibleWhen,
				enabled_when: enabledWhen,
				required_when: requiredWhen,
				hidden_value: visibleWhen && hiddenValue === "clear" ? "clear" : undefined,
			});
			open = false;
			initialized = "";
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save input");
		}
	}
</script>

<Sheet.Root bind:open onOpenChange={(next) => !next && (initialized = "")}>
	<Sheet.Content class="sm:max-w-md" side="right">
		<Sheet.Header>
			<Sheet.Title>{input ? "Edit input" : "Add input"}</Sheet.Title>
			<Sheet.Description>Define what this form asks for. The same field rules work everywhere.</Sheet.Description>
		</Sheet.Header>
		<div class="flex flex-col gap-4 overflow-y-auto px-6">
			<Field.Group>
				<Field.Field>
					<Field.Label>Name</Field.Label>
					<Input bind:value={label} placeholder="Email address" />
				</Field.Field>
				<Field.Field>
					<Field.Label>Kind</Field.Label>
					<ToggleGroup.Root
						type="single"
						value={kind}
						onValueChange={(value) => value && changeKind(value)}
						variant="card"
						size="card"
						spacing={2}
						class="grid w-full grid-cols-2"
					>
						{#each FIELD_KINDS as option (option)}
							<ToggleGroup.Item value={option}>
								<span class="mt-0.5 flex size-4 shrink-0 rounded-full border group-data-[state=on]/toggle:border-primary"><span class="m-auto size-2 rounded-full bg-primary opacity-0 group-data-[state=on]/toggle:opacity-100"></span></span>
								<span class="flex min-w-0 flex-col gap-0.5">
									<span>{fieldKindLabel[option]}</span>
									<span class="text-xs font-normal text-muted-foreground">{fieldKindHint[option]}</span>
								</span>
							</ToggleGroup.Item>
						{/each}
					</ToggleGroup.Root>
				</Field.Field>
				{#if kind === "enum"}
					<Field.Field>
						<Field.Label>Choices</Field.Label>
						<div class="flex flex-wrap gap-1.5">
							{#each choices as value (value)}
								<Button type="button" variant="outline" size="xs" onclick={() => (choices = choices.filter((item) => item !== value))}>
									{value.replaceAll("_", " ")} <XIcon data-icon="inline-end" />
								</Button>
							{/each}
						</div>
						<div class="flex gap-2">
							<Input bind:value={choice} placeholder="Add a choice" onkeydown={(event) => event.key === "Enter" && (event.preventDefault(), addChoice())} />
							<Button type="button" variant="outline" onclick={addChoice}>Add</Button>
						</div>
					</Field.Field>
				{/if}
				{#if kind === "reference"}
					<Field.Field>
						<Field.Label>Links to</Field.Label>
						<OptionSelect bind:value={target} options={types.map((type) => ({ value: type.key, label: type.label }))} placeholder="Select a record type" />
					</Field.Field>
				{/if}
				{#if capability.presentations.length}
					<Field.Field>
						<Field.Label>Presentation</Field.Label>
						<OptionSelect bind:value={presentation} options={presentationOptions} />
					</Field.Field>
				{/if}
				{#if capability.formats.length}
					<Field.Field>
						<Field.Label>Format</Field.Label>
						<OptionSelect bind:value={format} options={formatOptions} />
					</Field.Field>
				{/if}
				{#if format === "currency"}
					<Field.Field><Field.Label>Currency code</Field.Label><Input maxlength={3} class="uppercase" bind:value={currency} /></Field.Field>
				{/if}
				{#if presentation === "rating"}
					<Field.Field><Field.Label>Highest rating</Field.Label><Input type="number" min="2" max="10" bind:value={ratingMax} /></Field.Field>
				{/if}
				{#if kind === "enum" && presentation === "badge"}
					<Field.Field>
						<Field.Label>Badge meaning</Field.Label>
						<div class="flex flex-col gap-2">
							{#each choices as value (value)}
								<div class="grid grid-cols-[minmax(0,1fr)_9rem] items-center gap-3 rounded-xl border p-2">
									<StatusPill path={normalizedKey || "choice"} {value} tone={valueSemantics[value] ?? "neutral"} />
									<OptionSelect value={valueSemantics[value] ?? "neutral"} options={semanticOptions} onValueChange={(semantic) => (valueSemantics = { ...valueSemantics, [value]: semantic as ValueSemantic })} />
								</div>
							{/each}
						</div>
					</Field.Field>
				{/if}
				<Field.Field orientation="horizontal">
					<Switch bind:checked={required} id="form-input-required" />
					<Field.Label for="form-input-required">Required</Field.Label>
				</Field.Field>
			</Field.Group>
			<Separator />
			<Collapsible.Root bind:open={advanced}>
				<Collapsible.Trigger class="flex w-full items-center justify-between text-sm font-medium text-muted-foreground hover:text-foreground">
					Advanced <ChevronDownIcon class="transition-transform {advanced ? 'rotate-180' : ''}" />
				</Collapsible.Trigger>
				<Collapsible.Content class="pt-4">
					<Field.Group>
						<Field.Field><Field.Label>Help text</Field.Label><Input bind:value={description} /></Field.Field>
						<Field.Field><Field.Label>Placeholder</Field.Label><Input bind:value={placeholder} /></Field.Field>
						{#if supportsNumberRange}
							<Field.Field><Field.Label>Minimum</Field.Label><Input type="number" bind:value={validationMin} /></Field.Field>
							<Field.Field><Field.Label>Maximum</Field.Label><Input type="number" bind:value={validationMax} /></Field.Field>
						{:else if supportsTextRules}
							<Field.Field><Field.Label>Minimum length</Field.Label><Input type="number" min="0" bind:value={validationMinLength} /></Field.Field>
							<Field.Field><Field.Label>Maximum length</Field.Label><Input type="number" min="1" bind:value={validationMaxLength} /></Field.Field>
							<Field.Field><Field.Label>Pattern</Field.Label><Input bind:value={validationPattern} placeholder="Optional regular expression" /></Field.Field>
						{/if}
						<Field.Field><Field.Label>Custom error</Field.Label><Input bind:value={validationMessage} /></Field.Field>
						<FieldConditionControl bind:value={visibleWhen} fields={inputs} currentKey={input?.key ?? normalizedKey} title="Show conditionally" description="Hide this input until another answer matches." />
						{#if visibleWhen}
							<Field.Field orientation="horizontal"><Switch checked={hiddenValue === "clear"} onCheckedChange={(checked) => (hiddenValue = checked ? "clear" : "preserve")} /><div><Field.Label>Clear hidden answers</Field.Label><Field.Description>Otherwise the answer is preserved.</Field.Description></div></Field.Field>
						{/if}
						<FieldConditionControl bind:value={enabledWhen} fields={inputs} currentKey={input?.key ?? normalizedKey} title="Enable conditionally" description="Keep this input read-only until another answer matches." />
						<FieldConditionControl bind:value={requiredWhen} fields={inputs} currentKey={input?.key ?? normalizedKey} title="Require conditionally" description="Require an answer only when another answer matches." />
						<Field.Field data-invalid={conflict}>
							<Field.Label>Key</Field.Label>
							<Input bind:value={key} placeholder={slugify(label) || "email"} aria-invalid={conflict} />
							<Field.Description>{conflict ? "That key is already used." : "Stable name used in submissions and workflows."}</Field.Description>
						</Field.Field>
					</Field.Group>
				</Collapsible.Content>
			</Collapsible.Root>
		</div>
		<Sheet.Footer class="flex-row justify-end">
			{#if input}<Button variant="ghost" onclick={remove}>Remove</Button>{/if}
			<Button onclick={save} disabled={!canSave}>{input ? "Save input" : "Add input"}</Button>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
