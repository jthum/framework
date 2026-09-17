<script lang="ts">
	import OptionSelect from "./option-select.svelte";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import { Checkbox } from "@jthum/framework/svelte/ui/checkbox";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { labelFromKey, slugify } from "./editor-data.js";
	import type { CollectionDraft, TransitionDraft as Transition } from "./authoring.js";
	import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import TrashIcon from "@lucide/svelte/icons/trash-2";
	import { toast } from "svelte-sonner";

	let { type, onSave }: { type: CollectionDraft; onSave: import("./authoring.js").CollectionActions["save"] } = $props();

	type TransitionDraft = Transition & { localId: string };
	const enumFields = $derived(type.fields.filter((field) => field.type === "enum"));
	const fieldOptions = $derived(
		enumFields.map((field) => ({ value: field.key, label: field.label })),
	);
	let editing = $state(false);
	let field = $state("");
	let initial = $state("");
	let terminal = $state<string[]>([]);
	let transitions = $state<TransitionDraft[]>([]);
	let pending = $state(false);
	const states = $derived(enumFields.find((item) => item.key === field)?.values ?? []);
	const stateOptions = $derived(states.map((state) => ({ value: state, label: labelFromKey(state) })));

	function edit() {
		field = type.lifecycle?.field ?? enumFields[0]?.key ?? "";
		const available = enumFields.find((item) => item.key === field)?.values ?? [];
		initial = type.lifecycle?.initial ?? available[0] ?? "";
		terminal = [...(type.lifecycle?.terminal ?? [])];
		transitions = (type.lifecycle?.transitions ?? []).map((transition, index) => ({
			...transition,
			from: [...transition.from],
			localId: `${transition.key}-${index}`,
		}));
		editing = true;
	}

	function selectField(next: string) {
		field = next;
		const available = enumFields.find((item) => item.key === next)?.values ?? [];
		initial = available[0] ?? "";
		terminal = [];
		transitions = [];
	}

	function toggleTerminal(state: string, checked: boolean) {
		terminal = checked ? [...terminal, state] : terminal.filter((item) => item !== state);
		if (checked) {
			transitions = transitions.map((transition) => ({
				...transition,
				from: transition.from.filter((source) => source !== state),
			}));
		}
	}

	function addTransition() {
		const from = states.find((state) => !terminal.includes(state)) ?? states[0] ?? "";
		const to = states.find((state) => state !== from) ?? "";
		transitions = [
			...transitions,
			{ localId: crypto.randomUUID(), key: "", label: "", from: from ? [from] : [], to },
		];
	}

	function updateTransition(localId: string, patch: Partial<TransitionDraft>) {
		transitions = transitions.map((item) => (item.localId === localId ? { ...item, ...patch } : item));
	}

	function toggleSource(localId: string, state: string, checked: boolean) {
		const transition = transitions.find((item) => item.localId === localId);
		if (!transition) return;
		const from = checked
			? [...transition.from, state]
			: transition.from.filter((item) => item !== state);
		updateTransition(localId, { from });
	}

	async function save() {
		if (!field || !initial) return;
		pending = true;
		try {
			await onSave({
				key: type.key,
				lifecycle: {
					field,
					initial,
					terminal,
					transitions: transitions.map(({ localId: _, ...transition }) => ({
						...transition,
						key: transition.key.trim() || slugify(transition.label),
						label: transition.label.trim(),
					})),
				},
			});
			editing = false;
			toast.success("Lifecycle saved");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : String(error));
		} finally {
			pending = false;
		}
	}

	async function remove() {
		pending = true;
		try {
			await onSave({ key: type.key, lifecycle: null });
			editing = false;
			toast.success("Lifecycle removed");
		} finally {
			pending = false;
		}
	}
</script>

<Card.Root class="h-auto">
	<Card.Header class="gap-0">
		<Card.Title>Lifecycle</Card.Title>
		<Card.Description>Control how records move through an enum field.</Card.Description>
		{#if type.lifecycle}<Card.Action><Badge variant="secondary">Configured</Badge></Card.Action>{/if}
	</Card.Header>
	<Card.Content class="flex flex-col gap-5">
		{#if editing}
			<Field.Group>
				<Field.Field>
					<Field.Label>State field</Field.Label>
					<OptionSelect value={field} options={fieldOptions} onValueChange={selectField} />
				</Field.Field>
				<Field.Field>
					<Field.Label>Initial state</Field.Label>
					<OptionSelect bind:value={initial} options={stateOptions} />
					<Field.Description>Every new record starts here.</Field.Description>
				</Field.Field>
				<Field.FieldSet>
					<Field.FieldLegend>Terminal states</Field.FieldLegend>
					<Field.Description>Records cannot leave these states.</Field.Description>
					<Field.Group class="grid grid-cols-2 gap-3">
						{#each states as state (state)}
							<Field.Field orientation="horizontal">
								<Checkbox checked={terminal.includes(state)} onCheckedChange={(checked) => toggleTerminal(state, checked === true)} />
								<Field.Label>{labelFromKey(state)}</Field.Label>
							</Field.Field>
						{/each}
					</Field.Group>
				</Field.FieldSet>
			</Field.Group>

			<div class="flex items-center justify-between gap-3">
				<div class="flex flex-col gap-0"><h3 class="font-medium">Transitions</h3><p class="text-sm text-muted-foreground">A transition can start from one or several states.</p></div>
				<Button size="sm" variant="outline" onclick={addTransition}><PlusIcon data-icon="inline-start" /> Add</Button>
			</div>

			<div class="flex flex-col gap-3">
				{#each transitions as transition, index (transition.localId)}
					<Card.Root class="h-auto">
						<Card.Header class="gap-0">
							<Card.Title>Transition {index + 1}</Card.Title>
							<Card.Action><Button size="icon" variant="ghost" onclick={() => (transitions = transitions.filter((item) => item.localId !== transition.localId))}><TrashIcon /><span class="sr-only">Remove transition</span></Button></Card.Action>
						</Card.Header>
						<Card.Content class="flex flex-col gap-4">
							<Field.Field>
								<Field.Label>Name</Field.Label>
								<Input value={transition.label} oninput={(event) => updateTransition(transition.localId, { label: event.currentTarget.value, key: transition.key || slugify(event.currentTarget.value) })} placeholder="Submit" />
							</Field.Field>
							<Field.FieldSet>
								<Field.FieldLegend>Available from</Field.FieldLegend>
								<Field.Group class="grid grid-cols-2 gap-3">
									{#each states.filter((state) => !terminal.includes(state) && state !== transition.to) as state (state)}
										<Field.Field orientation="horizontal">
											<Checkbox checked={transition.from.includes(state)} onCheckedChange={(checked) => toggleSource(transition.localId, state, checked === true)} />
											<Field.Label>{labelFromKey(state)}</Field.Label>
										</Field.Field>
									{/each}
								</Field.Group>
							</Field.FieldSet>
							<Field.Field>
								<Field.Label>Moves to</Field.Label>
								<OptionSelect value={transition.to} options={stateOptions} onValueChange={(to) => updateTransition(transition.localId, { to, from: transition.from.filter((source) => source !== to) })} />
							</Field.Field>
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		{:else if type.lifecycle}
			<div class="grid gap-3 sm:grid-cols-3">
				<div class="flex min-w-0 flex-col gap-1 rounded-xl bg-muted/50 p-3">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">State field</span>
					<span class="truncate font-medium">{enumFields.find((item) => item.key === type.lifecycle?.field)?.label ?? labelFromKey(type.lifecycle.field)}</span>
				</div>
				<div class="flex min-w-0 flex-col gap-1 rounded-xl bg-muted/50 p-3">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Starts in</span>
					<Badge>{labelFromKey(type.lifecycle.initial)}</Badge>
				</div>
				<div class="flex min-w-0 flex-col gap-1 rounded-xl bg-muted/50 p-3">
					<span class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Ends in</span>
					<div class="flex flex-wrap gap-1">
						{#each type.lifecycle.terminal ?? [] as state (state)}<Badge variant="surface">{labelFromKey(state)}</Badge>{:else}<span class="text-sm text-muted-foreground">No terminal state</span>{/each}
					</div>
				</div>
			</div>

			<div class="flex flex-col gap-2">
				<div class="flex items-center justify-between gap-3">
					<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">Allowed moves</p>
					<Badge variant="outline">{type.lifecycle.transitions.length} {type.lifecycle.transitions.length === 1 ? "transition" : "transitions"}</Badge>
				</div>
				<div class="grid gap-2 sm:grid-cols-2">
				{#each type.lifecycle.transitions as transition (transition.key)}
					<div class="flex min-w-0 flex-col gap-2 rounded-xl border bg-muted/30 p-3">
						<span class="font-medium leading-tight">{transition.label || labelFromKey(transition.key)}</span>
						<div class="flex min-w-0 flex-wrap items-center gap-1.5">
							{#each transition.from as state (state)}<Badge variant="surface">{labelFromKey(state)}</Badge>{/each}
							<ArrowRightIcon class="size-4 shrink-0 text-muted-foreground" />
							<Badge>{labelFromKey(transition.to)}</Badge>
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No named transitions yet.</p>
				{/each}
				</div>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">Choose a state field, starting state, and the transitions records may follow.</p>
		{/if}
	</Card.Content>
	<Card.Footer class="justify-between gap-3">
		{#if editing && type.lifecycle}<Button variant="ghost" disabled={pending} onclick={remove}>Remove lifecycle</Button>{:else}<span></span>{/if}
		<div class="flex items-center gap-2">
			{#if editing}<Button variant="ghost" disabled={pending} onclick={() => (editing = false)}>Cancel</Button>{/if}
			{#if editing}<Button disabled={pending || !field || !initial} onclick={save}>Save lifecycle</Button>{:else}<Button variant="outline" disabled={!enumFields.length} onclick={edit}>{type.lifecycle ? "Edit lifecycle" : "Configure lifecycle"}</Button>{/if}
		</div>
	</Card.Footer>
</Card.Root>
