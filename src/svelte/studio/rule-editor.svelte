<script lang="ts">
	import AutomationPredicateEditor from "./automation-predicate-editor.svelte";
	import AutomationStepList from "./automation-step-list.svelte";
	import AutomationValueMapEditor from "./automation-value-map-editor.svelte";
	import OptionSelect from "./option-select.svelte";
	import EditorActions from "./editor-actions.svelte";
	import PageHeader from "./page-header.svelte";
	import StatusPill from "./status-pill.svelte";
	import * as AlertDialog from "@jthum/framework/svelte/ui/alert-dialog";
	import * as Alert from "@jthum/framework/svelte/ui/alert";
	import { Badge } from "@jthum/framework/svelte/ui/badge";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { Switch } from "@jthum/framework/svelte/ui/switch";
	import * as ToggleGroup from "@jthum/framework/svelte/ui/toggle-group";
	import { cn } from "@jthum/framework/svelte/utils";
	import { stableStringify } from "./editor-data.js";
	import type { EditorContext } from "./authoring.js";
	import type { RuleActions, RuleEffect, RuleCompatibility } from "./rule-model.js";
	import type { AutomationPredicate, AutomationValue } from "./rule-model.js";
	import { labelFromKey } from "./editor-data.js";
	import { cloneData, type Exposure, type RuleDraft, type RuleStep } from "./authoring.js";
	import CircleAlertIcon from "@lucide/svelte/icons/circle-alert";
	import CircleCheckIcon from "@lucide/svelte/icons/circle-check";
	import FilterIcon from "@lucide/svelte/icons/list-filter";
	import { toast } from "svelte-sonner";

	let { rule: workflow, context: spec, actions, onDeleted, effects = [], actorRequests = false, checkCompatibility, class: className }: {
		rule: RuleDraft; context: EditorContext; actions: RuleActions;
		class?: string;
		onDeleted: () => void | Promise<void>;
		effects?: RuleEffect[];
		actorRequests?: boolean;
		checkCompatibility?: (rule: RuleDraft) => RuleCompatibility;
	} = $props();
	const types = $derived(spec?.collections ?? []);
	const forms = $derived(spec?.forms ?? []);
	const workflows = $derived(spec?.rules ?? []);

	let initializedWorkflow = $state("");
	let label = $state("");
	let description = $state("");
	let enabled = $state(true);
	let kind = $state<"manual" | "automatic">("automatic");
	let inputName = $state("");
	let inputType = $state("");
	let inputEditable = $state(true);
	let preserveMissingInput = $state(false);
	let triggerEvent = $state("field");
	let triggerField = $state("");
	let triggerForm = $state("");
	let triggerCustom = $state(false);
	let triggerKey = $state("");
	let triggerConfig = $state<Record<string, AutomationValue>>({});
	let guardEnabled = $state(false);
	let guardPredicate = $state<AutomationPredicate>({ op: "always" });
	let steps = $state<RuleStep[]>([]);
	let exposeUi = $state(true);
	let exposeAgent = $state(true);
	let deleteOpen = $state(false);
	let saving = $state(false);

	const submittedForm = $derived(forms.find((form) => form.key === triggerForm));
	const formTrigger = $derived(kind === "automatic" && triggerEvent === "form");
	const contextInputName = $derived(formTrigger ? "values" : inputName);
	const contextFields = $derived.by(() => {
		if (!formTrigger) return undefined;
		if (submittedForm?.mode === "standalone") return submittedForm.inputs ?? [];
		const source = types.find((type) => type.key === submittedForm?.type);
		const selected = new Set(submittedForm?.fields ?? []);
		return source?.fields.filter((field) => !selected.size || selected.has(field.key)) ?? [];
	});
	const inputTypeDef = $derived(types.find((type) => type.key === inputType));

	$effect(() => {
		const identity = `${workflow.id}:${workflow.key}`;
		if (initializedWorkflow === identity) return;
		initializedWorkflow = identity;
		label = workflow.label;
		description = workflow.description ?? "";
		enabled = workflow.enabled ?? true;
		kind = workflow.trigger ? "automatic" : "manual";
		const inputs = Object.entries(workflow.input ?? {});
		const [name, definition] = inputs[0] ?? [];
		inputEditable = inputs.length <= 1 && (!definition || ("record" in definition && definition.required !== false));
		const triggerType = types.find((type) => workflow.trigger?.key.startsWith(`${type.key}.`))?.key;
		inputName = name ?? triggerType ?? types[0]?.key ?? "record";
		inputType = definition && "record" in definition ? definition.record : inputName;
		const parsedTrigger = parseTrigger(workflow.trigger?.key ?? "", inputType);
		triggerCustom = Boolean(workflow.trigger && !parsedTrigger);
		preserveMissingInput = inputs.length === 0 && triggerCustom;
		triggerKey = workflow.trigger?.key ?? "";
		triggerConfig = cloneData(workflow.trigger?.config ?? {});
		if (parsedTrigger) {
			triggerEvent = parsedTrigger.event;
			triggerField = parsedTrigger.field ?? "";
			triggerForm = parsedTrigger.form ?? "";
		}
		const entryGate = extractEntryGate(workflow.steps);
		guardEnabled = Boolean(entryGate);
		guardPredicate = cloneData(entryGate?.predicate ?? simplePredicate(inputName, inputType));
		steps = cloneData(entryGate?.steps ?? workflow.steps);
		exposeUi = workflow.expose?.includes("ui") ?? kind === "manual";
		exposeAgent = workflow.expose?.includes("agent") ?? true;
	});

	const compiledSteps = $derived.by((): RuleStep[] => {
		const actions = cloneData(steps);
		return guardEnabled ? [{ gate: { predicate: cloneData(guardPredicate), pass: actions } }] : actions;
	});
	const compiledTrigger = $derived.by(() => {
		if (kind !== "automatic") return undefined;
		if (triggerCustom) return triggerKey ? { key: triggerKey, ...(Object.keys(triggerConfig).length ? { config: triggerConfig } : {}) } : undefined;
		const key = standardTriggerKey();
		return key
			? {
					key,
					...(triggerEvent === "form" && triggerForm ? { config: { form: triggerForm } } : {}),
				}
			: undefined;
	});
	const compiledExpose = $derived.by((): Exposure[] | undefined => {
		const expose: Exposure[] = [
			...(kind === "manual" && exposeUi ? (["ui"] as const) : []),
			...(exposeAgent ? (["agent"] as const) : []),
		];
		return expose.length ? expose : undefined;
	});
	const draft = $derived({
		...workflow,
		label,
		description: description || undefined,
		enabled,
		input: formTrigger
			? { values: { value: "object" } }
			: preserveMissingInput
			? workflow.input
			: inputEditable && inputType
				? { [inputName || inputType]: { record: inputType } }
				: workflow.input,
		trigger: compiledTrigger,
		expose: compiledExpose,
		steps: compiledSteps,
	} as RuleDraft);
	const compatibility = $derived(checkCompatibility?.(draft) ?? { diagnostics: [] });
	const dirty = $derived(stableStringify(draft) !== stableStringify(workflow));
	function simplePredicate(name: string, typeKey: string): AutomationPredicate {
		const type = types.find((item) => item.key === typeKey);
		return { op: "context.equals", path: `vars.${name || typeKey}.${type?.fields[0]?.key ?? "id"}`, value: "" };
	}
	function extractEntryGate(source: RuleStep[]): { predicate: AutomationPredicate; steps: RuleStep[] } | undefined {
		const first = source[0];
		if (source.length !== 1 || !first || !("gate" in first) || first.id || first.gate.fail !== undefined) return undefined;
		return { predicate: first.gate.predicate, steps: first.gate.pass ?? [] };
	}
	function parseTrigger(
		key: string,
		typeKey: string,
	): { event: string; field?: string; form?: string } | undefined {
		if (!key) return undefined;
		if (key === "form.submitted") {
			const form = typeof workflow.trigger?.config?.form === "string" ? workflow.trigger.config.form : "";
			return { event: "form", form };
		}
		if (key === `${typeKey}.created`) return { event: "created" };
		if (key === `${typeKey}.changed`) return { event: "changed" };
		if (key === `${typeKey}.deleted`) return { event: "deleted" };
		const match = new RegExp(`^${escapeRegex(typeKey)}\\.([^.]+)\\.changed$`).exec(key);
		return match ? { event: "field", field: match[1] } : undefined;
	}
	function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
	function standardTriggerKey(): string | undefined {
		if (triggerEvent === "form") return triggerForm ? "form.submitted" : undefined;
		if (!inputType) return undefined;
		if (triggerEvent === "created") return `${inputType}.created`;
		if (triggerEvent === "deleted") return `${inputType}.deleted`;
		if (triggerEvent === "field") return triggerField ? `${inputType}.${triggerField}.changed` : undefined;
		return `${inputType}.changed`;
	}
	function setTriggerEvent(next: string) {
		triggerEvent = next;
		if (next === "form") {
			triggerForm ||= forms.find((form) => form.mode === "standalone")?.key ?? forms[0]?.key ?? "";
			const first = forms.find((form) => form.key === triggerForm)?.inputs?.[0];
			guardPredicate = {
				op: "context.equals",
				path: `vars.values.${first?.key ?? "value"}`,
				value: "",
			};
		} else if (inputType === "values" || !types.some((type) => type.key === inputType)) {
			setInputType(types[0]?.key ?? "");
		}
	}
	function setTriggerForm(next: string) {
		triggerForm = next;
		if (guardEnabled) return;
		const form = forms.find((item) => item.key === next);
		const source = types.find((type) => type.key === form?.type);
		const selected = new Set(form?.fields ?? []);
		const first =
			form?.mode === "standalone"
				? form.inputs?.[0]
				: source?.fields.find((field) => !selected.size || selected.has(field.key));
		guardPredicate = {
			op: "context.equals",
			path: `vars.values.${first?.key ?? "value"}`,
			value: "",
		};
	}
	function setWorkflowKind(next: string) {
		kind = next as "manual" | "automatic";
		if (kind === "manual" && !types.some((type) => type.key === inputType)) {
			inputEditable = true;
			preserveMissingInput = false;
			setInputType(types[0]?.key ?? "");
		}
	}
	function setInputType(next: string) {
		const previousName = inputName;
		preserveMissingInput = false;
		inputType = next;
		inputName = next;
		guardPredicate = replaceBindingRoot(guardPredicate, previousName, next);
		steps = replaceVariableRoot(steps, previousName, next);
	}
	function replaceVariableRoot<T>(value: T, previous: string, next: string): T {
		if (Array.isArray(value)) return value.map((item) => replaceVariableRoot(item, previous, next)) as T;
		if (!value || typeof value !== "object") return value;
		const source = value as Record<string, unknown>;
		return Object.fromEntries(
			Object.entries(source).map(([key, item]) => {
				if ((key === "$ref" || key === "path") && typeof item === "string" && item.startsWith(`vars.${previous}.`)) {
					return [key, `vars.${next}.${item.split(".").slice(2).join(".")}`];
				}
				return [key, replaceVariableRoot(item, previous, next)];
			}),
		) as T;
	}
	function replaceBindingRoot(predicate: AutomationPredicate, previous: string, next: string): AutomationPredicate {
		const raw = predicate as Record<string, unknown>;
		if (Array.isArray(raw.all)) return { all: (raw.all as AutomationPredicate[]).map((item) => replaceBindingRoot(item, previous, next)) };
		if (Array.isArray(raw.any)) return { any: (raw.any as AutomationPredicate[]).map((item) => replaceBindingRoot(item, previous, next)) };
		if (raw.not && typeof raw.not === "object") return { not: replaceBindingRoot(raw.not as AutomationPredicate, previous, next) };
		const path = typeof raw.path === "string" ? raw.path : "";
		return path.startsWith(`vars.${previous}.`)
			? { ...predicate, path: `vars.${next}.${path.split(".").slice(2).join(".")}` }
			: predicate;
	}
	async function save() {
		if (saving) return;
		saving = true;
		try {
			await actions.save(cloneData(draft));
			toast.success("Saved");
		} catch (error) {
			toast.error(error instanceof Error ? error.message : "Could not save workflow");
		} finally {
			saving = false;
		}
	}
	async function remove() {
		await actions.remove(workflow.key);
		toast.success("Deleted");
		await onDeleted();
	}
</script>

<div class={cn("flex flex-col gap-6", className)}>
	<PageHeader title={label || workflow.label} description="Configure when this workflow runs, what it checks, and what happens next." />

	<div class="mx-auto flex w-full max-w-4xl flex-col gap-5 sm:gap-6">
		<Card.Root>
			<Card.Header class="gap-0">
				<Card.Title>Workflow details</Card.Title>
				<Card.Description>Give this workflow a clear name and choose whether it can run.</Card.Description>
				<Card.Action>
					{#if enabled}
						<Badge>Active</Badge>
					{:else}
						<StatusPill path="status" value="Paused" tone="warning" />
					{/if}
				</Card.Action>
			</Card.Header>
			<Card.Content>
				<Field.Group>
					<Field.Field><Field.Label>Name</Field.Label><Input bind:value={label} placeholder={kind === "manual" ? "Mark invoice paid" : "Record paid date"} /></Field.Field>
					<Field.Field><Field.Label>Description</Field.Label><Input bind:value={description} placeholder="What this workflow does" /></Field.Field>
					<Field.Field orientation="horizontal" class="justify-between rounded-xl border bg-muted/30 p-3">
						<div class="flex flex-col gap-0.5">
							<Field.Label class="font-medium">This workflow is {enabled ? "on" : "off"}</Field.Label>
							<Field.Description>{enabled ? "It will run whenever its trigger and conditions match." : "It stays saved, but nothing will run until you turn it on."}</Field.Description>
						</div>
						<Switch bind:checked={enabled} aria-label={enabled ? "Disable workflow" : "Enable workflow"} />
					</Field.Field>
				</Field.Group>
			</Card.Content>
		</Card.Root>

		<div class="relative flex flex-col gap-5 sm:gap-6">
			<div class="absolute bottom-0 left-5 top-10 hidden w-px bg-primary/20 sm:block"></div>

			<section class="grid min-w-0 gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4">
				<div class="relative hidden size-10 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground sm:flex">1</div>
			<Card.Root>
				<Card.Header class="gap-0">
					<Card.Title>When</Card.Title>
					<Card.Description>{kind === "manual" ? "Configure a workflow that runs on demand." : "Choose the trigger that starts this workflow."}</Card.Description>
				</Card.Header>
				<Card.Content>
					<Field.Group class="gap-4">
						<Field.FieldSet>
							<Field.FieldLegend>How should this workflow start?</Field.FieldLegend>
							<ToggleGroup.Root type="single" value={kind} onValueChange={(value) => value && setWorkflowKind(value)} variant="card" size="card" spacing={2} class="grid w-full grid-cols-1 sm:grid-cols-2">
								<ToggleGroup.Item value="automatic">
									<span class="mt-0.5 flex size-4 shrink-0 rounded-full border group-data-[state=on]/toggle:border-primary">
										<span class="m-auto size-2 rounded-full bg-primary opacity-0 group-data-[state=on]/toggle:opacity-100"></span>
									</span>
									<span class="flex min-w-0 flex-col gap-0.5"><span>Something happens</span><span class="text-xs font-normal text-muted-foreground">An event, schedule, or webhook starts it.</span></span>
								</ToggleGroup.Item>
								<ToggleGroup.Item value="manual">
									<span class="mt-0.5 flex size-4 shrink-0 rounded-full border group-data-[state=on]/toggle:border-primary">
										<span class="m-auto size-2 rounded-full bg-primary opacity-0 group-data-[state=on]/toggle:opacity-100"></span>
									</span>
									<span class="flex min-w-0 flex-col gap-0.5"><span>Run manually</span><span class="text-xs font-normal text-muted-foreground">A person, agent, or API starts it.</span></span>
								</ToggleGroup.Item>
							</ToggleGroup.Root>
						</Field.FieldSet>
						{#if kind === "automatic" && !triggerCustom}
							<Field.Field>
								<Field.Label>Event</Field.Label>
								<OptionSelect value={triggerEvent} onValueChange={setTriggerEvent} options={[{ value: "created", label: "A record is added" }, { value: "changed", label: "A record changes" }, { value: "field", label: "A field changes" }, { value: "deleted", label: "A record is deleted" }, { value: "form", label: "A form is submitted" }]} />
							</Field.Field>
						{/if}
						<Field.Field>
							<Field.Label>{kind === "manual" ? "Show on" : triggerEvent === "form" ? "Form" : "Watch"}</Field.Label>
							{#if kind === "automatic" && triggerEvent === "form"}
								<OptionSelect value={triggerForm} onValueChange={setTriggerForm} options={forms.map((form) => ({ value: form.key, label: form.label }))} placeholder="Select a form" />
							{:else}
								<OptionSelect value={inputType} onValueChange={setInputType} options={types.map((type) => ({ value: type.key, label: type.label }))} disabled={!inputEditable} />
							{/if}
							{#if !inputEditable && !formTrigger}<Field.Description>Structured inputs are preserved from the spec.</Field.Description>{/if}
						</Field.Field>
						{#if kind === "automatic"}
							{#if triggerCustom}
								<Field.Field><Field.Label>Trigger key</Field.Label><Input bind:value={triggerKey} /><Field.Description>Portable registry key, such as schedule.cron or webhook.received.</Field.Description></Field.Field>
								<Field.Field><Field.Label>Trigger configuration</Field.Label><AutomationValueMapEditor values={triggerConfig} onValuesChange={(config) => (triggerConfig = config)} keyPlaceholder="Setting" /></Field.Field>
							{:else}
								{#if triggerEvent === "field"}
									<Field.Field><Field.Label>Field</Field.Label><OptionSelect bind:value={triggerField} options={(inputTypeDef?.fields ?? []).map((field) => ({ value: field.key, label: field.label }))} placeholder="Select a field" /></Field.Field>
								{/if}
							{/if}
						{/if}
					</Field.Group>
				</Card.Content>
				<Card.Footer>
					<Field.Group class={cn("grid w-full gap-4", kind === "manual" ? "sm:grid-cols-2" : "sm:grid-cols-1")}>
						{#if kind === "manual"}
							<Field.Field orientation="horizontal"><Switch bind:checked={exposeUi} /><div><Field.Label class="font-normal">Record button</Field.Label><Field.Description>Show when a record is open.</Field.Description></div></Field.Field>
						{/if}
						<Field.Field orientation="horizontal"><Switch bind:checked={exposeAgent} /><div><Field.Label class="font-normal">Agent tool</Field.Label><Field.Description>Allow agent invocation.</Field.Description></div></Field.Field>
					</Field.Group>
				</Card.Footer>
			</Card.Root>
			</section>

			<section class="grid min-w-0 gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4">
				<div class="relative hidden size-10 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground sm:flex">2</div>
			<Card.Root>
				<Card.Header class="gap-0">
					<div class="flex items-center justify-between gap-3"><div class="flex flex-col gap-0"><Card.Title>If</Card.Title><Card.Description>Optionally limit when this workflow continues.</Card.Description></div><Switch bind:checked={guardEnabled} aria-label="Use entry condition" /></div>
				</Card.Header>
				{#if guardEnabled}
					<Card.Content><AutomationPredicateEditor predicate={guardPredicate} onPredicateChange={(next) => (guardPredicate = next)} inputName={contextInputName} type={inputTypeDef} fields={contextFields} inputLabel={submittedForm?.label} /></Card.Content>
				{:else}
					<Card.Content>
						<Alert.Root class="border-primary/15 bg-primary/5">
							<CircleCheckIcon />
							<Alert.Title>No extra conditions</Alert.Title>
							<Alert.Description>This workflow continues every time its trigger matches.</Alert.Description>
							<Alert.Action><Button variant="outline" size="sm" onclick={() => (guardEnabled = true)}><FilterIcon data-icon="inline-start" /> Only run when…</Button></Alert.Action>
						</Alert.Root>
					</Card.Content>
				{/if}
			</Card.Root>
			</section>

			<section class="grid min-w-0 gap-3 sm:grid-cols-[2.5rem_minmax(0,1fr)] sm:gap-4">
				<div class="relative hidden size-10 items-center justify-center rounded-full border border-primary bg-primary text-sm font-semibold text-primary-foreground sm:flex">3</div>
			<Card.Root>
				<Card.Header class="gap-0"><Card.Title>Then</Card.Title><Card.Description>Actions run from top to bottom. Conditions can branch into more steps.</Card.Description></Card.Header>
				<Card.Content><AutomationStepList {actorRequests} {effects} {steps} onStepsChange={(next) => (steps = next)} inputName={contextInputName} {inputType} inputFields={contextFields} inputLabel={submittedForm?.label} recordInput={!formTrigger && Boolean(inputTypeDef)} {types} workflows={workflows.filter((item) => item.key !== workflow.key)} {spec} /></Card.Content>
				</Card.Root>
			</section>
		</div>

		{#if compatibility.diagnostics.length}
			<div class="sm:pl-14">
				<Alert.Root>
					<CircleAlertIcon />
					<Alert.Title>Runtime compatibility</Alert.Title>
					<Alert.Description>
						<p>This workflow is portable, but the current runtime has limits.</p>
						{#each compatibility.diagnostics as item (item.capability)}
							<div class="flex items-start gap-2 text-xs"><Badge variant="outline">{labelFromKey(item.support)}</Badge><p class="pt-0.5 text-muted-foreground">{item.message}</p></div>
						{/each}
					</Alert.Description>
				</Alert.Root>
			</div>
		{/if}

		<div class="sm:pl-14">
			<EditorActions {dirty} {saving} onSave={save}>
				{#snippet left()}
					<Button variant="destructive-outline" size="sm" onclick={() => (deleteOpen = true)}>Delete workflow</Button>
				{/snippet}
			</EditorActions>
		</div>
	</div>
</div>

<AlertDialog.Root bind:open={deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header><AlertDialog.Title>Delete {workflow.label}?</AlertDialog.Title><AlertDialog.Description>The button or automation is removed. Records stay.</AlertDialog.Description></AlertDialog.Header>
		<AlertDialog.Footer><AlertDialog.Cancel>Cancel</AlertDialog.Cancel><AlertDialog.Action variant="destructive" onclick={remove}>Delete</AlertDialog.Action></AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
