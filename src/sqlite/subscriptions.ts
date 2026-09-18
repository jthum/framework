import type { ScopeHandle } from "../kernel/model.ts";
import type { RuleSubscription, RuleSubscriptionStore } from "../persistence/subscriptions.ts";
import type { RuleDefinition } from "../spec/model.ts";
import type { SqliteConnection } from "./gateway.ts";

interface Row {
  workspace_id: string;
  scope_kind: string | null;
  scope_id: string | null;
  event: string;
  rule_id: string;
}

export class SqliteRuleSubscriptionStore implements RuleSubscriptionStore {
  constructor(private readonly connection: SqliteConnection) {}
  async match(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    event: string,
  ): Promise<RuleSubscription[]> {
    const rows = await this.connection.all<Row>(
      "SELECT * FROM rule_subscriptions WHERE workspace_id = ? AND event = ? AND (scope_kind IS NULL OR (scope_kind = ? AND scope_id = ?)) ORDER BY rowid",
      [workspaceId, event, scope?.kind ?? null, scope?.id ?? null],
    );
    return rows.map((row) => ({
      workspaceId,
      ...(row.scope_kind && row.scope_id
        ? { scope: { kind: row.scope_kind, id: row.scope_id } }
        : {}),
      event: row.event,
      ruleId: row.rule_id,
    }));
  }
  async replace(
    workspaceId: string,
    scope: ScopeHandle | undefined,
    rules: readonly RuleDefinition[],
  ): Promise<void> {
    if (scope)
      await this.connection.run(
        "DELETE FROM rule_subscriptions WHERE workspace_id = ? AND scope_kind = ? AND scope_id = ?",
        [workspaceId, scope.kind, scope.id],
      );
    else
      await this.connection.run(
        "DELETE FROM rule_subscriptions WHERE workspace_id = ? AND scope_kind IS NULL",
        [workspaceId],
      );
    for (const rule of rules)
      if (rule.trigger)
        await this.connection.run(
          "INSERT INTO rule_subscriptions (workspace_id, scope_kind, scope_id, event, rule_id) VALUES (?, ?, ?, ?, ?)",
          [workspaceId, scope?.kind ?? null, scope?.id ?? null, rule.trigger.event, rule.id],
        );
  }
  async deleteWorkspace(workspaceId: string): Promise<void> {
    await this.connection.run("DELETE FROM rule_subscriptions WHERE workspace_id = ?", [
      workspaceId,
    ]);
  }
}
