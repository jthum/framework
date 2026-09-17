import { describe, expect, it } from "vite-plus/test";
import { ERROR_CODES } from "../errors/error.ts";
import { MemoryPersistenceAdapter } from "../persistence/memory.ts";
import { createEmptySpec, type JsonValue, type RuleDefinition, type Spec } from "../spec/model.ts";
import type { AuthorizationRequest } from "./authorization.ts";
import type { Clock, IdGenerator, IdKind } from "./defaults.ts";
import { Kernel } from "./kernel.ts";

describe("Kernel Rules", () => {
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
  authorizer?: { authorize(request: AuthorizationRequest): Promise<{ allowed: true }> },
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
          predicate: { op: "context.equals", path: "vars.project.status", value: "draft" },
          pass: [
            {
              id: "step-update",
              action: {
                key: "records.update",
                input: {
                  record: { $ref: "vars.project" },
                  values: { status: "active" },
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
