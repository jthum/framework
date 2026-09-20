<script lang="ts">
	import OptionSelect from "../ui/option-select/option-select.svelte";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import type { FieldCondition, FilterClause, FieldDraft, FilterOp } from "./authoring.js";

	let {
		value = $bindable(),
		fields,
		currentKey,
		title,
		description,
	}: {
		value?: FieldCondition;
		fields: FieldDraft[];
		currentKey: string;
		title: string;
		description: string;
	} = $props();

	const choices = $derived(fields.filter((field) => field.key !== currentKey));
	const leaf = $derived(
		value && !("all" in value) && !("any" in value) && !("not" in value)
			? (value as FilterClause)
			: null,
	);
	const source = $derived(choices.find((field) => field.key === leaf?.field));
	const needsValue = $derived(!["empty", "not_empty"].includes(leaf?.op ?? "eq"));
	const operators = $derived.by(() => {
		const common = [
			{ value: "eq", label: "is" },
			{ value: "neq", label: "is not" },
			{ value: "empty", label: "is empty" },
			{ value: "not_empty", label: "is not empty" },
		];
		if (source?.type === "number" || source?.type === "date" || source?.type === "datetime") {
			return [
				...common,
				{ value: "gt", label: "is greater than" },
				{ value: "gte", label: "is at least" },
				{ value: "lt", label: "is less than" },
				{ value: "lte", label: "is at most" },
			];
		}
		return source?.type === "text" ? [...common, { value: "contains", label: "contains" }] : common;
	});

	function setEnabled(enabled: boolean) {
		if (!enabled) {
			value = undefined;
			return;
		}
		const field = choices[0];
		if (field) value = { field: field.key, op: "eq", value: defaultValue(field) };
	}

	function update(patch: Partial<FilterClause>) {
		if (!leaf) return;
		value = { ...leaf, ...patch };
	}

	function setSource(key: string) {
		const field = choices.find((item) => item.key === key);
		if (field) value = { field: key, op: "eq", value: defaultValue(field) };
	}

	function defaultValue(field: FieldDraft): unknown {
		if (field.type === "boolean") return true;
		if (field.type === "enum") return field.values?.[0] ?? "";
		return "";
	}
</script>

<div class="rounded-xl border bg-background p-3">
	<div class="flex items-start justify-between gap-4">
		<div class="min-w-0">
			<p class="text-sm font-medium">{title}</p>
			<p class="text-xs text-muted-foreground">{description}</p>
		</div>
		<Switch
			size="sm"
			checked={Boolean(value)}
			disabled={!choices.length}
			onCheckedChange={(checked) => setEnabled(Boolean(checked))}
		/>
	</div>
	{#if value}
		{#if leaf}
			<div class="mt-3 grid gap-2 sm:grid-cols-3">
				<Field.Field>
					<Field.Label>Field</Field.Label>
					<OptionSelect
						value={leaf.field}
						options={choices.map((field) => ({ value: field.key, label: field.label }))}
						onValueChange={setSource}
					/>
				</Field.Field>
				<Field.Field>
					<Field.Label>Match</Field.Label>
					<OptionSelect
						value={leaf.op ?? "eq"}
						options={operators}
						onValueChange={(op) => update({ op: op as FilterOp })}
					/>
				</Field.Field>
				{#if needsValue}
					<Field.Field>
						<Field.Label>Value</Field.Label>
						{#if source?.type === "enum"}
							<OptionSelect
								value={String(leaf.value ?? "")}
								options={(source.values ?? []).map((item) => ({ value: item, label: item.replaceAll("_", " ") }))}
								onValueChange={(next) => update({ value: next })}
							/>
						{:else if source?.type === "boolean"}
							<OptionSelect
								value={String(leaf.value ?? true)}
								options={[{ value: "true", label: "Yes" }, { value: "false", label: "No" }]}
								onValueChange={(next) => update({ value: next === "true" })}
							/>
						{:else}
							<Input
								type={source?.type === "number" ? "number" : source?.type === "date" ? "date" : source?.type === "datetime" ? "datetime-local" : "text"}
								value={String(leaf.value ?? "")}
								oninput={(event) => update({ value: (event.currentTarget as HTMLInputElement).value })}
							/>
						{/if}
					</Field.Field>
				{/if}
			</div>
		{:else}
			<div class="mt-3"><Badge variant="secondary">Grouped condition configured in the spec</Badge></div>
		{/if}
	{/if}
</div>
