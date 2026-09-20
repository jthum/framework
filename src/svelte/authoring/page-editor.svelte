<script lang="ts">
	import type { Snippet } from "svelte";
	import PageHeader from "../ui/page-header/page-header.svelte";
	import BlockPicker from "./block-picker.svelte";
	import BlockSettings from "./block-settings.svelte";
	import PageContent from "./page-content.svelte";
	import { Badge } from "../ui/badge/index.ts";
	import { Button } from "../ui/button/index.ts";
	import * as Card from "../ui/card/index.ts";
	import * as DropdownMenu from "../ui/dropdown-menu/index.ts";
	import * as Empty from "../ui/empty/index.ts";
	import type { PageLayoutNode, PageBlockNode, PageDefinition, PageHeight, SpecMeta } from "../../spec/model.ts";
	import type { BlockDefinition, BlockInputDefinition } from "../../blocks/model.ts";
	import {
		appendInGroup,
		blockAt,
		nodePath,
		emptyGroup,
		gridClass,
		groupHeightClass,
		insertBlock,
		moveInGroup,
		moveSibling,
		removeBlock,
		setBlock,
		setGroupColumns,
		setGroupMinHeight,
		createBlockNode,
		blockLabel,
	} from "./page-layout.ts";
	import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
	import ArrowLeftIcon from "@lucide/svelte/icons/arrow-left";
	import ArrowRightIcon from "@lucide/svelte/icons/arrow-right";
	import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
	import CheckIcon from "@lucide/svelte/icons/check";
	import Columns2Icon from "@lucide/svelte/icons/columns-2";
	import Columns3Icon from "@lucide/svelte/icons/columns-3";
	import Columns4Icon from "@lucide/svelte/icons/columns-4";
	import LayersIcon from "@lucide/svelte/icons/layers";
	import PencilIcon from "@lucide/svelte/icons/pencil";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import SquareIcon from "@lucide/svelte/icons/square";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import { toast } from "svelte-sonner";


	let {
		page: current,
		title = current.label,
		description = current.description,
		editable = true,
		startEditing = false,
		blocks,
		categories,
		onPreview,
		getConfig,
		getInputs,
		getOptions,
		renderBlock,
		onSave,
		onFinish,
	}: {
		page: PageDefinition;
		title?: string;
		description?: string;
		editable?: boolean;
		startEditing?: boolean;
		blocks: readonly BlockDefinition[];
		categories?: readonly { key: string; label: string }[];
		onPreview?: (key: string) => void;
		getConfig?: (block: BlockDefinition) => SpecMeta;
		getInputs?: (block: BlockDefinition) => readonly BlockInputDefinition[];
		getOptions?: (input: BlockInputDefinition, config: SpecMeta) => readonly { value: string; label: string }[];
		renderBlock: Snippet<[PageBlockNode]>;
		onSave: (page: PageDefinition) => void | Promise<unknown>;
		onFinish?: () => void;
	} = $props();

	let editing = $state(false);
	let draft = $state<readonly PageLayoutNode[]>([]);
	let draftPageId = "";
	let pickerOpen = $state(false);
	let insertPath = $state<number[] | null>(null);
	let sheetOpen = $state(false);
	let editingId = $state<string | null>(null);
	let pending = $state(false);

	const live = $derived(editing ? draft : current.layout);
	const editingPath = $derived(editingId ? nodePath(live, editingId) : undefined);
	const editingBlock = $derived(editingPath ? blockAt(live, editingPath) : undefined);
	const definition = $derived(editingBlock?.kind === "block" ? blocks.find(block => block.key === editingBlock.block) : undefined);

	$effect(() => {
		if (startEditing) editing = true;
	});

	$effect(() => {
		if (draftPageId !== current.id) {
			pickerOpen = false;
			sheetOpen = false;
			editingId = null;
			insertPath = null;
		}
		if (!editing || draftPageId !== current.id) {
			draft = current.layout;
			draftPageId = current.id;
		}
	});

	async function persist(next: readonly PageLayoutNode[]): Promise<boolean> {
		if (pending) return false;
		const previous = draft;
		const pageId = current.id;
		draft = next;
		draftPageId = current.id;
		editing = true;
		pending = true;
		try {
			await onSave(JSON.parse(JSON.stringify({ ...current, layout: next })) as PageDefinition);
			return true;
		} catch (err) {
			if (current.id === pageId) draft = previous;
			toast.error(err instanceof Error ? err.message : "Couldn't save the page");
			return false;
		} finally {
			pending = false;
		}
	}

	function startEdit() {
		draft = current.layout;
		editing = true;
	}

	function stopEdit() {
		editing = false;
		pickerOpen = false;
		sheetOpen = false;
		onFinish?.();
	}

	async function addGrid(columns: number) {
		await persist([...live, emptyGroup(columns)]);
		if (!editing) editing = true;
	}

	function openPicker(path: number[]) {
		insertPath = path;
		pickerOpen = true;
	}

	async function pickBlock(block: BlockDefinition) {
		if (pending) return;
		const nextBlock = createBlockNode(block, getConfig?.(block));
		const path = insertPath;
		insertPath = null;
		let next: readonly PageLayoutNode[];
		let createdPath: number[];
		if (!path?.length) {
			createdPath = [live.length, 0];
			next = [...live, { ...emptyGroup(), children: [nextBlock] }];
		} else {
			const group = blockAt(live, path);
			if (group?.kind === "group") {
				createdPath = [...path, group.children.length];
				next = appendInGroup(live, path, nextBlock);
			} else {
				createdPath = path;
				next = insertBlock(live, path, nextBlock);
			}
		}
		editingId = blockAt(next, createdPath)?.id ?? null;
		sheetOpen = true;
		if (!await persist(next)) {
			sheetOpen = false;
			editingId = null;
		}
	}

	function openSheet(path: number[]) {
		editingId = blockAt(live, path)?.id ?? null;
		sheetOpen = true;
	}

	async function saveBlock(config: SpecMeta) {
		if (!editingPath) throw new Error("This block is no longer on the page.");
		const currentBlock = blockAt(live, editingPath);
		if (currentBlock?.kind !== "block") throw new Error("Select a Block to configure.");
		if (!await persist(setBlock(live, editingPath, { ...currentBlock, config }))) {
			throw new Error("The block could not be saved. Please try again.");
		}
		editingId = null;
	}

	async function remove(path: number[]) {
		await persist(removeBlock(live, path));
	}

	async function changeColumns(index: number, columns: number) {
		await persist(setGroupColumns(live, index, columns));
	}

	async function changeHeight(index: number, height?: PageHeight) {
		await persist(setGroupMinHeight(live, index, height));
	}

	async function moveRow(index: number, to: number) {
		await persist(moveSibling(live, index, to));
	}

	async function moveBlock(groupIndex: number, from: number, to: number) {
		await persist(moveInGroup(live, groupIndex, from, to));
	}

	const gridChoices = [
		{ columns: 1, label: "Full width", icon: SquareIcon },
		{ columns: 2, label: "2 columns", icon: Columns2Icon },
		{ columns: 3, label: "3 columns", icon: Columns3Icon },
		{ columns: 4, label: "4 columns", icon: Columns4Icon },
	];
	const heightChoices: Array<{ value?: PageHeight; label: string }> = [
		{ value: undefined, label: "Default" },
		{ value: "s", label: "Compact" },
		{ value: "m", label: "Medium" },
		{ value: "l", label: "Tall" },
		{ value: "xl", label: "Extra tall" },
	];

	function countLabel(count: number, singular: string): string {
		return `${count} ${count === 1 ? singular : `${singular}s`}`;
	}
</script>

<div class="flex flex-col gap-6" inert={pending} aria-busy={pending}>
	<PageHeader {title} {description}>
		{#snippet actions()}
			{#if editable}
				{#if editing}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
							<Button variant="outline" {...props}>
								<PlusIcon data-icon="inline-start" />
								Add section
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end">
							{#each gridChoices as choice (choice.columns)}
								{@const Icon = choice.icon}
								<DropdownMenu.Item onSelect={() => addGrid(choice.columns)}>
									<Icon />
									{choice.label} section
								</DropdownMenu.Item>
							{/each}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
					<Button onclick={stopEdit} data-testid="page-done">
						<CheckIcon data-icon="inline-start" />
						Finish editing
					</Button>
				{:else}
					<Button variant="outline" onclick={startEdit} data-testid="page-edit">
						<PencilIcon data-icon="inline-start" />
						Edit
					</Button>
				{/if}
			{/if}
		{/snippet}
	</PageHeader>

	{#if !live.length}
		<Empty.Root class="border border-dashed">
			<Empty.Header>
				<Empty.Media variant="icon"><LayersIcon /></Empty.Media>
				<Empty.Title>Empty page</Empty.Title>
				<Empty.Description>
					{editing ? "Add a section, then choose the blocks it should contain." : "Edit this page to add blocks."}
				</Empty.Description>
			</Empty.Header>
			{#if editing}
				<Empty.Content>
					<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button {...props}>
									<PlusIcon data-icon="inline-start" />
									Add first section
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="center">
							<DropdownMenu.Group>
								{#each gridChoices as choice (choice.columns)}
									{@const Icon = choice.icon}
									<DropdownMenu.Item onSelect={() => addGrid(choice.columns)}>
										<Icon />
										{choice.label}
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Group>
						</DropdownMenu.Content>
					</DropdownMenu.Root>
				</Empty.Content>
			{/if}
		</Empty.Root>
	{/if}

	{#each live as block, index (block.id)}
		{#if block.kind === "group"}
			{#if editing}
				<Card.Root size="sm" class="h-auto">
					<Card.Header class="gap-0">
						<Card.Title>Section {index + 1}</Card.Title>
						<Card.Description>
							{countLabel(block.children.length, "block")} · {gridChoices.find((item) => item.columns === (block.columns ?? 1))?.label ?? "Full width"}
						</Card.Description>
						<Card.Action class="flex flex-wrap items-center justify-end gap-1">
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button variant="outline" size="xs" {...props}>
											{gridChoices.find((item) => item.columns === (block.columns ?? 1))?.label ?? "Layout"}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Group>
										{#each gridChoices as choice (choice.columns)}
											{@const Icon = choice.icon}
											<DropdownMenu.Item onSelect={() => changeColumns(index, choice.columns)}>
												<Icon />
												{choice.label}
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Group>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
							<DropdownMenu.Root>
								<DropdownMenu.Trigger>
									{#snippet child({ props })}
										<Button variant="ghost" size="xs" {...props}>
											{heightChoices.find((item) => item.value === block.minHeight)?.label ?? "Auto height"}
										</Button>
									{/snippet}
								</DropdownMenu.Trigger>
								<DropdownMenu.Content align="end">
									<DropdownMenu.Group>
										{#each heightChoices as choice (choice.value ?? "default")}
											<DropdownMenu.Item onSelect={() => changeHeight(index, choice.value)}>
												{choice.label}
											</DropdownMenu.Item>
										{/each}
									</DropdownMenu.Group>
								</DropdownMenu.Content>
							</DropdownMenu.Root>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={index === 0}
								onclick={() => moveRow(index, index - 1)}
							>
								<ArrowUpIcon />
								<span class="sr-only">Move row up</span>
							</Button>
							<Button
								variant="ghost"
								size="icon-sm"
								disabled={index === live.length - 1}
								onclick={() => moveRow(index, index + 1)}
							>
								<ArrowDownIcon />
								<span class="sr-only">Move row down</span>
							</Button>
							<Button variant="ghost" size="icon-sm" onclick={() => remove([index])}>
								<Trash2Icon />
								<span class="sr-only">Remove section</span>
							</Button>
						</Card.Action>
					</Card.Header>
					<Card.Content class="p-2">
						<div class="{gridClass(block.columns ?? 1)} items-stretch {groupHeightClass(block, blocks)}">
					{#each block.children as child, childIndex (child.id)}
						<div
							class="flex h-full flex-col overflow-hidden rounded-xl bg-surface-chrome p-1 {groupHeightClass(block, blocks)}"
						>
								<div class="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
									<Badge variant="outline">{blockLabel(child, blocks)}</Badge>
									<div class="flex items-center gap-0.5">
									<Button
										size="icon-xs"
										variant="ghost"
										disabled={childIndex === 0}
										onclick={() => moveBlock(index, childIndex, childIndex - 1)}
									>
										<ArrowLeftIcon />
										<span class="sr-only">Move left</span>
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										disabled={childIndex === block.children.length - 1}
										onclick={() => moveBlock(index, childIndex, childIndex + 1)}
									>
										<ArrowRightIcon />
										<span class="sr-only">Move right</span>
									</Button>
									<Button size="xs" variant="ghost" onclick={() => openSheet([index, childIndex])}>
										Edit
									</Button>
									<Button
										size="icon-xs"
										variant="ghost"
										onclick={() => remove([index, childIndex])}
									>
										<Trash2Icon />
										<span class="sr-only">Remove {blockLabel(child, blocks)}</span>
									</Button>
									</div>
								</div>
							<div class="flex min-h-0 flex-1 flex-col rounded-lg bg-background p-3">
								<PageContent layout={[child]} {blocks} {renderBlock} />
							</div>
						</div>
					{/each}
							<button
							type="button"
							class="flex min-h-28 items-center justify-center gap-2 rounded-xl border border-dashed text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
							onclick={() => openPicker([index])}
							data-testid="add-block-slot"
						>
							<PlusIcon class="size-4" />
								Add block
							</button>
						</div>
					</Card.Content>
				</Card.Root>
			{:else}
				<div class="{gridClass(block.columns ?? 1)} items-stretch {groupHeightClass(block, blocks)}">
					{#each block.children as child (child.id)}
						<div class="flex h-full min-h-0 flex-col {groupHeightClass(block, blocks)}">
							<PageContent layout={[child]} {blocks} {renderBlock} />
						</div>
					{/each}
				</div>
			{/if}
		{:else}
			<div
				class={editing
					? "flex h-full min-h-0 flex-col overflow-hidden rounded-xl bg-surface-chrome p-1"
					: "h-full min-h-0"}
			>
				{#if editing}
					<div class="flex min-h-9 items-center justify-between gap-2 px-2 py-1">
						<Badge variant="outline">{blockLabel(block, blocks)}</Badge>
						<div class="flex items-center gap-0.5">
						<Button size="xs" variant="ghost" onclick={() => openSheet([index])}>Edit</Button>
						<Button size="icon-xs" variant="ghost" onclick={() => remove([index])}>
							<Trash2Icon />
							<span class="sr-only">Remove</span>
						</Button>
						</div>
					</div>
				{/if}
				<div class={editing ? "flex min-h-0 flex-1 flex-col rounded-lg bg-background p-3" : "h-full min-h-0"}>
					{@render renderBlock(block)}
				</div>
			</div>
		{/if}
	{/each}

	{#if editing && live.length}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button variant="outline" class="h-12 w-full border-dashed" {...props}>
						<PlusIcon data-icon="inline-start" />
						Add section
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="center">
				<DropdownMenu.Group>
					{#each gridChoices as choice (choice.columns)}
						{@const Icon = choice.icon}
						<DropdownMenu.Item onSelect={() => addGrid(choice.columns)}>
							<Icon />
							{choice.label} section
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Group>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</div>

<BlockPicker bind:open={pickerOpen} {blocks} {categories} {onPreview} onPick={pickBlock} />
<BlockSettings bind:open={sheetOpen} node={editingBlock?.kind === "block" ? editingBlock : null} {definition} inputs={definition ? getInputs?.(definition) : undefined} {getOptions} onSave={saveBlock} />
