<script lang="ts">
	import { Button } from "../ui/button/index.js";
	import * as Dialog from "../ui/dialog/index.js";
	import * as Field from "../ui/field/index.js";
	import { Input } from "../ui/input/index.js";

	let {
		open = $bindable(false),
		title,
		description,
		label = "Name",
		confirm = "Create",
		onSubmit,
	}: {
		open?: boolean;
		title: string;
		description?: string;
		label?: string;
		confirm?: string;
		onSubmit: (name: string) => Promise<void> | void;
	} = $props();

	let name = $state("");
	let pending = $state(false);

	$effect(() => {
		if (open) name = "";
	});

	async function submit(event: Event) {
		event.preventDefault();
		if (!name.trim()) return;
		pending = true;
		try {
			await onSubmit(name.trim());
			open = false;
		} finally {
			pending = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content>
		<form onsubmit={submit}>
			<Dialog.Header>
				<Dialog.Title>{title}</Dialog.Title>
				{#if description}
					<Dialog.Description>{description}</Dialog.Description>
				{/if}
			</Dialog.Header>
			<Dialog.Body>
				<Field.Field>
					<Field.Label>{label}</Field.Label>
					<Input bind:value={name} />
				</Field.Field>
			</Dialog.Body>
			<Dialog.Footer>
				<Button type="button" variant="outline" onclick={() => (open = false)}>Cancel</Button>
				<Button type="submit" disabled={pending || !name.trim()}>{confirm}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
