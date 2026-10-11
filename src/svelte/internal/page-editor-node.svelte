<script lang="ts">
  import type { Snippet } from "svelte";
  import type { PageLayoutNode, PageBlockNode } from "../../spec/model.ts";
  import type { BlockDefinition } from "../../blocks/model.ts";
  import { Button } from "../ui/button/index.ts";
  import * as DropdownMenu from "../ui/dropdown-menu/index.ts";
  import { cn } from "../utils.ts";
  import {
    blockLabel,
    gridClass,
    groupHeightClass,
  } from "../authoring/page-layout.ts";
  import PageEditorNode from "./page-editor-node.svelte";
  import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
  import EllipsisIcon from "@lucide/svelte/icons/ellipsis";
  import PlusIcon from "@lucide/svelte/icons/plus";
  import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
  import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
  import Trash2Icon from "@lucide/svelte/icons/trash-2";
  import CornerUpLeftIcon from "@lucide/svelte/icons/corner-up-left";

  let {
    node,
    blocks,
    selected,
    disabled,
    first,
    last,
    dropTarget,
    onSelect,
    onAdd,
    onMove,
    onMoveOut,
    nested = false,
    onRemove,
    onDrag,
    renderBlock,
  }: {
    node: PageLayoutNode;
    blocks: readonly BlockDefinition[];
    selected: string | null;
    disabled: boolean;
    first: boolean;
    last: boolean;
    dropTarget: string | null;
    onSelect: (id: string) => void;
    onAdd: (id: string) => void;
    onMove: (id: string, direction: -1 | 1) => void;
    onMoveOut: (id: string) => void;
    nested?: boolean;
    onRemove: (id: string) => void;
    onDrag: (event: PointerEvent, id: string) => void;
    renderBlock: Snippet<[PageBlockNode]>;
  } = $props();
</script>

<div
  data-page-node={node.id}
  data-sort-key={node.id}
  class={cn(
    "@container relative min-w-0 rounded-xl outline-offset-4 [&:hover>.page-node-tools]:opacity-100 [&:focus-within>.page-node-tools]:opacity-100",
    selected === node.id
      ? "outline-2 outline-primary/50"
      : "hover:outline-1 hover:outline-border",
    dropTarget === node.id && "outline-2 outline-primary",
  )}
>
  <div
    class="page-node-tools absolute -top-3 right-2 z-20 flex items-center gap-0.5 rounded-lg border bg-background p-0.5 opacity-0 shadow-sm transition-opacity [@media(hover:none)]:opacity-100"
    class:opacity-100={selected === node.id}
  >
    <Button
      variant="ghost"
      size="icon-xs"
      class="touch-none cursor-grab active:cursor-grabbing"
      {disabled}
      aria-label={`Drag ${blockLabel(node, blocks)}`}
      onpointerdown={(event) => onDrag(event, node.id)}
      ><GripVerticalIcon class="size-3.5" /></Button
    >
    <Button
      variant="ghost"
      size="xs"
      {disabled}
      onclick={() => onSelect(node.id)}
      >{node.kind === "group" ? "Layout" : "Edit"}</Button
    >
    <DropdownMenu.Root
      ><DropdownMenu.Trigger
        >{#snippet child({ props })}<Button
            {...props}
            variant="ghost"
            size="icon-xs"
            {disabled}
            aria-label={`${blockLabel(node, blocks)} options`}
            ><EllipsisIcon /></Button
          >{/snippet}</DropdownMenu.Trigger
      ><DropdownMenu.Content align="end">
        <DropdownMenu.Item disabled={first} onclick={() => onMove(node.id, -1)}
          ><ArrowUpIcon />Move earlier</DropdownMenu.Item
        >
        <DropdownMenu.Item disabled={last} onclick={() => onMove(node.id, 1)}
          ><ArrowDownIcon />Move later</DropdownMenu.Item
        >
        {#if nested}<DropdownMenu.Item onclick={() => onMoveOut(node.id)}
            ><CornerUpLeftIcon />Move out of this row</DropdownMenu.Item
          >{/if}
        <DropdownMenu.Separator /><DropdownMenu.Item
          variant="destructive"
          onclick={() => onRemove(node.id)}
          ><Trash2Icon />Remove {node.kind === "group"
            ? "layout"
            : "block"}</DropdownMenu.Item
        >
      </DropdownMenu.Content></DropdownMenu.Root
    >
  </div>
  {#if node.kind === "group"}
    <div
      class={cn(
        gridClass(node.columns ?? 1),
        groupHeightClass(node, blocks),
        "items-start pt-4",
      )}
    >
      {#each node.children as child, index (child.id)}<PageEditorNode
          node={child}
          {blocks}
          {selected}
          {disabled}
          first={index === 0}
          last={index === node.children.length - 1}
          {dropTarget}
          {onSelect}
          {onAdd}
          {onMove}
          {onMoveOut}
          nested
          {onRemove}
          {onDrag}
          {renderBlock}
        />{/each}
    </div>
    <div class="pt-3">
      <Button
        variant="ghost"
        size="sm"
        {disabled}
        class="text-muted-foreground"
        onclick={() => onAdd(node.id)}><PlusIcon />Add content</Button
      >
    </div>
  {:else}
    <div inert class="min-w-0">{@render renderBlock(node)}</div>
    <button
      type="button"
      class="absolute inset-0 z-10 rounded-xl focus-visible:outline-2 focus-visible:outline-ring"
      {disabled}
      aria-label={`Configure ${blockLabel(node, blocks)}`}
      onclick={() => onSelect(node.id)}
    ></button>
  {/if}
</div>
