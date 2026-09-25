<script lang="ts">
  import type { PresentedError } from "./error-presentation.ts";

  let { error }: { error: PresentedError } = $props();
</script>

<div role="alert">
  <p class="text-sm text-destructive">{error.message}</p>
  <p class="mt-1 font-mono text-xs text-muted-foreground">
    {error.code}{error.errorId ? ` · ${error.errorId}` : ""}
  </p>
</div>
