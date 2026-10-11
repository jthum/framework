<script lang="ts">
	import * as Table from "../../svelte/ui/table/index.ts";
	let { variant = "default" }: { variant?: "default" | "inset" } = $props();
</script>

<Table.Root {variant} class="host-table" aria-label="Invoices">
	<Table.Caption>Recent invoices</Table.Caption>
	<Table.Header>
		<Table.Row>
			<Table.Head aria-sort="ascending">Invoice</Table.Head>
			<Table.Head class="text-end">Amount</Table.Head>
		</Table.Row>
	</Table.Header>
	<Table.Body>
		<Table.Row data-state="selected">
			<Table.Cell>INV-001</Table.Cell>
			<Table.Cell class="text-end">120</Table.Cell>
		</Table.Row>
	</Table.Body>
	<Table.Footer>
		<Table.Row><Table.Cell colspan={2}>Total 120</Table.Cell></Table.Row>
	</Table.Footer>
</Table.Root>
