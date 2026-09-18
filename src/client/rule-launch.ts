import { resourceNotFound } from "../errors/error.ts";
import { requiresDurableExecution } from "../kernel/rule-compatibility.ts";
import type { RuleExecutionDetails } from "../kernel/durable-rules.ts";
import type { RuleRun, RunRuleInput } from "../kernel/rules.ts";
import type { WorkspaceClient } from "./workspace-client.ts";

export type RuleLaunch =
  | { readonly mode: "short"; readonly run: RuleRun }
  | { readonly mode: "durable"; readonly execution: RuleExecutionDetails };

/** UI/tool convenience; explicit runRule/startRule remain available to hosts. */
export async function launchRule(
  client: Pick<WorkspaceClient, "listRules" | "runRule" | "startRule">,
  key: string,
  input?: RunRuleInput,
): Promise<RuleLaunch> {
  const rules = await client.listRules();
  const rule = rules.find((item) => item.key === key);
  if (!rule) throw resourceNotFound("Rule", key);
  return requiresDurableExecution(rule, rules)
    ? { mode: "durable", execution: await client.startRule(key, input) }
    : { mode: "short", run: await client.runRule(key, input) };
}
