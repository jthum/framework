<script lang="ts">
	import OptionSelect from "./option-select.svelte";
	import { Button } from "../ui/button/index.ts";
	import * as Field from "../ui/field/index.ts";
	import { Input } from "../ui/input/index.ts";
	import * as Sheet from "../ui/sheet/index.ts";
	import { Switch } from "../ui/switch/index.ts";
	import { Textarea } from "../ui/textarea/index.ts";
	import type { PageBlockNode, SpecMeta } from "../../spec/model.ts";
	import type { BlockDefinition, BlockInputDefinition } from "../../blocks/model.ts";
	import { untrack } from "svelte";

	let {
		open = $bindable(false),
		node = null,
		definition,
		inputs,
		getOptions = (input) => input.options ?? [],
		onSave,
	}: {
		open?: boolean;
		node?: PageBlockNode | null;
		definition?: BlockDefinition;
		inputs?: readonly BlockInputDefinition[];
		getOptions?: (input: BlockInputDefinition, config: SpecMeta) => readonly { value: string; label: string }[];
		onSave: (config: SpecMeta) => void | Promise<void>;
	} = $props();

	const def = $derived(definition);
	let config = $state<SpecMeta>({});
	let pending = $state(false);
	let error = $state("");
	let initializedNode = "";

	$effect(() => {
		if (!open) { initializedNode = ""; return; }
		const identity = node?.id ?? "";
		if (initializedNode === identity) return;
		initializedNode = identity;
		untrack(() => {
			config = node ? JSON.parse(JSON.stringify(node.config ?? {})) as SpecMeta : {};
			error = "";
		});
	});

	async function submit(event: Event) {
		event.preventDefault();
		if (pending) return;
		pending = true;
		error = "";
		try {
			await onSave(JSON.parse(JSON.stringify(config)) as SpecMeta);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : "Couldn't save the block";
		} finally {
			pending = false;
		}
	}
</script>

<Sheet.Root bind:open>
	<Sheet.Content class="sm:max-w-md" side="right">
		<form class="flex h-full min-h-0 flex-col" onsubmit={submit}>
			<Sheet.Header>
				<Sheet.Title>{def?.label ?? "Block"}</Sheet.Title>
				<Sheet.Description>
					{def?.description ?? "Configure this block."}
				</Sheet.Description>
			</Sheet.Header>
			<div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6">
				<Field.Group>
					{#each inputs ?? def?.inputs ?? [] as input (input.key)}
						{#if input.type === "boolean"}
							<Field.Field orientation="horizontal">
								<Switch
									checked={Boolean(config[input.key])}
									onCheckedChange={(checked) => (config[input.key] = checked)}
								/>
								<Field.Label>{input.label}</Field.Label>
							</Field.Field>
						{:else}
							<Field.Field>
								<Field.Label>{input.label}</Field.Label>
								{#if input.type === "textarea"}
									<Textarea bind:value={config[input.key] as string} />
								{:else if input.type === "number"}
									<Input
										type="number"
										value={Number(config[input.key] ?? input.default ?? 0)}
										oninput={(event) => (config[input.key] = event.currentTarget.valueAsNumber)}
									/>
								{:else if input.type === "view"}
									<OptionSelect
										bind:value={config[input.key] as string}
										options={getOptions(input, config)}
										placeholder="Select a view"
									/>
								{:else if input.type === "form"}
									<OptionSelect
										bind:value={config[input.key] as string}
										options={getOptions(input, config)}
										placeholder="Select a form"
									/>
								{:else if input.type === "rule"}
									<OptionSelect
										bind:value={config[input.key] as string}
										options={getOptions(input, config)}
										placeholder="Select a rule"
									/>
								{:else if input.type === "field"}
									<OptionSelect
										bind:value={config[input.key] as string}
										options={getOptions(input, config)}
										placeholder="Select a field"
									/>
								{:else if input.type === "select"}
									<OptionSelect
										bind:value={config[input.key] as string}
										options={getOptions(input, config)}
										placeholder="Select"
									/>
								{:else}
									<Input
										bind:value={config[input.key] as string}
										data-testid={input.key === "title" ? "block-title" : "block-field"}
									/>
								{/if}
								{#if input.description}
									<Field.Description>{input.description}</Field.Description>
								{/if}
							</Field.Field>
						{/if}
					{/each}
				</Field.Group>
				{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			</div>
			<Sheet.Footer class="flex-row justify-end">
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={pending}>Save</Button>
			</Sheet.Footer>
		</form>
	</Sheet.Content>
</Sheet.Root>
