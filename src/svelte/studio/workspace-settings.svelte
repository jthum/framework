<script lang="ts">
	import type { WorkspaceClient } from "../../client/workspace-client.ts";
	import type { SettingSummary } from "../../kernel/workspace-config-service.ts";
	import { Button } from "../ui/button/index.js";
	import * as Field from "../ui/field/index.js";
	import { Input } from "../ui/input/index.js";
	import { Switch } from "../ui/switch/index.js";

	let { client, secretStorageNote = "The host controls how secret values are stored.", reservedKeys = [] }: { client?: WorkspaceClient; secretStorageNote?: string; reservedKeys?: readonly string[] } = $props();
	let settings = $state<readonly SettingSummary[]>([]);
	let selected = $state<string | null>(null);
	let key = $state("");
	let label = $state("");
	let category = $state("");
	let value = $state("");
	let valueIsJson = $state(false);
	let secret = $state(false);
	let pending = $state(false);
	let error = $state("");
	let loadedClient: WorkspaceClient | undefined;

	$effect(() => {
		if (!client || client === loadedClient) return;
		loadedClient = client;
		selected = null;
		settings = [];
		void refresh(client);
	});

	async function refresh(current: WorkspaceClient) {
		try { settings = await current.listSettings(); }
		catch (cause) { error = message(cause); }
	}

	function edit(setting?: SettingSummary) {
		selected = setting?.key ?? "";
		key = setting?.key ?? "";
		label = setting?.label ?? "";
		category = setting?.category ?? "";
		secret = setting?.secret ?? false;
		valueIsJson = !setting?.secret && setting?.value !== undefined && setting.value !== null && typeof setting.value !== "string";
		value = setting?.secret ? "" : typeof setting?.value === "string" ? setting.value : setting?.value === undefined || setting.value === null ? "" : JSON.stringify(setting.value);
		error = "";
	}

	async function save() {
		if (!client || !key.trim() || !label.trim() || pending) return;
		if (reservedKeys.includes(key.trim())) { error = "This setting is managed by the app."; return; }
		pending = true;
		error = "";
		try {
			const storedValue = valueIsJson && !secret ? JSON.parse(value) : value;
			await client.putSetting({
				key: key.trim(), label: label.trim(),
				...(category.trim() ? { category: category.trim() } : {}),
				...(secret ? { secret: true, ...(value ? { value } : {}) } : { value: storedValue }),
			});
			await refresh(client);
			selected = null;
		} catch (cause) { error = message(cause); }
		finally { pending = false; }
	}

	async function remove() {
		if (!client || !selected || pending) return;
		if (reservedKeys.includes(selected)) { error = "This setting is managed by the app."; return; }
		pending = true;
		error = "";
		try {
			await client.deleteSetting(selected);
			await refresh(client);
			selected = null;
		} catch (cause) { error = message(cause); }
		finally { pending = false; }
	}

	function message(cause: unknown) { return cause instanceof Error ? cause.message : "The setting could not be saved."; }
	function displayValue(value: SettingSummary["value"]) {
		if (value === undefined || value === null) return "Not set";
		return typeof value === "string" ? value : JSON.stringify(value);
	}
</script>

<Field.Set>
	<div class="flex items-start justify-between gap-3">
		<div class="flex flex-col gap-1">
			<Field.Legend class="mb-0">Settings</Field.Legend>
			<Field.Description>Values that Actions can read in this workspace.</Field.Description>
		</div>
		<Button type="button" size="sm" variant="outline" onclick={() => edit()}>Add setting</Button>
	</div>
	{#if settings.filter(setting => !reservedKeys.includes(setting.key)).length}
		<div class="flex flex-col divide-y rounded-lg border bg-card">
			{#each settings.filter(setting => !reservedKeys.includes(setting.key)) as setting (setting.key)}
				<div class="flex items-center justify-between gap-3 px-4 py-3">
					<div class="min-w-0">
						<p class="truncate text-sm font-medium">{setting.label}</p>
						<p class="truncate text-xs text-muted-foreground">{setting.category ? `${setting.category} · ` : ""}{setting.key} · {setting.secret ? (setting.configured ? "Secret configured" : "Secret not set") : displayValue(setting.value)}</p>
					</div>
					<Button type="button" size="sm" variant="ghost" onclick={() => edit(setting)}>Edit</Button>
				</div>
			{/each}
		</div>
	{:else if selected === null}
		<p class="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No settings yet. Add a provider choice or a credential when an Action needs one.</p>
	{/if}
	{#if selected !== null}
		<Field.Group class="rounded-lg border bg-card p-4">
			<Field.Field>
				<Field.Label for="workspace-setting-key">Key</Field.Label>
				<Input id="workspace-setting-key" bind:value={key} placeholder="search_provider" disabled={selected !== "" || pending} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="workspace-setting-label">Label</Field.Label>
				<Input id="workspace-setting-label" bind:value={label} placeholder="Search provider" disabled={pending} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="workspace-setting-category">Category</Field.Label>
				<Input id="workspace-setting-category" bind:value={category} placeholder="Search" disabled={pending} />
			</Field.Field>
			<Field.Field orientation="horizontal">
				<Field.Content>
					<Field.Label for="workspace-setting-secret">Secret value</Field.Label>
					<Field.Description>Secret values are masked after saving. Leave blank to keep an existing secret. {secretStorageNote}</Field.Description>
				</Field.Content>
				<Switch id="workspace-setting-secret" bind:checked={secret} disabled={pending} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="workspace-setting-value">Value</Field.Label>
					<Input id="workspace-setting-value" type={secret ? "password" : "text"} bind:value={value} disabled={pending} />
					{#if valueIsJson && !secret}<Field.Description>This value is JSON; edits must remain valid JSON.</Field.Description>{/if}
			</Field.Field>
			{#if error}<Field.Error>{error}</Field.Error>{/if}
			<div class="flex justify-between gap-2">
				{#if selected}<Button type="button" size="sm" variant="destructive" disabled={pending} onclick={remove}>Delete</Button>{:else}<span></span>{/if}
				<div class="flex gap-2"><Button type="button" size="sm" variant="outline" onclick={() => selected = null}>Cancel</Button><Button type="button" size="sm" disabled={pending || !key.trim() || !label.trim()} onclick={save}>Save setting</Button></div>
			</div>
		</Field.Group>
	{/if}
	{#if error && selected === null}<p class="text-sm text-destructive">{error}</p>{/if}
</Field.Set>
