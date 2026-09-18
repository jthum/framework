import type { ScopeHandle } from "../kernel/model.ts";
import type { RuleDefinition } from "../spec/model.ts";

export interface RuleSubscription {
  readonly workspaceId: string;
  readonly scope?: ScopeHandle;
  readonly event: string;
  readonly ruleId: string;
}

/** Rebuildable trigger index; Rule definitions remain the source of truth. */
export interface RuleSubscriptionStore {
  match(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    event: string,
  ): Promise<RuleSubscription[]>;
  replace(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    rules: readonly RuleDefinition[],
  ): Promise<void>;
  deleteWorkspace(workspaceId: string): Promise<void>;
}

export class MemoryRuleSubscriptionStore implements RuleSubscriptionStore {
  private subscriptions: RuleSubscription[] = [];
  private readonly byEvent = new Map<string, RuleSubscription[]>();

  async match(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    event: string,
  ): Promise<RuleSubscription[]> {
    return structuredClone([
      ...(this.byEvent.get(subscriptionKey(workspaceId, undefined, event)) ?? []),
      ...(scope ? (this.byEvent.get(subscriptionKey(workspaceId, scope, event)) ?? []) : []),
    ]);
  }

  async replace(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    rules: readonly RuleDefinition[],
  ): Promise<void> {
    this.subscriptions = this.subscriptions.filter(
      (item) => item.workspaceId !== workspaceId || !sameOptionalScope(item.scope, scope),
    );
    for (const rule of rules)
      if (rule.trigger)
        this.subscriptions.push({
          workspaceId,
          ...(scope ? { scope: structuredClone(scope) } : {}),
          event: rule.trigger.event,
          ruleId: rule.id,
        });
    this.rebuildIndex();
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    this.subscriptions = this.subscriptions.filter((item) => item.workspaceId !== workspaceId);
    this.rebuildIndex();
  }

  snapshot(): readonly RuleSubscription[] {
    return structuredClone(this.subscriptions);
  }
  restore(value: readonly RuleSubscription[]): void {
    this.subscriptions = structuredClone([...value]);
    this.rebuildIndex();
  }

  private rebuildIndex(): void {
    this.byEvent.clear();
    for (const item of this.subscriptions) {
      const key = subscriptionKey(item.workspaceId, item.scope, item.event);
      const bucket = this.byEvent.get(key) ?? [];
      bucket.push(item);
      this.byEvent.set(key, bucket);
    }
  }
}

function subscriptionKey(
  workspaceId: string,
  scope: ScopeHandle | undefined,
  event: string,
): string {
  return JSON.stringify([workspaceId, scope?.kind ?? null, scope?.id ?? null, event]);
}

function sameScope(left: ScopeHandle, right: ScopeHandle | undefined): boolean {
  return left.kind === right?.kind && left.id === right.id;
}
function sameOptionalScope(left: ScopeHandle | undefined, right: ScopeHandle | undefined): boolean {
  return left === undefined ? right === undefined : sameScope(left, right);
}
