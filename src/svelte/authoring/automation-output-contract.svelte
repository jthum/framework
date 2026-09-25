<script lang="ts">
	import type { RuleOutputContract } from "@jthum/framework/spec";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import OptionSelect from "../ui/option-select/option-select.svelte";
	import AutomationOutputContract from "./automation-output-contract.svelte";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";

	let { value, onValueChange, depth = 0 }: {
		value?: RuleOutputContract;
		onValueChange: (value: RuleOutputContract | undefined) => void;
		depth?: number;
	} = $props();
	const kinds = [
		{ value: "", label: "No assertion" },
		{ value: "text", label: "Text" },
		{ value: "number", label: "Number" },
		{ value: "boolean", label: "Boolean" },
		{ value: "null", label: "Null" },
		{ value: "object", label: "Object" },
		{ value: "array", label: "List" },
	];

	function setType(type: string) {
		if (!type) return onValueChange(undefined);
		if (type === value?.type) return;
		onValueChange({ type: type as RuleOutputContract["type"], ...(value?.required ? { required: true } : {}) });
	}

	function setField(name: string, field: RuleOutputContract | undefined) {
		if (!value || value.type !== "object") return;
		const fields = { ...value.fields };
		if (field) fields[name] = field;
		else delete fields[name];
		onValueChange({ ...value, fields });
	}

	function renameField(name: string, next: string) {
		if (!value || value.type !== "object" || !value.fields?.[name] || !next.trim() || (next !== name && value.fields[next])) return;
		const fields = Object.fromEntries(Object.entries(value.fields).map(([key, field]) => [key === name ? next.trim() : key, field]));
		onValueChange({ ...value, fields });
	}

	function addField() {
		if (!value || value.type !== "object") return;
		let name = "field";
		let suffix = 2;
		while (value.fields?.[name]) name = `field_${suffix++}`;
		setField(name, { type: "text" });
	}

	function setItems(items: RuleOutputContract | undefined) {
		if (!value || value.type !== "array") return;
		const { items: _previous, ...rest } = value;
		onValueChange(items ? { ...rest, items } : rest);
	}
</script>

<div class="flex min-w-0 flex-col gap-2">
	<OptionSelect value={value?.type ?? ""} onValueChange={setType} options={kinds} />
	{#if value?.type === "object"}
		<div class="flex flex-col gap-2 border-l pl-3">
			{#each Object.entries(value.fields ?? {}) as [name, field] (name)}
				<div class="flex min-w-0 flex-col gap-2 rounded-lg border p-2">
					<div class="flex items-center gap-2">
						<Input class="min-w-0 flex-1" value={name} aria-label="Output field name" onblur={(event) => renameField(name, event.currentTarget.value)} />
						<label class="flex items-center gap-2 text-xs text-muted-foreground"><Switch checked={field.required ?? false} onCheckedChange={(required) => setField(name, { ...field, required })} />Required</label>
						<Button variant="ghost" size="icon-xs" aria-label={`Remove ${name}`} onclick={() => setField(name, undefined)}><Trash2Icon /></Button>
					</div>
					<AutomationOutputContract value={field} onValueChange={(next) => setField(name, next)} depth={depth + 1} />
				</div>
			{/each}
			<Button variant="ghost" size="sm" class="w-fit" onclick={addField}><PlusIcon data-icon="inline-start" /> Add expected field</Button>
		</div>
	{:else if value?.type === "array"}
		<div class="border-l pl-3">
			<p class="mb-2 text-xs text-muted-foreground">Expected item type (optional)</p>
			<AutomationOutputContract value={value.items} onValueChange={setItems} depth={depth + 1} />
		</div>
	{/if}
	{#if depth === 0}<p class="text-xs text-muted-foreground">Only declared values are checked. Extra object fields remain allowed.</p>{/if}
</div>
