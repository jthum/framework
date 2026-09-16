export interface EnvironmentProfile {
  readonly durableRuleExecution: boolean;
  readonly schedules: boolean;
  readonly webhooks: boolean;
  readonly multiplayer: boolean;
  readonly agentRuntime: boolean;
}

export const LOCAL_BROWSER_ENVIRONMENT: EnvironmentProfile = Object.freeze({
  durableRuleExecution: false,
  schedules: false,
  webhooks: false,
  multiplayer: false,
  agentRuntime: false,
});

export function defineEnvironmentProfile(profile: EnvironmentProfile): EnvironmentProfile {
  return Object.freeze({ ...profile });
}
