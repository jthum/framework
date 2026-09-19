<script lang="ts">
	import type { WorkspaceClient } from "../../client/workspace-client.ts";
	import type { RuntimeAction } from "../../kernel/workspace-config.ts";
	import type { JsonValue } from "../../spec/model.ts";
	import { Button } from "../ui/button/index.js";
	import * as Collapsible from "../ui/collapsible/index.js";
	import * as Field from "../ui/field/index.js";
	import { Input } from "../ui/input/index.js";
	import { Switch } from "../ui/switch/index.js";
	import { Textarea } from "../ui/textarea/index.js";
	import OptionSelect from "./option-select.svelte";

	export type ActionKind = {
		kind: string;
		label: string;
		description: string;
		configFields: readonly { key: string; label: string; placeholder?: string }[];
	};

	let { client, kinds, onChanged }: { client?: WorkspaceClient; kinds: readonly ActionKind[]; onChanged?: () => void } = $props();
	let actions = $state<readonly RuntimeAction[]>([]);
	let selected = $state<string | null>(null);
	let key = $state("");
	let label = $state("");
	let description = $state("");
	let kind = $state("");
	let config = $state<Record<string, string>>({});
	let tool = $state(false);
	let inputSchema = $state('{"type":"object","additionalProperties":true}');
	let advanced = $state(false);
	let testInput = $state("{}");
	let testOutput = $state("");
	let pending = $state(false);
	let error = $state("");
	let loadedClient: WorkspaceClient | undefined;
	const activeKind = $derived(kinds.find((option) => option.kind === kind));

	$effect(() => {
		if (!client || client === loadedClient) return;
		loadedClient = client;
		selected = null;
		actions = [];
		void refresh(client);
	});

	async function refresh(current: WorkspaceClient) {
		try { actions = await current.listRuntimeActions(); }
		catch (cause) { error = message(cause); }
	}

	function edit(action?: RuntimeAction) {
		selected = action?.key ?? "";
		key = action?.key ?? "";
		label = action?.label ?? "";
		description = action?.description ?? "";
		kind = action?.implementation.kind ?? kinds[0]?.kind ?? "";
		config = Object.fromEntries(Object.entries(action?.implementation.config ?? {}).map(([name, value]) => [name, typeof value === "string" ? value : JSON.stringify(value)]));
		tool = Boolean(action?.tool);
		inputSchema = JSON.stringify(action?.input ?? { type: "object", additionalProperties: true }, null, 2);
		advanced = false;
		testOutput = "";
		error = "";
	}

	async function save() {
		if (!client || !key.trim() || !label.trim() || !kind || pending) return;
		pending = true;
		error = "";
		try {
			const input = JSON.parse(inputSchema) as RuntimeAction["input"];
			if (!input || input.type !== "object") throw new Error("Input schema must describe an object.");
			await client.putRuntimeAction({
				key: key.trim(), label: label.trim(), description: description.trim() || `Run ${label.trim()}.`, input,
				implementation: { kind, config },
				...(tool ? { tool: { availability: "discoverable", keywords: [key.trim(), label.trim()] } } : {}),
			});
			await refresh(client);
			onChanged?.();
			selected = null;
		} catch (cause) { error = message(cause); }
		finally { pending = false; }
	}

	async function remove() {
		if (!client || !selected || pending) return;
		pending = true;
		error = "";
		try {
			await client.deleteRuntimeAction(selected);
			await refresh(client);
			onChanged?.();
			selected = null;
		} catch (cause) { error = message(cause); }
		finally { pending = false; }
	}

	async function test(action: RuntimeAction) {
		if (!client || pending) return;
		pending = true;
		error = "";
		testOutput = "";
		try {
			const input = JSON.parse(testInput) as JsonValue;
			if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Test input must be a JSON object.");
			testOutput = JSON.stringify(await client.executeAction(action.key, input as Record<string, JsonValue>), null, 2);
		} catch (cause) { error = message(cause); }
		finally { pending = false; }
	}

	function message(cause: unknown) { return cause instanceof Error ? cause.message : "The Action could not be saved."; }
</script>

<Field.Set>
	<div class="flex items-start justify-between gap-3">
		<div class="flex flex-col gap-1">
			<Field.Legend class="mb-0">Actions</Field.Legend>
			<Field.Description>Reusable operations for Rules, buttons, and agents.</Field.Description>
		</div>
		<Button type="button" size="sm" variant="outline" disabled={!kinds.length} onclick={() => edit()}>Add Action</Button>
	</div>
	{#if actions.length}
		<div class="flex flex-col divide-y rounded-lg border bg-card">
			{#each actions as action (action.key)}
				<div class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="min-w-0"><p class="truncate text-sm font-medium">{action.label}</p><p class="truncate text-xs text-muted-foreground">{action.key} · {action.implementation.kind}{action.tool ? " · Agent tool" : ""}</p></div>
					<div class="flex gap-1"><Button type="button" size="sm" variant="ghost" onclick={() => { edit(action); testInput = "{}"; }}>Edit</Button></div>
				</div>
			{/each}
		</div>
	{:else if selected === null}
		<p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No custom Actions yet. Add one to route a call to an installed provider or another operation.</p>
	{/if}
	{#if selected !== null}
		<Field.Group class="rounded-lg border bg-card p-4">
			<Field.Field><Field.Label for="runtime-action-key">Key</Field.Label><Input id="runtime-action-key" bind:value={key} placeholder="web.search" disabled={selected !== "" || pending} /></Field.Field>
			<Field.Field><Field.Label for="runtime-action-label">Name</Field.Label><Input id="runtime-action-label" bind:value={label} placeholder="Web search" disabled={pending} /></Field.Field>
			<Field.Field><Field.Label for="runtime-action-description">Description</Field.Label><Input id="runtime-action-description" bind:value={description} placeholder="Search with the selected provider" disabled={pending} /></Field.Field>
			<Field.Field><Field.Label for="runtime-action-kind">Implementation</Field.Label><OptionSelect value={kind} options={kinds.map((option) => ({ value: option.kind, label: option.label }))} onValueChange={(next) => { kind = next; config = {}; }} /><Field.Description>{activeKind?.description}</Field.Description></Field.Field>
			{#each activeKind?.configFields ?? [] as field (field.key)}
				<Field.Field><Field.Label for={`runtime-action-${field.key}`}>{field.label}</Field.Label><Input id={`runtime-action-${field.key}`} value={config[field.key] ?? ""} placeholder={field.placeholder} oninput={(event) => config = { ...config, [field.key]: event.currentTarget.value }} disabled={pending} /></Field.Field>
			{/each}
			<Field.Field orientation="horizontal"><Field.Content><Field.Label for="runtime-action-tool">Agent tool</Field.Label><Field.Description>Offer this Action directly to eligible agents.</Field.Description></Field.Content><Switch id="runtime-action-tool" bind:checked={tool} disabled={pending} /></Field.Field>
			<Collapsible.Root bind:open={advanced}>
				<Collapsible.Trigger class="text-sm text-muted-foreground hover:text-foreground">{advanced ? "Hide" : "Show"} advanced input schema</Collapsible.Trigger>
				<Collapsible.Content class="pt-3"><Field.Field><Field.Label for="runtime-action-schema">Input schema</Field.Label><Textarea id="runtime-action-schema" bind:value={inputSchema} rows={4} class="font-mono text-xs" disabled={pending} /><Field.Description>JSON object schema. The default accepts any object input.</Field.Description></Field.Field></Collapsible.Content>
			</Collapsible.Root>
			{#if selected}
				<Field.Field><Field.Label for="runtime-action-test">Test input</Field.Label><Textarea id="runtime-action-test" bind:value={testInput} rows={3} class="font-mono text-xs" disabled={pending} /></Field.Field>
				<Button type="button" size="sm" variant="outline" disabled={pending} onclick={() => { const action = actions.find((item) => item.key === selected); if (action) void test(action); }}>Run test</Button>
				{#if testOutput}<pre class="overflow-auto rounded-lg border bg-muted/40 p-3 text-xs">{testOutput}</pre>{/if}
			{/if}
			{#if error}<Field.Error>{error}</Field.Error>{/if}
			<div class="flex justify-between gap-2">
				{#if selected}<Button type="button" size="sm" variant="destructive" disabled={pending} onclick={remove}>Delete</Button>{:else}<span></span>{/if}
				<div class="flex gap-2"><Button type="button" size="sm" variant="outline" onclick={() => selected = null}>Cancel</Button><Button type="button" size="sm" disabled={pending || !key.trim() || !label.trim() || !kind} onclick={save}>Save Action</Button></div>
			</div>
		</Field.Group>
	{/if}
	{#if error && selected === null}<p class="text-sm text-destructive">{error}</p>{/if}
</Field.Set>
