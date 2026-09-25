<script lang="ts">
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import OptionSelect from "../ui/option-select/option-select.svelte";
	import AutomationValueInput, { type AutomationReferenceOption } from "./automation-value-input.svelte";
	import type { AutomationSelection, AutomationValue } from "./rule-model.js";

	let {
		selection,
		references,
		onApply,
		onClear,
		onCancel,
	}: {
		selection?: AutomationSelection;
		references: AutomationReferenceOption[];
		onApply: (selection: AutomationSelection) => void;
		onClear: () => void;
		onCancel: () => void;
	} = $props();

	let source = $state<AutomationValue>("");
	let path = $state("");
	let operator = $state<"eq" | "ne">("eq");
	let comparison = $state<AutomationValue>("");
	$effect(() => {
		source = selection?.$select.from ?? "";
		path = selection?.$select.where.path ?? "";
		operator = selection?.$select.where.op ?? "eq";
		comparison = selection?.$select.where.value ?? "";
	});
	const validSource = $derived(
		Array.isArray(source) ||
		(source !== null && typeof source === "object" && (
			("$ref" in source && typeof source.$ref === "string" && source.$ref.trim().length > 0) ||
			"$select" in source
		)),
	);

	function apply() {
		if (!validSource) return;
		onApply({
			$select: {
				from: source,
				where: {
					...(path.trim() ? { path: path.trim() } : {}),
					op: operator,
					value: comparison,
				},
			},
		});
	}
</script>

<div class="flex w-80 flex-col gap-4 p-4 sm:w-96">
	<div>
		<p class="text-sm font-semibold">Select items from a list</p>
		<p class="text-xs text-muted-foreground">Keep items whose value matches another value.</p>
	</div>
	<Field.Group class="gap-3">
		<Field.Field>
			<Field.Label>List</Field.Label>
			<AutomationValueInput value={source} onValueChange={(value) => (source = value)} {references} enableSelection={false} placeholder="=vars.responses" />
			<Field.Description>Choose a list from an earlier step, or enter a JSON array.</Field.Description>
		</Field.Field>
		<Field.Field>
			<Field.Label>Item field</Field.Label>
			<Input bind:value={path} placeholder="actor (optional)" />
			<Field.Description>Leave blank to compare the entire item. Use dots for nested fields.</Field.Description>
		</Field.Field>
		<Field.Field>
			<Field.Label>Comparison</Field.Label>
			<OptionSelect bind:value={operator} options={[{ value: "eq", label: "Equals" }, { value: "ne", label: "Does not equal" }]} />
		</Field.Field>
		<Field.Field>
			<Field.Label>Value</Field.Label>
			<AutomationValueInput value={comparison} onValueChange={(value) => (comparison = value)} {references} enableSelection={false} placeholder="=vars.reviewer" />
		</Field.Field>
	</Field.Group>
	<div class="flex justify-end gap-2">
		{#if selection}<Button type="button" variant="ghost" size="sm" class="mr-auto" onclick={onClear}>Remove selection</Button>{/if}
		<Button type="button" variant="ghost" size="sm" onclick={onCancel}>Cancel</Button>
		<Button type="button" size="sm" disabled={!validSource} onclick={apply}>Use selection</Button>
	</div>
</div>
