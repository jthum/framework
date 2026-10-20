import type { RuleStep } from "../spec/model.ts";

/** Definition-order traversal for preflight, snapshots and diagnostics, not execution scheduling. */
export function* walkRuleSteps(steps: readonly RuleStep[]): Generator<RuleStep> {
  for (const step of steps) {
    yield step;
    if ("gate" in step) {
      yield* walkRuleSteps(step.gate.pass ?? []);
      yield* walkRuleSteps(step.gate.fail ?? []);
    } else if ("wait" in step) {
      yield* walkRuleSteps(step.wait.onSignal ?? []);
      yield* walkRuleSteps(step.wait.onTimeout ?? []);
    } else if ("foreach" in step) yield* walkRuleSteps(step.foreach.steps);
    else if ("repeat" in step) yield* walkRuleSteps(step.repeat.steps);
    else if ("parallel" in step)
      for (const branch of step.parallel.branches) yield* walkRuleSteps(branch.steps);
  }
}
