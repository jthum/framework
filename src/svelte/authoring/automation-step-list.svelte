<script lang="ts">
	import AutomationPredicateEditor from "./automation-predicate-editor.svelte";
	import AutomationStepList from "./automation-step-list.svelte";
	import AutomationValueInput, { type AutomationReferenceOption } from "./automation-value-input.svelte";
	import AutomationValueMapEditor from "./automation-value-map-editor.svelte";
	import RequestFields from "./request-fields.svelte";
	import OptionSelect from "../ui/option-select/option-select.svelte";
	import { reorderAtVerticalTarget, startVerticalDrag, type VerticalDragSession, type VerticalDropTarget } from "./vertical-drag.js";
	import * as Collapsible from "@jthum/framework/svelte/ui/collapsible";
	import * as Command from "@jthum/framework/svelte/ui/command";
	import { Button } from "@jthum/framework/svelte/ui/button";
	import * as Card from "@jthum/framework/svelte/ui/card";
	import * as Field from "@jthum/framework/svelte/ui/field";
	import { Input } from "@jthum/framework/svelte/ui/input";
	import { humanStep } from "./rule-labels.js";
	import type { RuleEffect } from "./rule-model.js";
	import { labelFromKey } from "./editor-data.js";
	import type { AutomationPredicate, RuleStep, AutomationValue } from "./rule-model.js";
	import type { EditorContext, RuleDraft, CollectionDraft } from "./authoring.js";
	import ArrowDownIcon from "@lucide/svelte/icons/arrow-down";
	import ArrowUpIcon from "@lucide/svelte/icons/arrow-up";
	import GripVerticalIcon from "@lucide/svelte/icons/grip-vertical";
	import PlusIcon from "@lucide/svelte/icons/plus";
	import Trash2Icon from "@lucide/svelte/icons/trash-2";
	import { onDestroy } from "svelte";
	import { flip } from "svelte/animate";

	let {
		steps,
		onStepsChange,
		inputName,
		inputType,
		inputFields,
		inputLabel,
		recordInput = true,
		types,
		workflows,
		spec,
		depth = 0,
		references = [],
		effects = [],
		actorRequests = false,
	}: {
		steps: RuleStep[];
		onStepsChange: (steps: RuleStep[]) => void;
		inputName: string;
		inputType: string;
		inputFields?: CollectionDraft["fields"];
		inputLabel?: string;
		recordInput?: boolean;
		types: CollectionDraft[];
		workflows: RuleDraft[];
		spec?: EditorContext;
		depth?: number;
		references?: AutomationReferenceOption[];
		effects?: RuleEffect[];
		actorRequests?: boolean;
	} = $props();

	const inputTypeDef = $derived(types.find((type) => type.key === inputType));
	const contextFields = $derived(inputFields ?? inputTypeDef?.fields ?? []);
	const registeredEffects = $derived(effects);
	type PickerCategory = "actions" | "conditions" | "wait" | "loops";
	type StepChoice = { kind: string; label: string; description: string; category: PickerCategory; effectKey?: string };
	const allStepChoices: StepChoice[] = $derived([
		{ kind: "query", label: "Query records", description: "Find records from a type or view.", category: "actions" },
		{ kind: "set", label: "Update current record", description: "Change one or more field values.", category: "actions" },
		{ kind: "create", label: "Create a record", description: "Add a record to a type.", category: "actions" },
		{ kind: "delete", label: "Delete current record", description: "Remove the current record.", category: "actions" },
		{ kind: "compute", label: "Set variables", description: "Calculate values for later steps.", category: "actions" },
		{ kind: "invoke", label: "Run another workflow", description: "Reuse another workflow.", category: "actions" },
		{ kind: "gate", label: "Condition branch", description: "Continue only when a condition passes.", category: "conditions" },
		{ kind: "parallel", label: "Parallel branches", description: "Run independent branches together.", category: "conditions" },
		{ kind: "delay", label: "Wait for a duration", description: "Pause for a fixed amount of time.", category: "wait" },
		{ kind: "wait", label: "Wait for signal", description: "Resume after a signal or timeout.", category: "wait" },
		...(actorRequests ? [{ kind: "request", label: "Ask a user", description: "Collect a response before continuing.", category: "wait" as const }] : []),
		{ kind: "foreach", label: "For each item", description: "Run steps for every item in a list.", category: "loops" },
		{ kind: "repeat", label: "Repeat steps", description: "Run steps a fixed number of times.", category: "loops" },
		...registeredEffects
			.filter((effect) => !["records.query", "records.set", "records.create", "records.delete"].includes(effect.key))
			.map((effect) => ({ kind: "effect", effectKey: effect.key, label: effect.label, description: effect.description ?? `Run the ${effect.label.toLowerCase()} effect.`, category: "actions" as const })),
	]);
	const stepChoices = $derived(
		allStepChoices.filter(
			(choice) => recordInput || (choice.kind !== "set" && choice.kind !== "delete"),
		),
	);
	let pickerOpen = $state(false);
	let pickerCategory = $state<PickerCategory | "all">("all");
	let stepList = $state<HTMLDivElement | null>(null);
	let dragStep = $state<RuleStep | null>(null);
	let dragSession: VerticalDragSession | null = null;
	let sortableIdSeed = 0;
	const sortableIds = new WeakMap<object, string>();
	const baseReferences = $derived(uniqueReferences([
		{ value: "meta.now", label: "Current date and time", group: "Runtime" },
		{ value: "meta.today", label: "Current date", group: "Runtime" },
		{ value: "actor.id", label: "Current actor ID", group: "Runtime" },
		{ value: "trigger.key", label: "Trigger key", group: "Runtime" },
		{ value: `vars.${inputName}`, label: inputLabel ?? inputTypeDef?.label ?? "Current input", group: recordInput ? "Current record" : "Submission" },
		...contextFields.map((field) => ({ value: `vars.${inputName}.${field.key}`, label: field.label, group: recordInput ? "Current record" : "Submission" })),
		...references,
	]));

	function referencesBefore(index: number): AutomationReferenceOption[] {
		const options = [...baseReferences];
		for (const step of steps.slice(0, index)) {
			if ("effect" in step && step.effect.as) options.push({ value: `vars.${step.effect.as}`, label: labelFromKey(step.effect.as), group: "Previous steps" });
			if ("invoke" in step && step.invoke.as) options.push({ value: `vars.${step.invoke.as}`, label: labelFromKey(step.invoke.as), group: "Previous steps" });
			if ("compute" in step) {
				for (const name of Object.keys(step.compute.assign)) options.push({ value: `vars.${name}`, label: labelFromKey(name), group: "Previous steps" });
			}
			if ("wait" in step && step.wait.as) {
				options.push({ value: `vars.${step.wait.as}`, label: labelFromKey(step.wait.as), group: "Previous steps" });
				for (const field of step.wait.request?.fields ?? []) options.push({ value: `vars.${step.wait.as}.${field.key}`, label: field.label, group: "Response fields" });
			}
		}
		return uniqueReferences(options);
	}

	function uniqueReferences(options: AutomationReferenceOption[]): AutomationReferenceOption[] {
		return [...new Map(options.map((option) => [option.value, option])).values()];
	}

	function sortableId(step: RuleStep): string {
		const existing = sortableIds.get(step);
		if (existing) return existing;
		const id = `automation-step-${++sortableIdSeed}`;
		sortableIds.set(step, id);
		return id;
	}

	function startStepDrag(step: RuleStep, event: PointerEvent) {
		const origin = [...steps];
		const key = sortableId(step);
		dragStep = step;
		const handle = event.currentTarget as HTMLElement;
		dragSession = startVerticalDrag({
			event,
			container: stepList,
			item: handle.closest<HTMLElement>("[data-sort-card]"),
			onMove: (clientY) => {
				const target = stepDropTarget(clientY);
				if (target) onStepsChange(reorderAtVerticalTarget(steps, key, target, sortableId));
			},
			onDrop: () => {
				dragSession = null;
				dragStep = null;
			},
			onCancel: () => {
				dragSession = null;
				dragStep = null;
				onStepsChange(origin);
			},
		});
		if (!dragSession) dragStep = null;
	}

	function stepDropTarget(clientY: number): VerticalDropTarget | null {
		if (!stepList) return null;
		const items = [...stepList.children].filter(
			(item): item is HTMLElement => item instanceof HTMLElement && Boolean(item.dataset.sortKey),
		);
		if (!items.length) return null;
		const target = items.reduce((closest, item) => {
			const bounds = item.getBoundingClientRect();
			const distance = Math.abs(clientY - (bounds.top + bounds.height / 2));
			return distance < closest.distance ? { item, distance } : closest;
		}, { item: items[0] as HTMLElement, distance: Number.POSITIVE_INFINITY }).item;
		const bounds = target.getBoundingClientRect();
		return { key: target.dataset.sortKey as string, after: clientY > bounds.top + bounds.height / 2 };
	}

	onDestroy(() => dragSession?.cancel());

	function replace(index: number, step: RuleStep) {
		onStepsChange(steps.map((item, itemIndex) => (itemIndex === index ? step : item)));
	}

	function remove(index: number) {
		onStepsChange(steps.filter((_, itemIndex) => itemIndex !== index));
	}

	function move(index: number, offset: number) {
		const target = index + offset;
		if (target < 0 || target >= steps.length) return;
		const next = [...steps];
		[next[index], next[target]] = [next[target]!, next[index]!];
		onStepsChange(next);
	}

	function add(kind: string, effectKey?: string) {
		let step: RuleStep;
		if (kind === "set") {
			const field = contextFields[0];
			step = {
				effect: {
					key: "records.set",
					params: {
						record: { $ref: `vars.${inputName}` },
						values: field ? { [field.key]: defaultValue(field.type) } : {},
					},
				},
			};
		} else if (kind === "create") {
			const type = types[0]?.key ?? "";
			step = { effect: { key: "records.create", params: { type, fields: matchingCreateFields(type) } } };
		} else if (kind === "delete") {
			step = { effect: { key: "records.delete", params: { record: { $ref: `vars.${inputName}` } } } };
		} else if (kind === "invoke") {
			step = { invoke: { workflow: workflows[0]?.key ?? "" } };
		} else if (kind === "delay") {
			step = { delay: { duration: "5m" } };
		} else if (kind === "query") {
			step = { effect: { key: "records.query", params: { type: types[0]?.key ?? "" }, as: "records" } };
		} else if (kind === "compute") {
			step = { compute: { assign: { result: "" } } };
		} else if (kind === "foreach") {
			step = { foreach: { source: { $ref: "vars.records" }, as: "item", steps: [] } };
		} else if (kind === "repeat") {
			step = { repeat: { times: 3, as: "index", steps: [] } };
		} else if (kind === "parallel") {
			step = { parallel: { join: "all", branches: [{ key: "branch_1", steps: [] }, { key: "branch_2", steps: [] }] } };
		} else if (kind === "wait") {
			step = { wait: { signal: "continue", timeout: "5m", on_timeout: [] } };
		} else if (kind === "request") {
			step = { wait: { request: { label: "Review the request", fields: [] }, as: "response" } };
		} else if (kind === "effect") {
			step = { effect: { key: effectKey ?? registeredEffects[0]?.key ?? "null", params: {} } };
		} else {
			step = {
				gate: {
					predicate: simplePredicate(),
					pass: [],
				},
			};
		}
		onStepsChange([...steps, step]);
	}

	function openPicker(category: PickerCategory | "all") {
		pickerCategory = category;
		pickerOpen = true;
	}

	function chooseStep(choice: StepChoice) {
		add(choice.kind, choice.effectKey);
		pickerOpen = false;
	}

	function createFieldsFor(step: RuleStep): Record<string, AutomationValue> {
		if (!("effect" in step)) return {};
		const fields = step.effect.params?.fields;
		return isObject(fields) ? fields : {};
	}

	function setCreateFields(step: RuleStep, fields: Record<string, AutomationValue>): RuleStep {
		return setEffectParam(step, "fields", fields);
	}

	function matchingCreateFields(typeKey: string): Record<string, AutomationValue> {
		const target = types.find((type) => type.key === typeKey);
		if (!target) return {};
		const inputs = new Map(contextFields.map((field) => [field.key, field]));
		return Object.fromEntries(
			target.fields
				.filter((field) => inputs.get(field.key)?.type === field.type)
				.map((field) => [field.key, { $ref: `vars.${inputName}.${field.key}` }]),
		);
	}

	function setCreateType(step: RuleStep, typeKey: string): RuleStep {
		if (!("effect" in step)) return step;
		return {
			...step,
			effect: {
				...step.effect,
				params: {
					...step.effect.params,
					type: typeKey,
					fields: matchingCreateFields(typeKey),
				},
			},
		};
	}

	function querySource(step: RuleStep): string {
		if (!("effect" in step)) return "";
		if (typeof step.effect.params?.view === "string") return `view:${step.effect.params.view}`;
		return `type:${String(step.effect.params?.type ?? "")}`;
	}

	function setQuerySource(step: RuleStep, source: string): RuleStep {
		if (!("effect" in step)) return step;
		const { type: _type, view: _view, where: _where, ...params } = step.effect.params ?? {};
		const [kind, key] = source.split(":", 2);
		if (!key || (kind !== "view" && kind !== "type")) return step;
		return {
			...step,
			effect: { ...step.effect, params: { ...params, [kind === "view" ? "view" : "type"]: key } },
		};
	}

	function queryFields(step: RuleStep) {
		const source = querySource(step);
		const [kind, key] = source.split(":", 2);
		if (kind === "type") {
			return (types.find((type) => type.key === key)?.fields ?? []).map((field) => ({
				value: field.key,
				label: field.label,
				type: field.type,
				values: field.values,
			}));
		}
		const view = spec?.views.find((candidate) => candidate.key === key);
		return (view?.expose ?? []).map((field) => ({
			value: field.replaceAll(".", "_"),
			label: labelFromKey(field.split(".").at(-1) ?? field),
		}));
	}

	function whereFor(step: RuleStep): Record<string, AutomationValue> {
		if (!("effect" in step)) return {};
		return isObject(step.effect.params?.where) ? step.effect.params.where : {};
	}

	function setEffectAs(step: RuleStep, as: string): RuleStep {
		if (!("effect" in step)) return step;
		return { ...step, effect: { ...step.effect, as: as || undefined } };
	}

	function setRetry(step: RuleStep, raw: string): RuleStep {
		if (!("effect" in step)) return step;
		if (!raw.trim()) {
			const { retry: _retry, ...effect } = step.effect;
			return { ...step, effect };
		}
		const max = Math.max(1, Math.trunc(Number(raw) || 1));
		return { ...step, effect: { ...step.effect, retry: { ...step.effect.retry, max } } };
	}

	function setBackoff(step: RuleStep, raw: string): RuleStep {
		if (!("effect" in step) || !step.effect.retry) return step;
		const backoff = raw.split(",").map((item) => Number(item.trim())).filter((item) => Number.isFinite(item) && item >= 0);
		return { ...step, effect: { ...step.effect, retry: { ...step.effect.retry, backoff } } };
	}

	function setCompensation(step: RuleStep, key: string): RuleStep {
		if (!("effect" in step)) return step;
		if (!key) {
			const { compensate: _compensate, ...effect } = step.effect;
			return { ...step, effect };
		}
		return { ...step, effect: { ...step.effect, compensate: { key, params: step.effect.compensate?.params ?? {} } } };
	}

	function compensationParams(step: RuleStep): Record<string, AutomationValue> {
		if (!("effect" in step)) return {};
		return step.effect.compensate && isObject(step.effect.compensate.params)
			? step.effect.compensate.params
			: {};
	}

	function setCompensationParams(step: RuleStep, params: Record<string, AutomationValue>): RuleStep {
		if (!("effect" in step) || !step.effect.compensate) return step;
		return { ...step, effect: { ...step.effect, compensate: { ...step.effect.compensate, params } } };
	}

	function binding(raw: string): { $ref: string } {
		return { $ref: raw.replace(/^=/, "") };
	}

	function countValue(raw: string): number | { $ref: string } {
		return raw.startsWith("=") ? binding(raw) : Math.max(0, Math.trunc(Number(raw) || 0));
	}

	function simplePredicate(): AutomationPredicate {
		return {
			op: "context.equals",
			path: `vars.${inputName}.${contextFields[0]?.key ?? "id"}`,
			value: "",
		};
	}

	function defaultValue(type?: string): AutomationValue {
		if (type === "boolean") return false;
		if (type === "number") return 0;
		return "";
	}

	function valuesFor(step: RuleStep): Record<string, AutomationValue> {
		if (!("effect" in step)) return {};
		const values = step.effect.params?.values;
		return isObject(values) ? values : {};
	}

	function setAssignment(step: RuleStep, oldKey: string, nextKey: string, value: AutomationValue): RuleStep {
		if (!("effect" in step)) return step;
		const nextValues = { ...valuesFor(step) };
		delete nextValues[oldKey];
		if (nextKey) nextValues[nextKey] = value;
		return {
			...step,
			effect: {
				...step.effect,
				params: { ...step.effect.params, values: nextValues },
			},
		};
	}

	function setEffectParam(step: RuleStep, key: string, value: AutomationValue): RuleStep {
		if (!("effect" in step)) return step;
		return {
			...step,
			effect: { ...step.effect, params: { ...step.effect.params, [key]: value } },
		};
	}

	function setEffectParams(step: RuleStep, params: Record<string, AutomationValue>): RuleStep {
		if (!("effect" in step)) return step;
		return { ...step, effect: { ...step.effect, params } };
	}

	function isObject(value: unknown): value is Record<string, AutomationValue> {
		return value !== null && typeof value === "object" && !Array.isArray(value) && !("$ref" in value);
	}

	function isBinding(value: unknown): value is { $ref: string } {
		return value !== null && typeof value === "object" && !Array.isArray(value) && "$ref" in value;
	}

	function displayValue(value: AutomationValue): string {
		return isBinding(value) && value.$ref === "meta.now" ? "now" : isBinding(value) && value.$ref === "meta.today" ? "today" : String(value ?? "");
	}

	type StepCategory = "action" | "condition" | "loop" | "wait" | "data";

	function stepCategory(step: RuleStep): StepCategory {
		if ("gate" in step || "parallel" in step) return "condition";
		if ("foreach" in step || "repeat" in step) return "loop";
		if ("delay" in step || "wait" in step) return "wait";
		if ("compute" in step || ("effect" in step && step.effect.key === "records.query")) return "data";
		return "action";
	}

	function categoryLabel(step: RuleStep): string {
		const category = stepCategory(step);
		if (category === "condition") return "Branch";
		if (category === "loop") return "Loop";
		if (category === "wait") return "Pause";
		if (category === "data") return "Data";
		return "Action";
	}
</script>

<div class="flex min-w-0 flex-col" bind:this={stepList}>
	{#each steps as step, index (index)}
		<div data-sort-card data-sort-key={sortableId(step)} animate:flip={{ duration: 160 }} class="min-w-0" class:opacity-40={dragStep === step}>
			<Card.Root size="sm">
				<Card.Header class="flex flex-row items-center gap-2">
					<Button size="icon-sm" variant="ghost" aria-label="Drag to reorder step" class="cursor-grab touch-none active:cursor-grabbing" onpointerdown={(event) => startStepDrag(step, event)}><GripVerticalIcon /></Button>
					<div class="min-w-0">
						<p class="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{categoryLabel(step)} · Step {index + 1}</p>
						<p class="truncate text-sm font-medium">{humanStep(step, spec)}</p>
					</div>
					<div class="ml-auto flex shrink-0 items-center gap-0.5">
						<Button size="icon-xs" variant="ghost" aria-label="Move step up" disabled={index === 0} onclick={() => move(index, -1)}>
							<ArrowUpIcon />
						</Button>
						<Button size="icon-xs" variant="ghost" aria-label="Move step down" disabled={index === steps.length - 1} onclick={() => move(index, 1)}>
							<ArrowDownIcon />
						</Button>
						<Button size="icon-xs" variant="ghost" aria-label="Remove step" onclick={() => remove(index)}>
							<Trash2Icon />
						</Button>
					</div>
				</Card.Header>

				<Card.Content>
			{#if "effect" in step && step.effect.key === "records.set"}
				<div class="flex min-w-0 flex-col gap-2">
					{#if isBinding(step.effect.params?.record) && step.effect.params.record.$ref !== `vars.${inputName}`}
						<p class="text-xs text-muted-foreground">Target: <code>{step.effect.params.record.$ref}</code></p>
					{/if}
					{#each Object.entries(valuesFor(step)) as [fieldKey, value] (fieldKey)}
						{@const field = contextFields.find((item) => item.key === fieldKey)}
						<div class="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-2">
							<OptionSelect
								value={fieldKey}
								onValueChange={(next) => replace(index, setAssignment(step, fieldKey, next, value))}
								options={[
									...contextFields.map((field) => ({ value: field.key, label: field.label })),
									...(contextFields.some((field) => field.key === fieldKey) ? [] : [{ value: fieldKey, label: labelFromKey(fieldKey) }]),
								]}
								placeholder="Field"
							/>
							{#if isBinding(value) && value.$ref !== "meta.now" && value.$ref !== "meta.today"}
								<div class="flex h-9 items-center rounded-md border bg-muted/40 px-3 font-mono text-xs text-muted-foreground">
									{value.$ref}
								</div>
							{:else if field?.type === "enum"}
								<OptionSelect
									value={displayValue(value)}
									onValueChange={(next) => replace(index, setAssignment(step, fieldKey, fieldKey, next))}
									options={(field.values ?? []).map((item) => ({ value: item, label: labelFromKey(item) }))}
								/>
							{:else if field?.type === "boolean"}
								<OptionSelect
									value={displayValue(value)}
									onValueChange={(next) => replace(index, setAssignment(step, fieldKey, fieldKey, next === "true"))}
									options={[
										{ value: "true", label: "Yes" },
										{ value: "false", label: "No" },
									]}
								/>
							{:else}
								<AutomationValueInput
									{value}
									onValueChange={(next) => replace(index, setAssignment(step, fieldKey, fieldKey, next))}
									references={referencesBefore(index)}
									type={field?.type}
									placeholder="Value"
								/>
							{/if}
							<Button size="icon-xs" variant="ghost" aria-label={`Remove ${field?.label ?? fieldKey}`} onclick={() => replace(index, setAssignment(step, fieldKey, "", value))}><Trash2Icon /></Button>
						</div>
					{/each}
					{#if contextFields.some((field) => !Object.hasOwn(valuesFor(step), field.key))}
						<Button
							variant="outline"
							size="sm"
							class="w-fit"
							onclick={() => {
								const field = contextFields.find((item) => !Object.hasOwn(valuesFor(step), item.key));
								if (field) replace(index, setAssignment(step, "", field.key, defaultValue(field.type)));
							}}
						>
							<PlusIcon data-icon="inline-start" /> Add field
						</Button>
					{/if}
				</div>
			{:else if "effect" in step && step.effect.key === "records.create"}
				{@const createdType = types.find((type) => type.key === String(step.effect.params?.type ?? ""))}
				<Field.Group>
					<Field.Field>
						<Field.Label>Record type</Field.Label>
						<OptionSelect
							value={String(step.effect.params?.type ?? "")}
							onValueChange={(next) => replace(index, setCreateType(step, next))}
							options={types.map((type) => ({ value: type.key, label: type.label }))}
							placeholder="Record type"
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label>Field mapping</Field.Label>
						<AutomationValueMapEditor
							values={createFieldsFor(step)}
							onValuesChange={(fields) => replace(index, setCreateFields(step, fields))}
							keys={(createdType?.fields ?? []).map((field) => ({ value: field.key, label: field.label, type: field.type, values: field.values }))}
							keyPlaceholder="Field"
							references={referencesBefore(index)}
						/>
						<Field.Description>Compatible fields with matching keys are connected automatically. Use the value picker to map the rest.</Field.Description>
					</Field.Field>
				</Field.Group>
			{:else if "effect" in step && step.effect.key === "records.query"}
				<Field.Group>
					<Field.Field>
						<Field.Label>Query</Field.Label>
						<OptionSelect
							value={querySource(step)}
							onValueChange={(source) => replace(index, setQuerySource(step, source))}
							options={[
								...types.map((type) => ({ value: `type:${type.key}`, label: `All ${type.collection_label ?? type.label}` })),
								...(spec?.views ?? []).map((view) => ({ value: `view:${view.key}`, label: `View: ${view.label}` })),
							]}
						/>
					</Field.Field>
					<Field.Field>
						<Field.Label>Result name</Field.Label>
						<Input value={step.effect.as ?? ""} oninput={(event) => replace(index, setEffectAs(step, event.currentTarget.value))} placeholder="records" />
					</Field.Field>
					<Field.Field>
						<Field.Label>Additional filters</Field.Label>
						<AutomationValueMapEditor values={whereFor(step)} onValuesChange={(where) => replace(index, setEffectParam(step, "where", where))} keys={queryFields(step)} keyPlaceholder="Field" references={referencesBefore(index)} />
					</Field.Field>
				</Field.Group>
			{:else if "compute" in step}
				<AutomationValueMapEditor values={step.compute.assign} onValuesChange={(assign) => replace(index, { ...step, compute: { assign } })} keyPlaceholder="Variable name" references={referencesBefore(index)} />
			{:else if "invoke" in step}
				<Field.Group>
					<Field.Field><Field.Label>Workflow</Field.Label><OptionSelect value={step.invoke.workflow} onValueChange={(next) => replace(index, { ...step, invoke: { ...step.invoke, workflow: next } })} options={workflows.map((workflow) => ({ value: workflow.key, label: workflow.label }))} placeholder="Workflow" /></Field.Field>
					<Field.Field><Field.Label>Inputs</Field.Label><AutomationValueMapEditor values={step.invoke.input ?? {}} onValuesChange={(input) => replace(index, { ...step, invoke: { ...step.invoke, input } })} keyPlaceholder="Input name" references={referencesBefore(index)} /></Field.Field>
					<Field.Field><Field.Label>Result name</Field.Label><Input value={step.invoke.as ?? ""} oninput={(event) => replace(index, { ...step, invoke: { ...step.invoke, as: event.currentTarget.value || undefined } })} placeholder="Optional variable name" /></Field.Field>
				</Field.Group>
			{:else if "delay" in step}
				<Field.Group><Field.Field><Field.Label>Duration</Field.Label><Input value={String(step.delay.duration)} oninput={(event) => replace(index, { ...step, delay: { duration: event.currentTarget.value } })} placeholder="5 minutes or 2 hours" /></Field.Field></Field.Group>
			{:else if "gate" in step}
				<div class="flex min-w-0 flex-col gap-4">
					<AutomationPredicateEditor
						predicate={step.gate.predicate}
						onPredicateChange={(predicate) => replace(index, { ...step, gate: { ...step.gate, predicate } })}
						{inputName}
						type={inputTypeDef}
						fields={contextFields}
						references={referencesBefore(index)}
					/>
					<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-primary/4 p-3 ring-1 ring-primary/12">
						<div class="flex items-center gap-2">
							<span class="size-2 rounded-full bg-primary" aria-hidden="true"></span>
							<p class="text-xs font-semibold">Yes · condition matches</p>
						</div>
						<AutomationStepList {actorRequests} {effects}
							steps={step.gate.pass ?? []}
							onStepsChange={(pass) => replace(index, { ...step, gate: { ...step.gate, pass } })}
							{inputName}
							{inputType}
							{inputFields}
							{inputLabel}
							{recordInput}
							{types}
							{workflows}
							{spec}
							references={referencesBefore(index)}
							depth={depth + 1}
						/>
					</div>
					{#if step.gate.fail}
						<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/45 p-3 ring-1 ring-foreground/8">
							<div class="flex items-center gap-2">
								<span class="size-2 rounded-full bg-muted-foreground/50" aria-hidden="true"></span>
								<p class="text-xs font-semibold">No · condition does not match</p>
							</div>
							<AutomationStepList {actorRequests} {effects}
								steps={step.gate.fail}
								onStepsChange={(fail) => replace(index, { ...step, gate: { ...step.gate, fail } })}
								{inputName}
								{inputType}
								{inputFields}
								{inputLabel}
								{recordInput}
								{types}
								{workflows}
								{spec}
								references={referencesBefore(index)}
								depth={depth + 1}
							/>
						</div>
					{:else}
						<Button
							variant="ghost"
							size="sm"
							class="w-fit"
							onclick={() => replace(index, { ...step, gate: { ...step.gate, fail: [] } })}
						>
							<PlusIcon data-icon="inline-start" /> Add “if no” branch
						</Button>
					{/if}
				</div>
			{:else if "foreach" in step}
				<div class="flex min-w-0 flex-col gap-4">
					<Field.Group class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<Field.Field><Field.Label>List reference</Field.Label><AutomationValueInput value={step.foreach.source} onValueChange={(next) => replace(index, { ...step, foreach: { ...step.foreach, source: isBinding(next) ? next : binding(String(next)) } })} references={referencesBefore(index)} placeholder="=vars.records" /></Field.Field>
						<Field.Field><Field.Label>Item name</Field.Label><Input value={step.foreach.as ?? "item"} oninput={(event) => replace(index, { ...step, foreach: { ...step.foreach, as: event.currentTarget.value || undefined } })} /></Field.Field>
						<Field.Field><Field.Label>Maximum items</Field.Label><Input type="number" min="1" value={step.foreach.max ?? ""} oninput={(event) => replace(index, { ...step, foreach: { ...step.foreach, max: event.currentTarget.value ? Math.max(1, Math.trunc(event.currentTarget.valueAsNumber || 1)) : undefined } })} placeholder="1000" /></Field.Field>
						<Field.Field><Field.Label>On failure</Field.Label><OptionSelect value={step.foreach.on_item_failure ?? "stop"} onValueChange={(next) => replace(index, { ...step, foreach: { ...step.foreach, on_item_failure: next as "stop" | "continue" } })} options={[{ value: "stop", label: "Stop workflow" }, { value: "continue", label: "Continue" }]} /></Field.Field>
					</Field.Group>
					<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-chart-2/5 p-3 ring-1 ring-chart-2/12">
						<p class="text-xs font-semibold">For each item, run</p>
						<AutomationStepList {actorRequests} {effects} steps={step.foreach.steps} onStepsChange={(childSteps) => replace(index, { ...step, foreach: { ...step.foreach, steps: childSteps } })} {inputName} {inputType} {inputFields} {inputLabel} {recordInput} {types} {workflows} {spec} references={[...referencesBefore(index), { value: `vars.${step.foreach.as ?? "item"}`, label: labelFromKey(step.foreach.as ?? "item"), group: "Loop" }]} depth={depth + 1} />
					</div>
				</div>
			{:else if "repeat" in step}
				<div class="flex min-w-0 flex-col gap-4">
					<Field.Group class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						<Field.Field><Field.Label>Times</Field.Label><AutomationValueInput value={step.repeat.times} onValueChange={(next) => replace(index, { ...step, repeat: { ...step.repeat, times: typeof next === "number" || isBinding(next) ? next : countValue(String(next)) } })} references={referencesBefore(index)} type="number" /></Field.Field>
						<Field.Field><Field.Label>Index name</Field.Label><Input value={step.repeat.as ?? "index"} oninput={(event) => replace(index, { ...step, repeat: { ...step.repeat, as: event.currentTarget.value || undefined } })} /></Field.Field>
						<Field.Field><Field.Label>Maximum repeats</Field.Label><Input type="number" min="1" value={step.repeat.max ?? ""} oninput={(event) => replace(index, { ...step, repeat: { ...step.repeat, max: event.currentTarget.value ? Math.max(1, Math.trunc(event.currentTarget.valueAsNumber || 1)) : undefined } })} placeholder="1000" /></Field.Field>
						<Field.Field><Field.Label>On failure</Field.Label><OptionSelect value={step.repeat.on_item_failure ?? "stop"} onValueChange={(next) => replace(index, { ...step, repeat: { ...step.repeat, on_item_failure: next as "stop" | "continue" } })} options={[{ value: "stop", label: "Stop workflow" }, { value: "continue", label: "Continue" }]} /></Field.Field>
					</Field.Group>
					<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-chart-2/5 p-3 ring-1 ring-chart-2/12">
						<p class="text-xs font-semibold">On every repetition, run</p>
						<AutomationStepList {actorRequests} {effects} steps={step.repeat.steps} onStepsChange={(childSteps) => replace(index, { ...step, repeat: { ...step.repeat, steps: childSteps } })} {inputName} {inputType} {inputFields} {inputLabel} {recordInput} {types} {workflows} {spec} references={[...referencesBefore(index), { value: `vars.${step.repeat.as ?? "index"}`, label: labelFromKey(step.repeat.as ?? "index"), group: "Loop" }]} depth={depth + 1} />
					</div>
				</div>
			{:else if "parallel" in step}
				<div class="flex min-w-0 flex-col gap-4">
					<Field.Field><Field.Label>Continue when</Field.Label><OptionSelect value={step.parallel.join ?? "all"} onValueChange={(join) => replace(index, { ...step, parallel: { ...step.parallel, join: join as "all" | "any" } })} options={[{ value: "all", label: "All branches finish" }, { value: "any", label: "Any branch finishes" }]} /></Field.Field>
					{#each step.parallel.branches as branch, branchIndex (branchIndex)}
						<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-chart-4/4 p-3 ring-1 ring-chart-4/12">
							<div class="flex items-center gap-2">
								<Input class="max-w-52" value={branch.key ?? `branch_${branchIndex + 1}`} oninput={(event) => replace(index, { ...step, parallel: { ...step.parallel, branches: step.parallel.branches.map((item, itemIndex) => itemIndex === branchIndex ? { ...item, key: event.currentTarget.value || undefined } : item) } })} aria-label="Branch name" />
								<Button class="ml-auto" size="icon-xs" variant="ghost" aria-label="Remove branch" disabled={step.parallel.branches.length === 1} onclick={() => replace(index, { ...step, parallel: { ...step.parallel, branches: step.parallel.branches.filter((_, itemIndex) => itemIndex !== branchIndex) } })}><Trash2Icon /></Button>
							</div>
							<AutomationStepList {actorRequests} {effects} steps={branch.steps} onStepsChange={(childSteps) => replace(index, { ...step, parallel: { ...step.parallel, branches: step.parallel.branches.map((item, itemIndex) => itemIndex === branchIndex ? { ...item, steps: childSteps } : item) } })} {inputName} {inputType} {inputFields} {inputLabel} {recordInput} {types} {workflows} {spec} references={referencesBefore(index)} depth={depth + 1} />
						</div>
					{/each}
					<Button variant="ghost" size="sm" class="w-fit" onclick={() => replace(index, { ...step, parallel: { ...step.parallel, branches: [...step.parallel.branches, { key: `branch_${step.parallel.branches.length + 1}`, steps: [] }] } })}><PlusIcon data-icon="inline-start" /> Add branch</Button>
				</div>
			{:else if "wait" in step}
				<div class="flex min-w-0 flex-col gap-4">
					<Field.Group class="grid gap-3 sm:grid-cols-3">
						{#if !step.wait.request}<Field.Field><Field.Label>Signal</Field.Label><Input value={step.wait.signal ?? ""} oninput={(event) => replace(index, { ...step, wait: { ...step.wait, signal: event.currentTarget.value || undefined } })} placeholder="Signal key" /></Field.Field>{/if}
						<Field.Field><Field.Label>Timeout</Field.Label><Input value={String(step.wait.timeout ?? "")} oninput={(event) => replace(index, { ...step, wait: { ...step.wait, timeout: event.currentTarget.value || undefined } })} placeholder="Optional, e.g. 5m or 1d" /></Field.Field>
						<Field.Field><Field.Label>Result name</Field.Label><Input value={step.wait.as ?? ""} oninput={(event) => replace(index, { ...step, wait: { ...step.wait, as: event.currentTarget.value || undefined } })} placeholder="Optional" /></Field.Field>
					</Field.Group>
					{#if step.wait.request}
						{@const request = step.wait.request}
						<Field.Group>
							<Field.Field><Field.Label>Request title</Field.Label><Input value={request.label} oninput={(event) => replace(index, { ...step, wait: { ...step.wait, request: { ...request, label: event.currentTarget.value } } })} /></Field.Field>
							<Field.Field><Field.Label>Assigned actor binding</Field.Label><Input value={request.actor ?? ""} oninput={(event) => replace(index, { ...step, wait: { ...step.wait, request: { ...request, actor: event.currentTarget.value.trim() || undefined } } })} placeholder="Current actor" /><Field.Description>Leave empty for the actor who started the workflow. An override names a runtime actor binding; the assignee must be a User.</Field.Description></Field.Field>
						</Field.Group>
						<RequestFields fields={request.fields} {types} onChange={(fields) => replace(index, { ...step, wait: { ...step.wait, request: { ...request, fields } } })} />
						{#if step.wait.as}<p class="text-xs text-muted-foreground">Use vars.{step.wait.as}.&lt;field key&gt; in later conditions or actions.</p>{/if}
					{/if}
					{#if step.wait.signal || step.wait.request}
						<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/45 p-3 ring-1 ring-foreground/8"><p class="text-xs font-semibold">{step.wait.request ? "When the response arrives" : "When the signal arrives"}</p><AutomationStepList {actorRequests} {effects} steps={step.wait.on_signal ?? []} onStepsChange={(childSteps) => replace(index, { ...step, wait: { ...step.wait, on_signal: childSteps } })} {inputName} {inputType} {inputFields} {inputLabel} {recordInput} {types} {workflows} {spec} references={referencesBefore(index + 1)} depth={depth + 1} /></div>
					{/if}
					{#if step.wait.timeout !== undefined}
						<div class="flex min-w-0 flex-col gap-3 rounded-xl bg-muted/45 p-3 ring-1 ring-foreground/8"><p class="text-xs font-semibold">If the wait times out</p><AutomationStepList {actorRequests} {effects} steps={step.wait.on_timeout ?? []} onStepsChange={(childSteps) => replace(index, { ...step, wait: { ...step.wait, on_timeout: childSteps } })} {inputName} {inputType} {inputFields} {inputLabel} {recordInput} {types} {workflows} {spec} references={referencesBefore(index)} depth={depth + 1} /></div>
					{/if}
				</div>
			{:else if "effect" in step && step.effect.key === "records.delete"}
				<p class="text-xs text-muted-foreground">Deletes the current {inputTypeDef?.label?.toLowerCase() ?? "record"}.</p>
			{:else if "effect" in step}
				<Field.Group>
					<Field.Field><Field.Label>Effect</Field.Label><OptionSelect value={step.effect.key} onValueChange={(key) => replace(index, { ...step, effect: { ...step.effect, key } })} options={[...registeredEffects.map((effect) => ({ value: effect.key, label: effect.label })), ...(registeredEffects.some((effect) => effect.key === step.effect.key) ? [] : [{ value: step.effect.key, label: labelFromKey(step.effect.key) }])]} placeholder="Effect" /></Field.Field>
					<Field.Field><Field.Label>Parameters</Field.Label><AutomationValueMapEditor values={isObject(step.effect.params) ? step.effect.params : {}} onValuesChange={(params) => replace(index, setEffectParams(step, params))} references={referencesBefore(index)} /></Field.Field>
				</Field.Group>
			{/if}

			{#if "effect" in step}
				<Collapsible.Root class="mt-3 border-t pt-2">
					<Collapsible.Trigger class="text-xs font-medium text-muted-foreground hover:text-foreground">Reliability and output</Collapsible.Trigger>
					<Collapsible.Content class="pt-3">
						<Field.Group>
							{#if step.effect.key !== "records.query"}
								<Field.Field>
									<Field.Label>Output variable</Field.Label>
									<Input value={step.effect.as ?? ""} oninput={(event) => replace(index, setEffectAs(step, event.currentTarget.value))} placeholder="Optional result name" />
								</Field.Field>
							{/if}
							<div class="grid gap-3 sm:grid-cols-2">
								<Field.Field>
									<Field.Label>Maximum attempts</Field.Label>
									<Input type="number" min="1" value={step.effect.retry?.max ?? ""} oninput={(event) => replace(index, setRetry(step, event.currentTarget.value))} placeholder="1" />
								</Field.Field>
								<Field.Field data-disabled={!step.effect.retry}>
									<Field.Label>Retry delays</Field.Label>
									<Input disabled={!step.effect.retry} value={step.effect.retry?.backoff?.join(", ") ?? ""} oninput={(event) => replace(index, setBackoff(step, event.currentTarget.value))} placeholder="Seconds: 1, 5, 15" />
								</Field.Field>
							</div>
							<Field.Field>
								<Field.Label>On rollback</Field.Label>
								<OptionSelect
									value={step.effect.compensate?.key ?? ""}
									onValueChange={(key) => replace(index, setCompensation(step, key))}
									options={[
										{ value: "", label: "No compensation" },
										{ value: "records.create", label: "Create record" },
										{ value: "records.set", label: "Update record" },
										{ value: "records.delete", label: "Delete record" },
										...(step.effect.compensate && !["records.create", "records.set", "records.delete"].includes(step.effect.compensate.key)
											? [{ value: step.effect.compensate.key, label: labelFromKey(step.effect.compensate.key) }]
											: []),
									]}
								/>
							</Field.Field>
							{#if step.effect.compensate}
								<Field.Field><Field.Label>Rollback parameters</Field.Label><AutomationValueMapEditor values={compensationParams(step)} onValuesChange={(params) => replace(index, setCompensationParams(step, params))} references={referencesBefore(index)} /></Field.Field>
							{/if}
						</Field.Group>
					</Collapsible.Content>
				</Collapsible.Root>
			{/if}
				</Card.Content>
			</Card.Root>
			{#if index < steps.length - 1}
				<div class="ml-[2.15rem] flex h-5 items-center" aria-hidden="true">
					<div class="h-full w-px bg-border"></div>
				</div>
			{/if}
		</div>
	{/each}

	{#if steps.length > 0}
		<div class="ml-[2.15rem] h-3 w-px bg-border" aria-hidden="true"></div>
	{/if}
	{#if depth === 0}
		<Card.Root size="sm">
			<Card.Header class="gap-0">
				<Card.Title>Add a step</Card.Title>
				<Card.Description>Choose the kind of work this workflow should do next.</Card.Description>
			</Card.Header>
			<Card.Content class="grid grid-cols-1 gap-3 sm:grid-cols-2">
				<Button variant="outline" class="h-auto min-h-20 flex-col items-start justify-start gap-0.5 whitespace-normal p-4 text-left" onclick={() => openPicker("actions")}>
					<span>Do something</span><span class="text-xs font-normal text-muted-foreground">Records, effects, or workflows</span>
				</Button>
				<Button variant="outline" class="h-auto min-h-20 flex-col items-start justify-start gap-0.5 whitespace-normal p-4 text-left" onclick={() => openPicker("conditions")}>
					<span>Add logic</span><span class="text-xs font-normal text-muted-foreground">Conditions or parallel paths</span>
				</Button>
				<Button variant="outline" class="h-auto min-h-20 flex-col items-start justify-start gap-0.5 whitespace-normal p-4 text-left" onclick={() => openPicker("wait")}>
					<span>Wait</span><span class="text-xs font-normal text-muted-foreground">For time or a signal</span>
				</Button>
				<Button variant="outline" class="h-auto min-h-20 flex-col items-start justify-start gap-0.5 whitespace-normal p-4 text-left" onclick={() => openPicker("loops")}>
					<span>Loop</span><span class="text-xs font-normal text-muted-foreground">For each item or repeat</span>
				</Button>
			</Card.Content>
			<Card.Footer><Button variant="ghost" size="sm" onclick={() => openPicker("all")}><PlusIcon data-icon="inline-start" /> Browse all steps</Button></Card.Footer>
		</Card.Root>
	{:else}
		<Button variant="outline" size="sm" class="w-fit" onclick={() => openPicker("all")}><PlusIcon data-icon="inline-start" /> Add step</Button>
	{/if}
</div>

<Command.Dialog bind:open={pickerOpen} title="Add a workflow step" description="Search or choose the next step in this workflow." showCloseButton>
	<Command.Input placeholder="Search steps…" />
	<Command.List>
		<Command.Empty>No matching steps.</Command.Empty>
		{#each ["actions", "conditions", "wait", "loops"] as category (category)}
			{#if pickerCategory === "all" || pickerCategory === category}
				<Command.Group heading={{ actions: "Actions", conditions: "Logic", wait: "Wait", loops: "Loops" }[category]}>
					{#each stepChoices.filter((choice) => choice.category === category) as choice (`${choice.kind}:${choice.effectKey ?? choice.label}`)}
						<Command.Item value={`${choice.label} ${choice.description}`} onSelect={() => chooseStep(choice)}>
							<div class="flex min-w-0 flex-col"><span>{choice.label}</span><span class="truncate text-xs text-muted-foreground">{choice.description}</span></div>
						</Command.Item>
					{/each}
				</Command.Group>
			{/if}
		{/each}
	</Command.List>
</Command.Dialog>
