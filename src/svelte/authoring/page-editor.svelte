<script lang="ts">
  import {
    onDestroy,
    tick,
    untrack,
    type Component,
    type Snippet,
  } from "svelte";
  import type {
    JsonValue,
    PageDefinition,
    PageLayoutNode,
    PageBlockNode,
    SpecMeta,
  } from "../../spec/model.ts";
  import type {
    BlockDefinition,
    BlockInputDefinition,
  } from "../../blocks/model.ts";
  import { resourceConflict, resourceNotFound } from "../../errors/error.ts";
  import { toastError } from "../internal/error-presentation.ts";
  import { Button } from "../ui/button/index.ts";
  import OptionSelect from "../ui/option-select/option-select.svelte";
  import * as Field from "../ui/field/index.ts";
  import { Input } from "../ui/input/index.ts";
  import { Textarea } from "../ui/textarea/index.ts";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import CheckIcon from "@lucide/svelte/icons/check";
  import PencilIcon from "@lucide/svelte/icons/pencil";
  import LayoutGridIcon from "@lucide/svelte/icons/layout-grid";
  import PageContent from "./page-content.svelte";
  import PageEditorNode from "../internal/page-editor-node.svelte";
  import BlockPicker from "./block-picker.svelte";
  import BlockSettings from "./block-settings.svelte";
  import {
    appendInGroup,
    blockAt,
    createBlockNode,
    emptyGroup,
    moveLayoutNode,
    nodePath,
    removeBlock,
    setBlock,
  } from "./page-layout.ts";
  import {
    startVerticalDrag,
    type VerticalDragSession,
  } from "./vertical-drag.ts";

  let {
    page: current,
    title = current.label,
    description = current.description,
    editable = true,
    startEditing = false,
    blocks,
    categories,
    onPreview,
    getIcon,
    getConfig,
    getInputs,
    getOptions,
    getInputValue,
    setInputValue,
    renderBlock,
    onSave,
    onFinish,
    onUnsavedChange,
  }: {
    page: PageDefinition;
    title?: string;
    description?: string;
    editable?: boolean;
    startEditing?: boolean;
    blocks: readonly BlockDefinition[];
    categories?: readonly { key: string; label: string }[];
    onPreview?: (key: string) => void;
    getIcon?: (block: BlockDefinition) => Component | undefined;
    getConfig?: (block: BlockDefinition) => SpecMeta;
    getInputs?: (block: BlockDefinition) => readonly BlockInputDefinition[];
    getOptions?: (
      input: BlockInputDefinition,
      config: SpecMeta,
      definition?: BlockDefinition,
    ) => readonly { value: string; label: string }[];
    getInputValue?: (
      input: BlockInputDefinition,
      config: SpecMeta,
    ) => JsonValue;
    setInputValue?: (
      input: BlockInputDefinition,
      value: JsonValue,
      config: SpecMeta,
    ) => SpecMeta;
    renderBlock: Snippet<[PageBlockNode]>;
    onSave: (page: PageDefinition) => void | Promise<unknown>;
    onFinish?: () => void;
    onUnsavedChange?: (dirty: boolean) => void;
  } = $props();
  let editing = $state(untrack(() => startEditing));
  let draft = $state.raw<readonly PageLayoutNode[]>(
    untrack(() => current.layout),
  );
  let pageId = untrack(() => current.id);
  let selected = $state<string | null>(null);
  let staged = $state<string | null>(null);
  let inspectorDirty = $state(false);
  let pickerOpen = $state(false);
  let settingsOpen = $state(false);
  let addTo = $state<string | null>(null);
  let pending = $state(false);
  let label = $state(untrack(() => current.label));
  let pageDescription = $state(untrack(() => current.description ?? ""));
  let savedLabel = $state(untrack(() => current.label));
  let savedDescription = $state(untrack(() => current.description ?? ""));
  let canvas = $state<HTMLDivElement | null>(null);
  let inspector = $state<HTMLElement | null>(null);
  let drop = $state<{ id: string; after: boolean } | null>(null);
  let drag: VerticalDragSession | null = null;
  const live = $derived(editing ? draft : current.layout);
  const selectedPath = $derived(
    selected ? nodePath(live, selected) : undefined,
  );
  const node = $derived(selectedPath ? blockAt(live, selectedPath) : undefined);
  const definition = $derived(
    node?.kind === "block"
      ? blocks.find((block) => block.key === node.block)
      : undefined,
  );
  const metadataDirty = $derived(
    label !== savedLabel || pageDescription !== savedDescription,
  );
  const unsaved = $derived(Boolean(staged) || inspectorDirty || metadataDirty);
  const controlsDisabled = $derived(pending || Boolean(staged));
  const prefix = $props.id();

  $effect(() => {
    if (startEditing) editing = true;
  });
  $effect(() => {
    if (pageId !== current.id) {
      drag?.cancel();
      selected = null;
      staged = null;
      inspectorDirty = false;
      pickerOpen = false;
      settingsOpen = false;
      addTo = null;
      label = savedLabel = current.label;
      pageDescription = savedDescription = current.description ?? "";
    }
    if (!editing || pageId !== current.id) {
      draft = current.layout;
      pageId = current.id;
    }
  });
  $effect(() => {
    onUnsavedChange?.(unsaved);
  });
  onDestroy(() => {
    drag?.cancel();
    onUnsavedChange?.(false);
  });

  function cancelSettings() {
    if (staged) {
      const path = nodePath(draft, staged);
      if (path) draft = removeBlock(draft, path);
    }
    staged = null;
    inspectorDirty = false;
    settingsOpen = false;
    label = savedLabel;
    pageDescription = savedDescription;
  }
  function discard(): boolean {
    if (unsaved && !window.confirm("Discard unapplied changes?")) return false;
    cancelSettings();
    return true;
  }
  function finish() {
    if (pending || !discard()) return;
    editing = false;
    selected = null;
    pickerOpen = false;
    onFinish?.();
  }
  function select(id: string) {
    if (pending || (selected !== id && !discard())) return;
    selected = id;
    pickerOpen = false;
    settingsOpen = true;
    void revealInspector();
  }
  function add(parent: string | null = null) {
    if (pending || !discard()) return;
    selected = null;
    addTo = parent;
    pickerOpen = true;
    void revealInspector();
  }
  function pick(block: BlockDefinition) {
    const created = createBlockNode(block, getConfig?.(block));
    const path = addTo ? nodePath(draft, addTo) : undefined;
    draft = path ? appendInGroup(draft, path, created) : [...draft, created];
    selected = created.id;
    staged = created.id;
    pickerOpen = false;
    settingsOpen = true;
  }
  async function revealInspector() {
    await tick();
    if (!inspector || !canvas) return;
    const bounds = inspector.getBoundingClientRect();
    // On narrow screens the inspector follows the canvas, rather than sitting beside it.
    if (
      bounds.top >= canvas.getBoundingClientRect().bottom &&
      (bounds.top > window.innerHeight * 0.7 || bounds.bottom < 0)
    ) {
      inspector.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
    }
  }
  async function persist(
    next: readonly PageLayoutNode[],
    reportError = true,
    metadata?: Pick<PageDefinition, "label" | "description">,
  ): Promise<boolean> {
    if (pending) return false;
    const previous = draft,
      active = current.id;
    pending = true;
    draft = next;
    try {
      await onSave(
        JSON.parse(
          JSON.stringify({ ...current, ...metadata, layout: next }),
        ) as PageDefinition,
      );
      return true;
    } catch (cause) {
      if (current.id === active) draft = previous;
      if (!reportError) throw cause;
      toastError(cause, "Couldn't save the page");
      return false;
    } finally {
      pending = false;
    }
  }
  async function saveDetails(event: SubmitEvent) {
    event.preventDefault();
    const name = label.trim(),
      description = pageDescription.trim();
    if (
      name &&
      (await persist(draft, true, {
        label: name,
        description: description || undefined,
      }))
    ) {
      label = savedLabel = name;
      pageDescription = savedDescription = description;
    }
  }
  async function saveBlock(config: SpecMeta) {
    if (!selectedPath || node?.kind !== "block")
      throw resourceNotFound("Block", selected ?? "");
    if (
      !(await persist(
        setBlock(draft, selectedPath, { ...node, config }),
        false,
      ))
    )
      throw resourceConflict("A page change is already being saved.");
    staged = null;
    inspectorDirty = false;
  }
  async function remove(id: string) {
    if (pending || !discard()) return;
    const path = nodePath(draft, id);
    if (
      path &&
      (await persist(removeBlock(draft, path))) &&
      (selected === id || !nodePath(draft, selected ?? ""))
    )
      selected = null;
  }
  async function move(id: string, direction: -1 | 1) {
    if (pending || !discard()) return;
    const path = nodePath(draft, id);
    if (!path) return;
    const sibling = [...path];
    sibling[sibling.length - 1] = sibling[sibling.length - 1]! + direction;
    const destination = blockAt(draft, sibling);
    if (destination)
      await persist(moveLayoutNode(draft, id, destination.id, direction === 1));
  }
  async function layout(columns: number) {
    if (pending) return;
    const path = selected ? nodePath(draft, selected) : undefined;
    const group = path ? blockAt(draft, path) : undefined;
    if (path && group?.kind === "group")
      await persist(setBlock(draft, path, { ...group, columns }));
  }
  async function moveOut(id: string) {
    if (pending || !discard()) return;
    const path = nodePath(draft, id);
    if (!path || path.length < 2) return;
    const parent = blockAt(draft, path.slice(0, -1));
    if (parent) await persist(moveLayoutNode(draft, id, parent.id, true));
  }
  async function addRow() {
    if (pending || !discard()) return;
    const row = emptyGroup(2);
    if (await persist([...draft, row])) {
      selected = row.id;
      pickerOpen = false;
      settingsOpen = true;
      void revealInspector();
    }
  }
  async function height(value: string) {
    if (pending || !selectedPath || node?.kind !== "group") return;
    const { minHeight: _previous, ...group } = node;
    if (
      value !== "auto" &&
      value !== "s" &&
      value !== "m" &&
      value !== "l" &&
      value !== "xl"
    )
      return;
    await persist(
      setBlock(draft, selectedPath, {
        ...group,
        ...(value === "auto" ? {} : { minHeight: value }),
      }),
    );
  }
  function startDrag(event: PointerEvent, id: string) {
    if (pending || unsaved) return;
    const item =
      event.currentTarget instanceof HTMLElement
        ? event.currentTarget.closest<HTMLElement>("[data-page-node]")
        : null;
    drag = startVerticalDrag({
      event,
      container: canvas,
      item,
      horizontal: true,
      onMove: (y, x) => {
        const target = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-page-node]");
        if (
          !target ||
          !canvas?.contains(target) ||
          target.dataset.pageNode === id
        ) {
          drop = null;
          return;
        }
        const bounds = target.getBoundingClientRect();
        drop = {
          id: target.dataset.pageNode!,
          after: y > bounds.top + bounds.height / 2,
        };
      },
      onDrop: async () => {
        const destination = drop;
        drop = null;
        drag = null;
        if (destination) {
          const next = moveLayoutNode(
            draft,
            id,
            destination.id,
            destination.after,
            true,
          );
          if (next !== draft) await persist(next);
        }
      },
      onCancel: () => {
        drop = null;
        drag = null;
      },
    });
  }
</script>

<svelte:window
  onbeforeunload={(event) => {
    if (unsaved) event.preventDefault();
  }}
/>
<div class="flex min-w-0 flex-col gap-6" aria-busy={pending}>
  <header class="flex flex-wrap items-start justify-between gap-4">
    <div class="min-w-0">
      <h2 class="text-2xl font-semibold tracking-tight">{title}</h2>
      {#if description}<p
          class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground"
        >
          {description}
        </p>{/if}
    </div>
    {#if editable}<div class="flex items-center gap-3">
        {#if editing}<span role="status" class="text-xs text-muted-foreground"
            >{pending
              ? "Saving…"
              : unsaved
                ? "Unapplied changes"
                : "Saved"}</span
          ><Button
            variant="outline"
            size="sm"
            disabled={pending}
            onclick={() => add()}><PlusIcon />Add content</Button
          ><Button size="sm" disabled={pending} onclick={finish}
            ><CheckIcon />Done</Button
          >
        {:else}<Button
            variant="outline"
            size="sm"
            onclick={() => (editing = true)}><PencilIcon />Edit page</Button
          >{/if}
      </div>{/if}
  </header>
  {#if editing && editable}
    <div
      class="grid min-w-0 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_19rem]"
    >
      <div
        bind:this={canvas}
        class="@container flex min-w-0 flex-col gap-7 pt-4"
      >
        {#each draft as item, index (item.id)}<PageEditorNode
            node={item}
            {blocks}
            {renderBlock}
            {selected}
            disabled={controlsDisabled}
            first={index === 0}
            last={index === draft.length - 1}
            dropTarget={drop?.id ?? null}
            onSelect={select}
            onAdd={(id) => add(id)}
            onMove={move}
            onMoveOut={moveOut}
            onRemove={remove}
            onDrag={startDrag}
          />{/each}
        {#if !draft.length}<button
            type="button"
            class="flex min-h-48 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed bg-muted/20 p-8 text-sm text-muted-foreground hover:bg-muted/40"
            onclick={() => add()}
            ><PlusIcon class="size-6" /><span
              >Add your first piece of content</span
            ></button
          >{/if}
        <div class="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={controlsDisabled}
            onclick={() => add()}><PlusIcon />Add content</Button
          ><Button
            variant="ghost"
            size="sm"
            disabled={controlsDisabled}
            onclick={addRow}><LayoutGridIcon />Add columns</Button
          >
        </div>
      </div>
      <aside
        bind:this={inspector}
        aria-label="Page inspector"
        class="sticky top-0 min-w-0 scroll-mt-20 rounded-2xl bg-muted/40 p-5"
        inert={pending}
      >
        {#if pickerOpen}<BlockPicker
            bind:open={pickerOpen}
            {blocks}
            {categories}
            {onPreview}
            {getIcon}
            presentation="inline"
            onPick={pick}
          />
        {:else if node?.kind === "block" && settingsOpen}
          {#key node.id}<BlockSettings
              bind:open={settingsOpen}
              {node}
              {definition}
              inputs={definition ? getInputs?.(definition) : undefined}
              {getOptions}
              getValue={getInputValue}
              setValue={setInputValue}
              presentation="inline"
              onSave={saveBlock}
              onCancel={cancelSettings}
              onDirtyChange={(dirty) => (inspectorDirty = dirty)}
            />{/key}
        {:else if node?.kind === "group"}<div class="space-y-5">
            <div>
              <h3 class="font-semibold">Layout</h3>
              <p class="mt-1 text-sm leading-5 text-muted-foreground">
                Arrange this row without changing its content.
              </p>
            </div>
            <Field.Field
              ><Field.Label for={`${prefix}-columns`}>Columns</Field.Label
              ><OptionSelect
                id={`${prefix}-columns`}
                value={String(node.columns ?? 1)}
                options={[
                  { value: "1", label: "Full width" },
                  { value: "2", label: "Two columns" },
                  { value: "3", label: "Three columns" },
                  { value: "4", label: "Four columns" },
                ]}
                onValueChange={(value) => void layout(Number(value))}
              /></Field.Field
            >
            <details>
              <summary class="cursor-pointer text-sm text-muted-foreground"
                >More layout options</summary
              ><Field.Field class="pt-3"
                ><Field.Label for={`${prefix}-height`}
                  >Minimum height</Field.Label
                ><OptionSelect
                  id={`${prefix}-height`}
                  value={node.minHeight ?? "auto"}
                  options={[
                    { value: "auto", label: "Fit content" },
                    { value: "s", label: "Compact" },
                    { value: "m", label: "Medium" },
                    { value: "l", label: "Tall" },
                    { value: "xl", label: "Extra tall" },
                  ]}
                  onValueChange={(value) => void height(value)}
                /></Field.Field
              >
            </details>
            <Button variant="outline" size="sm" onclick={() => add(node!.id)}
              ><PlusIcon />Add content to this row</Button
            >
          </div>
        {:else}<form class="space-y-5" onsubmit={saveDetails}>
            <div>
              <h3 class="font-semibold">Page details</h3>
              <p class="mt-1 text-sm leading-6 text-muted-foreground">
                Select content to edit it. Drag a handle to rearrange the page.
              </p>
            </div>
            <Field.Field
              ><Field.Label for={`${prefix}-name`}>Name</Field.Label><Input
                id={`${prefix}-name`}
                bind:value={label}
                required
                maxlength={120}
              /></Field.Field
            ><Field.Field
              ><Field.Label for={`${prefix}-description`}
                >Description</Field.Label
              ><Textarea
                id={`${prefix}-description`}
                bind:value={pageDescription}
                maxlength={2000}
                rows={3}
              /></Field.Field
            ><Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={!metadataDirty || pending}>Save details</Button
            >
          </form>{/if}
      </aside>
    </div>
  {:else}<div class="flex min-w-0 flex-col gap-6">
      <PageContent layout={current.layout} {blocks} {renderBlock} />
    </div>{/if}
</div>
