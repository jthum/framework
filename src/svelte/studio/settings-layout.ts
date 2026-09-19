import type { ValidationIssue } from "../../errors/error.ts";
import type { FieldDefinition, JsonValue } from "../../spec/index.ts";
import { validateFieldValue } from "../../spec/validate.ts";
import { parseFieldInputs } from "./field-inputs.ts";

/** Host-owned presentation for Workspace settings; not part of the portable Spec. */
export interface SettingsLayout {
  readonly tabs: readonly {
    readonly key: string;
    readonly label: string;
    readonly sections: readonly {
      readonly key: string;
      readonly label: string;
      readonly description?: string;
      readonly settings: readonly SettingControl[];
    }[];
  }[];
}

export interface SettingControl {
  /** Field.key is the stable Workspace setting key. Field identity and validation are reused. */
  readonly field: FieldDefinition;
  readonly secret?: boolean;
}

export function layoutSettings(layout: SettingsLayout): readonly SettingControl[] {
  const keys = new Set<string>();
  const controls: SettingControl[] = [];
  for (const tab of layout.tabs)
    for (const section of tab.sections)
      for (const control of section.settings) {
        const { field } = control;
        if (!field.key.trim() || keys.has(field.key))
          throw new Error(`Setting key must be non-empty and unique: ${field.key}`);
        if (control.secret && field.type !== "text")
          throw new Error(`Secret setting ${field.key} must use a text field.`);
        keys.add(field.key);
        controls.push(control);
      }
  return controls;
}

export function settingDraft(
  field: FieldDefinition,
  value: JsonValue | undefined,
): string | string[] {
  const initial = value ?? field.default;
  if (initial === undefined || initial === null)
    return field.type === "choice" && field.multiple ? [] : "";
  if (field.type === "json" || (field.type === "reference" && field.multiple))
    return JSON.stringify(initial, null, 2);
  if (field.type === "choice" && field.multiple)
    return Array.isArray(initial) ? initial.map(String) : [];
  if (field.type === "datetime" && typeof initial === "string") {
    const date = new Date(initial);
    if (!Number.isNaN(date.getTime()))
      return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  return String(initial);
}

export function parseSettingDraft(field: FieldDefinition, draft: string | string[]): JsonValue {
  const value = parseFieldInputs([field], { [field.key]: draft })[field.key] ?? null;
  const issues: ValidationIssue[] = [];
  validateFieldValue(field, value, field.key, issues);
  if (issues.length) throw new Error(issues[0]!.message);
  return value;
}
