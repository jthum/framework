<script lang="ts">
	import OptionSelect from "./option-select.svelte";
	import AutomationPredicateEditor from "./automation-predicate-editor.svelte";
	import AutomationValueInput, { type AutomationReferenceOption } from "./automation-value-input.svelte";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { labelFromKey } from "./editor-data.js";
	import type { AutomationCondition, AutomationPredicate, AutomationValue } from "./rule-model.js";
	import type { FieldDraft, CollectionDraft } from "./authoring.js";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import SplitIcon from "@lucide/svelte/icons/split";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";

	let {
		predicate,
		inputName,
		type,
		fields,
		inputLabel,
		compact = false,
		onPredicateChange,
		references = [],
	}: {
		predicate: AutomationPredicate;
		inputName: string;
		type?: CollectionDraft;
		fields?: FieldDraft[];
		inputLabel?: string;
		compact?: boolean;
		onPredicateChange?: (predicate: AutomationPredicate) => void;
		references?: AutomationReferenceOption[];
	} = $props();

	type PredicateKind = "condition" | "all" | "any" | "not";

	const kind = $derived(predicateKind(predicate));
	const condition = $derived(kind === "condition" ? (predicate as AutomationCondition) : undefined);
	const conditionOperator = $derived(operatorFromCondition(condition));
	const conditionValue = $derived(
		conditionOperator === "in" && Array.isArray(condition?.values)
			? condition.values.join(", ")
			: String(condition?.value ?? ""),
	);
	const conditionPath = $derived(typeof condition?.path === "string" ? condition.path : "");
	const fieldKey = $derived(conditionPath.split(".").at(-1) ?? "");
	const availableFields = $derived(fields ?? type?.fields ?? []);
	const field = $derived(availableFields.find((item) => item.key === fieldKey));
	const referenceOptions = $derived([
		...new Map(
			[
				{ value: "meta.now", label: "Current date and time", group: "Runtime" },
				{ value: "actor.id", label: "Current actor ID", group: "Runtime" },
				{ value: `vars.${inputName}`, label: inputLabel ?? type?.label ?? "Current record", group: fields ? "Submission" : "Current record" },
				...availableFields.map((item) => ({ value: `vars.${inputName}.${item.key}`, label: item.label, group: fields ? "Submission" : "Current record" })),
				...references,
			].map((option) => [option.value, option] as const),
		).values(),
	]);
	const children = $derived(
		kind === "all"
			? (predicate as { all: AutomationPredicate[] }).all
			: kind === "any"
				? (predicate as { any: AutomationPredicate[] }).any
				: [],
	);

	const operators = [
		{ value: "equals", label: "is" },
		{ value: "not_equals", label: "is not" },
		{ value: "filled", label: "has a value" },
		{ value: "empty", label: "is empty" },
		{ value: "contains", label: "contains" },
		{ value: "in", label: "is one of" },
		{ value: "gt", label: "is greater than" },
		{ value: "gte", label: "is at least" },
		{ value: "lt", label: "is less than" },
		{ value: "lte", label: "is at most" },
	];

	function update(next: AutomationPredicate) {
		predicate = next;
		onPredicateChange?.(next);
	}

	function predicateKind(value: AutomationPredicate): PredicateKind {
		if ("all" in value) return "all";
		if ("any" in value) return "any";
		if ("not" in value) return "not";
		return "condition";
	}

	function operatorFromCondition(value?: AutomationCondition): string {
		if (!value) return "equals";
		if (value.op === "context.compare") return String(value.operator ?? "gt");
		return value.op.replace("context.", "");
	}

	function simpleCondition(field = availableFields[0]?.key ?? "id"): AutomationPredicate {
		return { op: "context.equals", path: `vars.${inputName}.${field}`, value: "" };
	}

	function setKind(next: string) {
		if (next === kind) return;
		if (next === "all") update({ all: [simpleCondition()] });
		else if (next === "any") update({ any: [simpleCondition()] });
		else if (next === "not") update({ not: simpleCondition() });
		else update(simpleCondition());
	}

	function setField(next: string) {
		if (!condition) return;
		update({ ...condition, path: `vars.${inputName}.${next}` });
	}

	function setOperator(next: string) {
		if (!condition) return;
		const path = condition.path ?? `vars.${inputName}.${availableFields[0]?.key ?? "id"}`;
		if (["filled", "empty"].includes(next)) {
			update({ op: `context.${next}`, path } as AutomationCondition);
			return;
		}
		if (["gt", "gte", "lt", "lte"].includes(next)) {
			update({ op: "context.compare", path, operator: next, value: condition.value ?? "" });
			return;
		}
		if (next === "in") {
			update({
				op: "context.in",
				path,
				values: Array.isArray(condition.values)
					? condition.values
					: condition.value === undefined
						? []
						: [condition.value],
			});
			return;
		}
		update({
			op: `context.${next}`,
			path,
			value: condition.value ?? "",
		} as AutomationCondition);
	}

	function setValue(raw: string) {
		if (!condition) return;
		if (conditionOperator === "in") {
			update({ ...condition, values: raw.split(",").map((item) => item.trim()).filter(Boolean) });
			return;
		}
		let value: string | number | boolean = raw;
		if (field?.type === "number" && raw.trim() && Number.isFinite(Number(raw))) value = Number(raw);
		if (field?.type === "boolean") value = raw === "true";
		update({ ...condition, value });
	}

	function setAutomationValue(value: AutomationValue) {
		if (!condition) return;
		update({ ...condition, value });
	}

	function isBinding(value: AutomationValue | undefined): value is { $ref: string } {
		return value !== null && typeof value === "object" && !Array.isArray(value) && "$ref" in value;
	}

	function replaceChild(index: number, next: AutomationPredicate) {
		const nextChildren = children.map((item, itemIndex) => (itemIndex === index ? next : item));
		update(kind === "all" ? { all: nextChildren } : { any: nextChildren });
	}

	function removeChild(index: number) {
		const nextChildren = children.filter((_, itemIndex) => itemIndex !== index);
		update(kind === "all" ? { all: nextChildren } : { any: nextChildren });
	}

	function addChild(child: AutomationPredicate = simpleCondition()) {
		const nextChildren = [...children, child];
		update(kind === "all" ? { all: nextChildren } : { any: nextChildren });
	}

	function combineWith(next: "all" | "any") {
		update({ [next]: [predicate, simpleCondition()] } as AutomationPredicate);
	}
</script>

<Card.Root size="sm">
	<Card.Header class="flex flex-row items-center gap-2">
		<div class="w-full max-w-36">
			<OptionSelect
				value={kind}
				onValueChange={setKind}
				options={[
					{ value: "condition", label: "Condition" },
					{ value: "all", label: "All of" },
					{ value: "any", label: "Any of" },
					{ value: "not", label: "Not" },
				]}
			/>
		</div>
		<p class="text-xs text-muted-foreground">
			{kind === "all" ? "Every item must match" : kind === "any" ? "At least one item must match" : kind === "not" ? "Invert this requirement" : "Match one requirement"}
		</p>
	</Card.Header>

	<Card.Content class="flex min-w-0 flex-col gap-3">
		{#if kind === "condition" && condition}
			<div class="grid min-w-0 gap-2 sm:grid-cols-2">
				<OptionSelect
					value={fieldKey}
					onValueChange={setField}
					options={[
						...availableFields.map((item) => ({ value: item.key, label: item.label })),
						...(availableFields.some((item) => item.key === fieldKey) || !fieldKey
							? []
							: [{ value: fieldKey, label: labelFromKey(fieldKey) }]),
					]}
					placeholder="Field"
				/>
				<OptionSelect
					value={conditionOperator}
					onValueChange={setOperator}
					options={[
						...operators,
						...(operators.some((item) => item.value === conditionOperator)
							? []
							: [{ value: conditionOperator, label: labelFromKey(condition.op) }]),
					]}
				/>
			</div>
		{/if}

		{#if kind === "condition" && condition && !["filled", "empty"].includes(conditionOperator)}
			{#if isBinding(condition.value)}
				<AutomationValueInput value={condition.value} onValueChange={setAutomationValue} references={referenceOptions} type={field?.type} placeholder="Value" />
			{:else if conditionOperator === "in"}
				<Input value={conditionValue} oninput={(event) => setValue(event.currentTarget.value)} placeholder="Comma-separated values" />
			{:else if field?.type === "enum"}
				<OptionSelect
					value={conditionValue}
					onValueChange={setValue}
					options={(field.values ?? []).map((value) => ({ value, label: labelFromKey(value) }))}
					placeholder="Value"
				/>
			{:else if field?.type === "boolean"}
				<OptionSelect
					value={conditionValue}
					onValueChange={setValue}
					options={[
						{ value: "true", label: "Yes" },
						{ value: "false", label: "No" },
					]}
				/>
			{:else}
				<AutomationValueInput value={condition.value ?? ""} onValueChange={setAutomationValue} references={referenceOptions} type={field?.type} placeholder="Value" />
			{/if}
		{:else if kind === "all" || kind === "any"}
			<div class="flex flex-col">
				{#each children as child, index (index)}
					{#if index > 0}
						<div class="flex h-7 items-center gap-2 pl-3" aria-hidden="true">
							<div class="h-full w-px bg-border"></div>
							<span class="rounded-full border bg-background px-2 py-0.5 text-[10px] font-semibold tracking-wide text-muted-foreground">
								{kind === "all" ? "AND" : "OR"}
							</span>
						</div>
					{/if}
					<div class="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-1">
						<div class="min-w-0">
							<AutomationPredicateEditor
								predicate={child}
								onPredicateChange={(next) => replaceChild(index, next)}
								{inputName}
								{type}
								{fields}
								{inputLabel}
								{references}
								compact
							/>
						</div>
						<Button size="icon-xs" variant="ghost" aria-label="Remove condition" disabled={children.length === 1} onclick={() => removeChild(index)}>
							<Trash2Icon />
						</Button>
					</div>
				{/each}
				<div class="mt-3 flex flex-wrap gap-2">
					<Button size="sm" variant="outline" onclick={() => addChild()}>
						<PlusIcon data-icon="inline-start" /> Add condition
					</Button>
					<Button size="sm" variant="ghost" onclick={() => addChild({ all: [simpleCondition()] })}>
						<SplitIcon data-icon="inline-start" /> Add group
					</Button>
				</div>
			</div>
		{:else if kind === "not"}
			<div class="flex min-w-0 flex-col gap-2">
				<p class="text-xs font-medium text-muted-foreground">The following must not be true</p>
				<AutomationPredicateEditor
					predicate={(predicate as { not: AutomationPredicate }).not}
					onPredicateChange={(next) => update({ not: next })}
					{inputName}
					{type}
					{fields}
					{inputLabel}
					{references}
					compact
				/>
			</div>
		{/if}

		{#if kind === "condition" && !compact}
			<div class="flex flex-wrap items-center gap-1.5 border-t pt-3">
				<span class="mr-1 text-xs text-muted-foreground">Add another requirement</span>
				<Button size="xs" variant="outline" onclick={() => combineWith("all")}>
					<PlusIcon data-icon="inline-start" /> And
				</Button>
				<Button size="xs" variant="outline" onclick={() => combineWith("any")}>
					<PlusIcon data-icon="inline-start" /> Or
				</Button>
			</div>
		{/if}
	</Card.Content>
</Card.Root>
