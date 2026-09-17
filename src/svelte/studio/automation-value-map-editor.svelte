<script lang="ts">
	import OptionSelect from "./option-select.svelte";
	import AutomationValueInput, { type AutomationReferenceOption } from "./automation-value-input.svelte";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import type { AutomationValue } from "./rule-model.js";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";

	let {
		values,
		onValuesChange,
		keys = [],
		keyPlaceholder = "Name",
		valuePlaceholder = "Value or =vars.path",
		references = [],
	}: {
		values: Record<string, AutomationValue>;
		onValuesChange: (values: Record<string, AutomationValue>) => void;
		keys?: Array<{ value: string; label: string; type?: string; values?: string[] }>;
		keyPlaceholder?: string;
		valuePlaceholder?: string;
		references?: AutomationReferenceOption[];
	} = $props();

	function replaceKey(oldKey: string, nextKey: string) {
		const next = { ...values };
		const value = next[oldKey] ?? "";
		delete next[oldKey];
		if (nextKey) next[nextKey] = value;
		onValuesChange(next);
	}

	function replaceValue(key: string, value: AutomationValue) {
		onValuesChange({ ...values, [key]: value });
	}

	function remove(key: string) {
		const next = { ...values };
		delete next[key];
		onValuesChange(next);
	}

	function add() {
		const available = keys.find((item) => !Object.hasOwn(values, item.value))?.value;
		let key = available ?? "value";
		let suffix = 2;
		while (Object.hasOwn(values, key)) key = `value_${suffix++}`;
		onValuesChange({ ...values, [key]: "" });
	}

</script>

<div class="flex min-w-0 flex-col gap-2">
	{#each Object.entries(values) as [key, value], index (index)}
		{@const keyDefinition = keys.find((item) => item.value === key)}
		<div class="grid min-w-0 grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)_auto] items-center gap-2">
			{#if keys.length}
				<OptionSelect
					value={key}
					onValueChange={(next) => replaceKey(key, next)}
					options={[
						...keys,
						...(keys.some((item) => item.value === key) ? [] : [{ value: key, label: key }]),
					]}
					placeholder={keyPlaceholder}
				/>
			{:else}
				<Input value={key} oninput={(event) => replaceKey(key, event.currentTarget.value)} placeholder={keyPlaceholder} />
			{/if}
			{#if keyDefinition?.type === "enum"}
				<OptionSelect
					value={String(value ?? "")}
					onValueChange={(next) => replaceValue(key, next)}
					options={(keyDefinition.values ?? []).map((item) => ({ value: item, label: item }))}
				/>
			{:else if keyDefinition?.type === "boolean"}
				<OptionSelect
					value={String(value ?? "")}
					onValueChange={(next) => replaceValue(key, next === "true")}
					options={[
						{ value: "true", label: "Yes" },
						{ value: "false", label: "No" },
					]}
				/>
			{:else}
				<AutomationValueInput {value} onValueChange={(next) => replaceValue(key, next)} {references} type={keyDefinition?.type} placeholder={valuePlaceholder} />
			{/if}
			<Button size="icon-xs" variant="ghost" aria-label={`Remove ${key}`} onclick={() => remove(key)}><Trash2Icon /></Button>
		</div>
	{/each}
	<Button variant="ghost" size="sm" class="w-fit" onclick={add}><PlusIcon data-icon="inline-start" /> Add value</Button>
	<p class="text-xs text-muted-foreground">Prefix a context reference with <code>=</code>, for example <code>=vars.invoice.total</code>.</p>
</div>
