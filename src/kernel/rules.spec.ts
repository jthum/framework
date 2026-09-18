import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type JsonValue, type RuleDefinition, type Spec } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { Kernel } from "./kernel.ts";

describe("Kernel Rules", () => {
  it("provides the injected clock to current-time bindings in short runs", async () => {
    const { kernel, context, spec } = await bootstrap();
    await kernel.applySpec(
      context,
      specWithRules(spec, [
        {
          id: "clock-rule",
          key: "clock_rule",
          label: "Clock Rule",
          steps: [
            {
              id: "clock-step",
              compute: { assign: { now: { $ref: "meta.now" }, today: { $ref: "meta.today" } } },
            },
          ],
        },
      ]),
    );
    const short = await kernel.runRule(context, "clock_rule");
    expect(short.vars.now).toBe(fixedClock.now());
    expect(short.vars.today).toBe(fixedClock.now().slice(0, 10));
    await kernel.close();
  });
  it("keeps authored predicates and Action values valid across Field key renames", async () => {
    const { kernel, context, spec } = await bootstrap();
    await kernel.applySpec(context, specWithRules(spec, [activateRule()]));
    const project = await kernel.createRecord(context, "project", {
      name: "Website",
      status: "draft",
    });
    const current = await kernel.getWorkspace(context);
    if (!current) throw new Error("Workspace unavailable");
    const projectCollection = current.spec.collections[0]!;
    await kernel.applySpec(context, {
      ...current.spec,
      collections: [
        {
          ...projectCollection,
          fields: projectCollection.fields.map((field) =>
            field.id === "field-status" ? { ...field, key: "state", label: "State" } : field,
          ),
        },
      ],
    });

    await kernel.runRule(context, "activate_project", { input: { project: project.id } });

    await expect(kernel.getRecord(context, "project", project.id)).resolves.toMatchObject({
      values: { state: "active" },
    });
  });

  it("executes gates and built-in record Actions through the authorized CRUD spine", async () => {
    expect.hasAssertions();
    const requests: AuthorizationRequest[] = [];
    const { kernel, context, spec } = await bootstrap({
      async authorize(request) {
        requests.push(request);
        return { allowed: true };
      },
    });
    await kernel.applySpec(context, specWithRules(spec, [activateRule()]));
    const project = await kernel.createRecord(context, "project", {
      name: "Website",
      status: "draft",
    });

    const run = await kernel.runRule(context, "activate_project", {
      input: { project: project.id },
    });

    expect(run).toMatchObject({
      ruleId: "rule-activate",
      actorId: context.actorId,
      status: "completed",
      vars: {
        project: { id: project.id, sourceId: "collection-project", status: "draft" },
        updated: { id: project.id, status: "active", updatedBy: context.actorId },
      },
    });
    expect(await kernel.getRecord(context, "project", project.id)).toMatchObject({
      values: { status: "active" },
      updatedBy: context.actorId,
    });
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          operation: "rules.run",
          resource: { kind: "rule", id: "rule-activate", workspaceId: context.workspaceId },
        }),
        expect.objectContaining({ operation: "records.update", context }),
      ]),
    );
  });

  it("keeps nested Rules on the triggering Actor unless an Action explicitly overrides it", async () => {
    expect.hasAssertions();
    const observed: { actorId: string; input: Readonly<Record<string, JsonValue>> }[] = [];
    const { kernel, context, system, spec } = await bootstrap(undefined, [
      {
        key: "tests.capture",
        run({ context: actionContext, input }) {
          observed.push({ actorId: actionContext.actorId, input });
          return { captured: true };
        },
      },
    ]);
    const nested: RuleDefinition = {
      id: "rule-nested",
      key: "nested",
      label: "Nested",
      input: { label: { value: "text", required: true } },
      steps: [
        {
          id: "step-capture",
          action: { key: "tests.capture", input: { label: { $ref: "vars.label" } } },
        },
      ],
    };
    const parent: RuleDefinition = {
      id: "rule-parent",
      key: "parent",
      label: "Parent",
      steps: [
        {
          id: "step-nested",
          invoke: { ruleId: nested.id, input: { label: "inherited" } },
        },
        {
          id: "step-system",
          action: { key: "tests.capture", input: { label: "override" }, runAs: "system" },
        },
      ],
    };
    await kernel.applySpec(context, specWithRules(spec, [parent, nested]));

    await kernel.runRule(context, "parent");

    expect(observed).toEqual([
      { actorId: context.actorId, input: { label: "inherited" } },
      { actorId: system.id, input: { label: "override" } },
    ]);
  });

  it("dispatches matching enabled Rules in stable priority order", async () => {
    expect.hasAssertions();
    const order: string[] = [];
    const { kernel, context, spec } = await bootstrap(undefined, [
      {
        key: "tests.order",
        run({ input }) {
          if (typeof input.label === "string") order.push(input.label);
        },
      },
    ]);
    const triggered = (
      id: string,
      label: string,
      priority: number,
      sourceId = "collection-project",
    ): RuleDefinition => ({
      id,
      key: id.replaceAll("-", "_"),
      label,
      priority,
      trigger: { event: "record.created", sourceId },
      steps: [{ id: `${id}-step`, action: { key: "tests.order", input: { label } } }],
    });
    await kernel.applySpec(
      context,
      specWithRules(spec, [
        triggered("rule-low", "low", 1),
        triggered("rule-high", "high", 10),
        triggered("rule-other", "other", 20, "collection-other"),
        { ...triggered("rule-off", "off", 30), enabled: false },
      ]),
    );

    const runs = await kernel.dispatchEvent(context, {
      event: "record.created",
      sourceId: "collection-project",
      payload: { recordId: "record-1" },
    });

    expect(order).toEqual(["high", "low"]);
    expect(runs.map((run) => run.ruleId)).toEqual(["rule-high", "rule-low"]);
  });

  it("lets a module Action publish a string-key Event without entering the Kernel schema", async () => {
    expect.hasAssertions();
    const messages: JsonValue[] = [];
    const { kernel, context, spec } = await bootstrap(undefined, [
      {
        key: "messages.post",
        async run({ input, publish }) {
          await publish({ event: "message.posted", payload: { text: input.text ?? null } });
        },
      },
      {
        key: "tests.capture",
        run({ input }) {
          messages.push(input.value ?? null);
        },
      },
    ]);
    await kernel.applySpec(
      context,
      specWithRules(spec, [
        {
          id: "rule-message",
          key: "message_received",
          label: "Message received",
          trigger: { event: "message.posted" },
          steps: [
            {
              id: "step-capture-message",
              action: {
                key: "tests.capture",
                input: { value: { $ref: "trigger.payload.text" } },
              },
            },
          ],
        },
      ]),
    );

    await kernel.executeAction(context, "messages.post", { text: "Hello" });

    expect(messages).toEqual(["Hello"]);
  });

  it("publishes record and Form Events from their high-level execution paths", async () => {
    expect.hasAssertions();
    const observed: JsonValue[] = [];
    const { kernel, context, spec } = await bootstrap(undefined, [
      {
        key: "tests.capture",
        run({ input }) {
          observed.push(input.value ?? null);
        },
      },
    ]);
    const recordRule: RuleDefinition = {
      id: "rule-created",
      key: "project_created",
      label: "Project created",
      input: { project: { sourceId: "collection-project", required: true } },
      trigger: { event: "record.created", sourceId: "collection-project" },
      steps: [
        {
          id: "step-record",
          action: { key: "tests.capture", input: { value: { $ref: "vars.project.name" } } },
        },
      ],
    };
    const formRule: RuleDefinition = {
      id: "rule-form",
      key: "intake_submitted",
      label: "Intake submitted",
      trigger: { event: "form.submitted", formId: "form-intake" },
      steps: [
        {
          id: "step-form",
          action: {
            key: "tests.capture",
            input: { value: { $ref: "trigger.payload.values.email" } },
          },
        },
      ],
    };
    await kernel.applySpec(context, {
      ...specWithRules(spec, [recordRule, formRule]),
      forms: [
        {
          id: "form-intake",
          key: "intake",
          label: "Intake",
          mode: "standalone",
          fields: [{ id: "field-email", key: "email", label: "Email", type: "text" }],
        },
      ],
    });

    await kernel.createRecord(context, "project", { name: "Quiet low-level write" });
    await kernel.executeAction(context, "records.create", {
      sourceId: "collection-project",
      values: { "field-name": "Published write" },
    });
    await kernel.submitForm(context, "intake", { values: { email: "jane@example.com" } });

    expect(observed).toEqual(["Published write", "jane@example.com"]);
  });

  it("authorizes custom Actions before invoking their handler", async () => {
    expect.hasAssertions();
    let called = false;
    const { kernel, context } = await bootstrap(
      {
        async authorize(request) {
          return request.operation === "actions.execute" && request.resource.id === "tests.denied"
            ? { allowed: false as const, message: "Denied by test policy." }
            : { allowed: true as const };
        },
      },
      [
        {
          key: "tests.denied",
          run() {
            called = true;
          },
        },
      ],
    );

    await expect(kernel.executeAction(context, "tests.denied")).rejects.toMatchObject({
      code: ERROR_CODES.permissionDenied,
      message: "Denied by test policy.",
    });
    expect(called).toBe(false);
  });

  it("creates an independent local Collection snapshot from a View", async () => {
    expect.hasAssertions();
    const { kernel, context, spec } = await bootstrap();
    await kernel.applySpec(context, {
      ...spec,
      views: [
        {
          id: "view-active-projects",
          key: "active_projects",
          label: "Active projects",
          source: "project",
          query: {
            filter: { path: ["field-status"], operator: "eq", value: "active" },
            select: [
              { path: ["field-name"], as: "name", label: "Project" },
              { path: ["field-budget"], as: "budget", label: "Budget" },
            ],
          },
        },
      ],
    });
    const active = await kernel.createRecord(context, "project", {
      name: "Website",
      status: "active",
      budget: 12_000,
    });
    await kernel.createRecord(context, "project", {
      name: "Later",
      status: "draft",
      budget: 4_000,
    });

    const output = await kernel.executeAction(context, "views.snapshot", {
      viewId: "view-active-projects",
      label: "Quarterly baseline",
      meta: { purpose: "reporting" },
    });

    expect(output).toMatchObject({ collectionKey: "quarterly_baseline", count: 1 });
    const snapshot = await kernel.listRecords(context, "quarterly_baseline");
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]?.values).toEqual({ name: "Website", budget: 12_000 });
    const workspace = await kernel.getWorkspace(context);
    expect(workspace?.spec.collections.at(-1)).toMatchObject({
      key: "quarterly_baseline",
      label: "Quarterly baseline",
      meta: { purpose: "reporting" },
      fields: [
        { key: "name", label: "Project", type: "text" },
        { key: "budget", label: "Budget", type: "number" },
      ],
    });
    await kernel.updateRecord(context, "project", active.id, { name: "Website renamed" });
    expect((await kernel.listRecords(context, "quarterly_baseline"))[0]?.values.name).toBe(
      "Website",
    );
  });

  it("queries Sources and parameterized Views through built-in Actions", async () => {
    const { kernel, context, spec } = await bootstrap();
    await kernel.applySpec(context, {
      ...spec,
      views: [
        {
          id: "view-projects-by-status",
          key: "projects_by_status",
          label: "Projects by status",
          source: "project",
          parameters: [{ key: "status", path: ["field-status"] }],
        },
      ],
    });
    await kernel.createRecord(context, "project", {
      name: "Website",
      status: "active",
      budget: 12_000,
    });
    await kernel.createRecord(context, "project", {
      name: "Later",
      status: "draft",
      budget: 4_000,
    });

    await expect(
      kernel.executeAction(context, "records.list", {
        sourceId: "collection-project",
        query: { filter: { path: ["field-status"], operator: "eq", value: "active" } },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceId: "collection-project",
        name: "Website",
        status: "active",
      }),
    ]);
    await expect(
      kernel.executeAction(context, "views.query", {
        viewId: "view-projects-by-status",
        parameters: { status: "draft" },
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        sourceId: "collection-project",
        name: "Later",
        status: "draft",
      }),
    ]);
    await expect(
      kernel.executeAction(context, "views.query", {
        viewId: "view-projects-by-status",
        parameters: { missing: true },
      }),
    ).rejects.toMatchObject({ code: ERROR_CODES.validationInvalidInput });
  });

  it("rejects durable steps and missing registry contracts instead of silently skipping them", async () => {
    expect.hasAssertions();
    const { kernel, context, spec } = await bootstrap();
    await kernel.applySpec(
      context,
      specWithRules(spec, [
        {
          id: "rule-delay",
          key: "delayed",
          label: "Delayed",
          steps: [{ id: "step-delay", delay: { duration: 60 } }],
        },
        {
          id: "rule-missing",
          key: "missing_action",
          label: "Missing Action",
          steps: [{ id: "step-missing", action: { key: "missing.action" } }],
        },
      ]),
    );

    await expect(kernel.runRule(context, "delayed")).rejects.toMatchObject({
      code: ERROR_CODES.persistenceUnsupported,
    });
    await expect(kernel.runRule(context, "missing_action")).rejects.toMatchObject({
      code: ERROR_CODES.persistenceUnsupported,
      details: {
        diagnostics: [expect.objectContaining({ kind: "action", key: "missing.action" })],
      },
    });
  });
});

async function bootstrap(
  authorizer?: {
    authorize(
      request: AuthorizationRequest,
    ): Promise<{ allowed: true } | { allowed: false; message?: string }>;
  },
  actions: Parameters<typeof Kernel.open>[0]["actions"] = [],
) {
  const kernel = await Kernel.open({
    persistence: new MemoryPersistenceAdapter(),
    ids: sequenceIds(),
    clock: fixedClock,
    ...(authorizer === undefined ? {} : { authorizer }),
    actions,
  });
  const { workspace, user, system } = await kernel.createRootWorkspace({
    name: "Space",
    user: { name: "Jane" },
  });
  const context = { workspaceId: workspace.id, actorId: user.id };
  const spec: Spec = {
    ...createEmptySpec({ id: "spec-projects", key: "projects", label: "Projects" }),
    collections: [
      {
        id: "collection-project",
        key: "project",
        label: "Project",
        fields: [
          { id: "field-name", key: "name", label: "Name", type: "text" },
          { id: "field-status", key: "status", label: "Status", type: "text" },
          { id: "field-budget", key: "budget", label: "Budget", type: "number" },
        ],
      },
    ],
    sources: [{ id: "collection-other", key: "other", label: "Other" }],
  };
  return { kernel, context, system, spec };
}

function activateRule(): RuleDefinition {
  return {
    id: "rule-activate",
    key: "activate_project",
    label: "Activate project",
    input: { project: { sourceId: "collection-project", required: true } },
    steps: [
      {
        id: "step-gate",
        gate: {
          predicate: {
            op: "context.equals",
            left: { $ref: "vars.project", fieldId: "field-status" },
            value: "draft",
          },
          pass: [
            {
              id: "step-update",
              action: {
                key: "records.update",
                input: {
                  record: { $ref: "vars.project" },
                  values: { "field-status": "active" },
                },
                as: "updated",
              },
            },
          ],
        },
      },
    ],
  };
}

function specWithRules(spec: Spec, rules: readonly RuleDefinition[]): Spec {
  return { ...spec, rules };
}

const fixedClock: Clock = { now: () => "2026-09-17T00:00:00.000Z" };

function sequenceIds(): IdGenerator {
  let next = 0;
  return {
    create(kind: IdKind) {
      next += 1;
      return `${kind}-${next}`;
    },
  };
}
