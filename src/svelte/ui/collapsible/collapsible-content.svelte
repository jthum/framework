<script lang="ts">
	import { Collapsible as CollapsiblePrimitive } from "bits-ui";
	import { cn } from "../../utils.js";

	let { ref = $bindable(null), class: className, ...restProps }: CollapsiblePrimitive.ContentProps = $props();
</script>

<CollapsiblePrimitive.Content
  bind:ref
  data-slot="collapsible-content"
  class={cn("overflow-hidden duration-180 ease-[cubic-bezier(0.22,1,0.36,1)] data-open:animate-collapsible-down data-closed:animate-collapsible-up motion-reduce:animate-none", className)}
  {...restProps}
/>
