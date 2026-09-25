<script lang="ts" module>
	export interface AutomationReferenceOption {
		value: string;
		label: string;
		group: string;
	}
</script>

<script lang="ts">
	import * as Command from "@jthum/framework/svelte/ui/command";
	import * as InputGroup from "@jthum/framework/svelte/ui/input-group";
	import * as Popover from "@jthum/framework/svelte/ui/popover";
	import AutomationSelectionEditor from "./automation-selection-editor.svelte";
	import type { AutomationSelection, AutomationValue } from "./rule-model.js";
	import BracesIcon from "@lucide/svelte/icons/braces";
	import ListFilterIcon from "@lucide/svelte/icons/list-filter";

	let {
		value,
		onValueChange,
		references = [],
		type,
		placeholder = "Value or reference",
		enableSelection = true,
	}: {
		value: AutomationValue;
		onValueChange: (value: AutomationValue) => void;
		references?: AutomationReferenceOption[];
		type?: string;
		placeholder?: string;
		enableSelection?: boolean;
	} = $props();

	let open = $state(false);
	let selectionOpen = $state(false);
	const canSelect = $derived(enableSelection && (!type || type === "array" || isSelection(value)));
	let search = $state("");
	const needle = $derived(search.trim().toLowerCase());
	const filtered = $derived(
		needle
			? references.filter((option) => `${option.label} ${option.value}`.toLowerCase().includes(needle))
			: references,
	);
	const groups = $derived([...new Set(filtered.map((option) => option.group))]);

	function display(value: AutomationValue): string {
		if (isBinding(value)) return `=${value.$ref}`;
		if (isSelection(value) && canSelect) {
			const { from, where } = value.$select;
			return `Select from ${display(from)} where ${where.path || "item"} ${where.op === "ne" ? "≠" : "="} ${display(where.value)}`;
		}
		if (value !== null && typeof value === "object") return JSON.stringify(value);
		return String(value ?? "");
	}

	function parse(raw: string): AutomationValue {
		if (raw.startsWith("=") && raw.length > 1) return { $ref: raw.slice(1) };
		if (type === "boolean") return raw === "true";
		if (type === "number" && raw.trim() && Number.isFinite(Number(raw))) return Number(raw);
		if (raw.trim().startsWith("{") || raw.trim().startsWith("[")) {
			try {
				return JSON.parse(raw) as AutomationValue;
			} catch {
				return raw;
			}
		}
		return raw;
	}

	function choose(reference: string) {
		onValueChange({ $ref: reference });
		open = false;
	}

	function isBinding(value: AutomationValue): value is { $ref: string } {
		return value !== null && typeof value === "object" && !Array.isArray(value) && "$ref" in value;
	}

	function isSelection(value: AutomationValue): value is AutomationSelection {
		return value !== null && typeof value === "object" && !Array.isArray(value) && "$select" in value;
	}
</script>

<InputGroup.Root>
	<InputGroup.Input value={display(value)} readonly={canSelect && isSelection(value)} oninput={(event) => onValueChange(parse(event.currentTarget.value))} {placeholder} />
	{#if canSelect}
		<InputGroup.Addon align="inline-end">
			<Popover.Root bind:open={selectionOpen}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<InputGroup.Button {...props} size="icon-xs" aria-label={isSelection(value) ? "Edit list selection" : "Select items from a list"}><ListFilterIcon /></InputGroup.Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="end" class="w-auto p-0">
					{#if selectionOpen}
						<AutomationSelectionEditor selection={isSelection(value) ? value : undefined} {references} onApply={(selection) => { onValueChange(selection); selectionOpen = false; }} onClear={() => { onValueChange(""); selectionOpen = false; }} onCancel={() => (selectionOpen = false)} />
					{/if}
				</Popover.Content>
			</Popover.Root>
		</InputGroup.Addon>
	{/if}
	{#if references.length}
		<InputGroup.Addon align="inline-end">
			<Popover.Root bind:open>
				<Popover.Trigger>
					{#snippet child({ props })}
						<InputGroup.Button {...props} size="icon-xs" aria-label="Choose context value"><BracesIcon /></InputGroup.Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content align="end" class="w-80 p-0">
					<Command.Root shouldFilter={false}>
						<Command.Input bind:value={search} placeholder="Search available values…" />
						<Command.List>
							<Command.Empty>No matching values.</Command.Empty>
							{#each groups as group (group)}
								<Command.Group heading={group}>
									{#each filtered.filter((option) => option.group === group) as option (option.value)}
										<Command.Item value={`${option.label} ${option.value}`} onSelect={() => choose(option.value)}>
											<div class="flex min-w-0 flex-col"><span>{option.label}</span><code class="truncate text-xs text-muted-foreground">{option.value}</code></div>
										</Command.Item>
									{/each}
								</Command.Group>
							{/each}
						</Command.List>
					</Command.Root>
				</Popover.Content>
			</Popover.Root>
		</InputGroup.Addon>
	{/if}
</InputGroup.Root>
