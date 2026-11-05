<script lang="ts" generics="T extends PersonRow">
  import type { Snippet } from "svelte";
  import type { PersonRow } from "./data.js";
  import { accessLabel } from "./data.js";
  import * as Table from "../ui/table/index.js";
  import * as Avatar from "../ui/avatar/index.js";
  import * as Empty from "../ui/empty/index.js";
  import { Badge } from "../ui/badge/index.js";
  import { Button } from "../ui/button/index.js";
  import { Spinner } from "../ui/spinner/index.js";
  import { OptionSelect } from "../ui/option-select/index.js";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";

  let { people, total, offset = 0, limit = 25, loading = false, selfId, onPageChange, onLimitChange, onManage, canManage = () => true, avatar, secondary, detail, detailLabel = "Details", accessHeading = "Access" }:
    { people: readonly T[]; total: number; offset?: number; limit?: number; loading?: boolean; selfId?: string;
      onPageChange: (offset: number) => void; onLimitChange?: (limit: number) => void;
      onManage?: (person: T) => void; canManage?: (person: T) => boolean;
      avatar?: Snippet<[T]>; secondary?: Snippet<[T]>; detail?: Snippet<[T]>; detailLabel?: string; accessHeading?: string } = $props();
  const sizeId = $props.id();
</script>

<div class="flex flex-col gap-4" aria-busy={loading}>
  <Table.Root>
    <Table.Header><Table.Row>
      <Table.Head>Person</Table.Head><Table.Head>{accessHeading}</Table.Head>
      {#if detail}<Table.Head>{detailLabel}</Table.Head>{/if}
      {#if onManage}<Table.Head><span class="sr-only">Actions</span></Table.Head>{/if}
    </Table.Row></Table.Header>
    <Table.Body>
      {#each people as person (person.actor.id)}
        <Table.Row>
          <Table.Cell><div class="flex items-center gap-3">
            {#if avatar}{@render avatar(person)}{:else}
              <Avatar.Root><Avatar.Fallback>{person.actor.name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase()}</Avatar.Fallback></Avatar.Root>
            {/if}
            <div class="min-w-0"><div class="flex items-center gap-2"><span class="truncate font-medium">{person.actor.name}</span>{#if person.actor.id === selfId}<Badge variant="outline">You</Badge>{/if}</div>
              <div class="text-sm text-muted-foreground">{#if secondary}{@render secondary(person)}{:else}{person.actor.email ?? (person.actor.kind === "user" ? "User" : person.actor.kind === "agent" ? "Agent" : "System")}{/if}</div>
            </div>
          </div></Table.Cell>
          <Table.Cell><Badge variant={person.permissions.includes("manage") ? "default" : "outline"}>{accessLabel(person.permissions)}</Badge></Table.Cell>
          {#if detail}<Table.Cell>{@render detail(person)}</Table.Cell>{/if}
          {#if onManage}<Table.Cell class="text-right"><Button variant="outline" size="sm" disabled={loading || !canManage(person)} onclick={() => onManage?.(person)} aria-label={`Manage access for ${person.actor.name}`}>Manage</Button></Table.Cell>{/if}
        </Table.Row>
      {:else}
        <Table.Row><Table.Cell colspan={2 + Number(Boolean(detail)) + Number(Boolean(onManage))}>
          {#if loading}<div class="flex items-center justify-center gap-2 py-12"><Spinner />Loading people</div>{:else}
            <Empty.Root><Empty.Header><Empty.Title>No matching people</Empty.Title><Empty.Description>Try another search or change your filters.</Empty.Description></Empty.Header></Empty.Root>
          {/if}
        </Table.Cell></Table.Row>
      {/each}
    </Table.Body>
  </Table.Root>
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-muted-foreground" aria-live="polite">{#if loading}Loading…{:else if total === 0}0 people{:else}{offset + 1}–{Math.min(offset + people.length, total)} of {total} people{/if}</p>
    <div class="flex items-center gap-2">
      {#if onLimitChange}<label for={sizeId} class="sr-only">People per page</label><OptionSelect id={sizeId} value={String(limit)} options={[25, 50, 100].map((value) => ({ value: String(value), label: `${value} per page` }))} disabled={loading} onValueChange={(value) => onLimitChange?.(Number(value))} />{/if}
      <Button variant="outline" size="icon" aria-label="Previous page" disabled={loading || offset === 0} onclick={() => onPageChange(Math.max(0, offset - limit))}><ChevronLeftIcon /></Button>
      <Button variant="outline" size="icon" aria-label="Next page" disabled={loading || offset + limit >= total} onclick={() => onPageChange(offset + limit)}><ChevronRightIcon /></Button>
    </div>
  </div>
</div>
