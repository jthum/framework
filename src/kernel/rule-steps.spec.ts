import { describe, expect, it } from "vite-plus/test";
import type { RuleDefinition, RuleStep } from "../spec/model.ts";
import {
  requiredRuleActions,
  requiredRuleCapabilities,
  requiredRuleConditions,
  requiresDurableExecution,
} from "./rule-compatibility.ts";
import { walkRuleSteps } from "./rule-steps.ts";

const steps: readonly RuleStep[] = [
  {
    id: "gate",
    gate: {
      predicate: { op: "always" },
      pass: [
        {
          id: "foreach",
          foreach: {
            source: { $ref: "vars.items" },
            steps: [
              {
                id: "repeat",
                repeat: {
                  times: 1,
                  steps: [{ id: "nested-action", action: { key: "nested.action" } }],
                },
              },
            ],
          },
        },
      ],
      fail: [
        {
          id: "parallel",
          parallel: {
            branches: [
              {
                id: "one",
                steps: [
                  {
                    id: "wait",
                    wait: {
                      signal: "ready",
                      timeout: "1m",
                      onSignal: [{ id: "invoke", invoke: { ruleId: "nested" } }],
                      onTimeout: [
                        {
                          id: "timeout-gate",
                          gate: {
                            predicate: { not: { op: "custom.condition" } },
                            pass: [{ id: "timeout-action", action: { key: "timeout.action" } }],
                          },
                        },
                      ],
                    },
                  },
                ],
              },
              { id: "two", steps: [{ id: "compute", compute: { assign: { done: true } } }] },
            ],
          },
        },
      ],
    },
  },
  {
    id: "last",
    action: {
      key: "last.action",
      retry: { max: 2 },
      compensate: { key: "undo.action", runAs: "system" },
    },
  },
];
const rule: RuleDefinition = { id: "root", key: "root", label: "Root", steps };

describe("shared Rule definition traversal", () => {
  it("visits every container and both wait outcomes in definition order without changing them", () => {
    const before = structuredClone(steps);
    const visited = [...walkRuleSteps(steps)];
    expect(visited.map((step) => step.id)).toEqual([
      "gate",
      "foreach",
      "repeat",
      "nested-action",
      "parallel",
      "wait",
      "invoke",
      "timeout-gate",
      "timeout-action",
      "compute",
      "last",
    ]);
    expect(visited[0]).toBe(steps[0]);
    expect(steps).toEqual(before);
    expect(requiredRuleActions(rule)).toEqual([
      "nested.action",
      "timeout.action",
      "last.action",
      "undo.action",
    ]);
    expect(requiredRuleConditions(rule)).toEqual(["always", "custom.condition"]);
    expect(requiredRuleCapabilities(rule)).toEqual([
      "loops",
      "parallel",
      "signals",
      "durable_waits",
      "nested_rules",
      "retries",
      "compensation",
      "run_as",
    ]);
  });

  it("follows invoked Rules once through cycles and still finds later waits", () => {
    const root: RuleDefinition = { ...rule, steps: [{ id: "call", invoke: { ruleId: "nested" } }] };
    const nested: RuleDefinition = {
      id: "nested",
      key: "nested",
      label: "Nested",
      steps: [{ id: "back", invoke: { ruleId: "root" } }],
    };
    expect(requiresDurableExecution(root, [root, nested])).toBe(false);
    expect(
      requiresDurableExecution(root, [
        root,
        { ...nested, steps: [...nested.steps, { id: "pause", delay: { duration: "1s" } }] },
      ]),
    ).toBe(true);
  });
});
