import type { SpecMeta } from "@jthum/framework/spec";
interface SpecNode {
  id: string;
  meta?: SpecMeta;
}

export interface AutomationBinding {
  $ref: string;
}

export type AutomationValue =
  | null
  | boolean
  | number
  | string
  | AutomationBinding
  | AutomationValue[]
  | { [key: string]: AutomationValue };

export type AutomationPredicate =
  | { all: AutomationPredicate[] }
  | { any: AutomationPredicate[] }
  | { not: AutomationPredicate }
  | AutomationCondition;

export type AutomationCondition = { op: string } & Record<string, AutomationValue>;

export type AutomationInput =
  | { record: string; required?: boolean }
  | {
      value: "text" | "number" | "boolean" | "date" | "object" | "array";
      required?: boolean;
      default?: AutomationValue;
    };

export interface AutomationTrigger {
  /** Stable registry key, for example `invoice.status.changed` or `schedule.cron`. */
  key: string;
  config?: Record<string, AutomationValue>;
}

export interface AutomationRetry {
  /** Total attempts, including the initial attempt. */
  max: number;
  /** Delay in seconds before each retry. Browser runtimes may emulate this in-session. */
  backoff?: number[];
}

export interface AutomationEffectCall {
  key: string;
  params?: Record<string, AutomationValue>;
}

export interface AutomationEffect extends AutomationEffectCall {
  as?: string;
  retry?: AutomationRetry;
  compensate?: AutomationEffectCall;
}

interface StepIdentity {
  /** Optional stable identity for traces, retries, waits, and idempotency. */
  id?: string;
}

export type RuleStep =
  | (StepIdentity & {
      gate: {
        predicate: AutomationPredicate;
        pass?: RuleStep[];
        fail?: RuleStep[];
      };
    })
  | (StepIdentity & { compute: { assign: Record<string, AutomationValue> } })
  | (StepIdentity & { effect: AutomationEffect })
  | (StepIdentity & {
      invoke: { workflow: string; input?: Record<string, AutomationValue>; as?: string };
    })
  | (StepIdentity & { delay: { duration: number | string } })
  | (StepIdentity & {
      wait: {
        signal?: string;
        timeout?: number | string;
        as?: string;
        on_signal?: RuleStep[];
        on_timeout?: RuleStep[];
      };
    })
  | (StepIdentity & {
      foreach: {
        source: AutomationBinding;
        as?: string;
        max?: number;
        on_item_failure?: "stop" | "continue";
        steps: RuleStep[];
      };
    })
  | (StepIdentity & {
      repeat: {
        times: number | AutomationBinding;
        as?: string;
        max?: number;
        on_item_failure?: "stop" | "continue";
        steps: RuleStep[];
      };
    })
  | (StepIdentity & {
      parallel: {
        branches: Array<{ key?: string; steps: RuleStep[] }>;
        join?: "all" | "any";
      };
    });

export interface RuleDraft extends SpecNode {
  key: string;
  label: string;
  description?: string;
  enabled?: boolean;
  priority?: number;
  input?: Record<string, AutomationInput>;
  trigger?: AutomationTrigger;
  expose?: Array<"ui" | "agent">;
  steps: RuleStep[];
}
