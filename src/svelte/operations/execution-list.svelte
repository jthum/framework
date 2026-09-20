<script lang="ts">
  import type { RuleExecutionSummary } from "@jthum/framework/kernel";
  import * as Card from "../ui/card/index.js";
  import * as Empty from "../ui/empty/index.js";
  import { Badge } from "../ui/badge/index.js";
  import { Button } from "../ui/button/index.js";
  let { executions, onSelect, page = 0, hasMore = false, onPage, pending = false }: {
    executions: readonly RuleExecutionSummary[];
    onSelect: (execution: RuleExecutionSummary) => void;
    page?: number;
    hasMore?: boolean;
    onPage?: (page: number) => void;
    pending?: boolean;
  } = $props();
</script>

<Card.Root>
  <Card.Header class="gap-0"><Card.Title>Your workflow runs</Card.Title><Card.Description>Runs started by your actor in this workspace.</Card.Description></Card.Header>
  <Card.Content>
    {#if executions.length}
      <ol class="flex flex-col gap-1">{#each executions as execution (execution.id)}
        <li><Button variant="ghost" class="h-auto w-full justify-start gap-3 whitespace-normal px-3 py-3" disabled={pending} onclick={() => onSelect(execution)}><div class="flex min-w-0 flex-1 flex-col gap-1 text-left"><span>{execution.rule.label}</span><span class="text-xs text-muted-foreground">{execution.createdAt.replace("T", " ").replace(".000Z", " UTC")}</span></div><Badge variant={execution.status === "waiting" ? "default" : execution.status === "failed" ? "destructive" : "outline"}>{execution.status}</Badge></Button></li>
      {/each}</ol>
    {:else}<Empty.Root><Empty.Header><Empty.Title>{page ? "No more runs" : "No runs yet"}</Empty.Title><Empty.Description>Start a workflow to see its progress here.</Empty.Description></Empty.Header></Empty.Root>{/if}
  </Card.Content>
  {#if onPage}<Card.Footer class="justify-between gap-3"><p class="text-xs text-muted-foreground">Page {page + 1}</p><div class="flex gap-2"><Button variant="outline" size="sm" disabled={pending || page === 0} onclick={() => onPage?.(page - 1)}>Previous</Button><Button variant="outline" size="sm" disabled={pending || !hasMore} onclick={() => onPage?.(page + 1)}>Next</Button></div></Card.Footer>{/if}
</Card.Root>
