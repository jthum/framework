<script lang="ts">
  import type { WorkspaceClient } from "../../client/workspace-client.ts";
  import type { SettingSummary } from "../../kernel/workspace-config-service.ts";
  import { Button } from "../ui/button/index.js";
  import * as Field from "../ui/field/index.js";
  import { Input } from "../ui/input/index.js";
  import { Spinner } from "../ui/spinner/index.js";
  import { Switch } from "../ui/switch/index.js";
  import * as Tabs from "../ui/tabs/index.js";
  import FieldInputs from "../internal/field-inputs.svelte";
  import { layoutSettings, settingDraft, parseSettingDraft, type SettingsLayout } from "./settings-layout.ts";

  let { client, layout, secretStorageNote = "The host controls how secret values are stored." }: {
    client?: WorkspaceClient;
    layout: SettingsLayout;
    secretStorageNote?: string;
  } = $props();
  const controls = $derived(layoutSettings(layout));
  let settings = $state<readonly SettingSummary[]>([]);
  let drafts = $state<Record<string, string | string[]>>({});
  let activeTab = $state("");
  let pending = $state(false);
  let error = $state("");
  $effect(() => {
    if (!client) return;
    const currentControls = controls;
    void refresh(client, currentControls);
  });

  $effect(() => {
    if (!layout.tabs.some((tab) => tab.key === activeTab)) activeTab = layout.tabs[0]?.key ?? "";
  });

  async function refresh(current: WorkspaceClient, currentControls = controls) {
    try {
      const next = await current.listSettings();
      settings = next;
      drafts = Object.fromEntries(currentControls.map(({ field, secret }) => {
        const stored = next.find((setting) => setting.key === field.key);
        return [field.key, secret ? "" : settingDraft(field, stored?.value)];
      }));
      error = "";
    } catch (cause) { error = message(cause); }
  }

  function configured(key: string) { return settings.find((setting) => setting.key === key)?.configured ?? false; }
  function setDraft(key: string, value: string) { drafts = { ...drafts, [key]: value }; }
  function message(cause: unknown) { return cause instanceof Error ? cause.message : "Settings could not be saved."; }

  async function save() {
    if (!client || pending) return;
    pending = true;
    error = "";
    try {
      const updates = controls.map(({ field, secret }) => {
        const raw = drafts[field.key] ?? "";
        if (secret) {
          if (typeof raw !== "string") throw new Error(`${field.label} must be text.`);
          if (field.required && !raw && !configured(field.key)) throw new Error(`${field.label} is required.`);
          if (raw) parseSettingDraft(field, raw);
          return { key: field.key, label: field.label, secret: true as const, ...(raw ? { value: raw } : {}) };
        }
        return { key: field.key, label: field.label, value: parseSettingDraft(field, raw) };
      });
      for (const update of updates) await client.putSetting(update);
      await refresh(client);
    } catch (cause) { error = message(cause); }
    finally { pending = false; }
  }
</script>

{#if layout.tabs.length}
  <Tabs.Root bind:value={activeTab} class="flex flex-col gap-4">
    {#if layout.tabs.length > 1}
      <Tabs.List>
        {#each layout.tabs as tab (tab.key)}<Tabs.Trigger value={tab.key}>{tab.label}</Tabs.Trigger>{/each}
      </Tabs.List>
    {/if}
    {#each layout.tabs as tab (tab.key)}
      <Tabs.Content value={tab.key} class="flex flex-col gap-6">
        {#each tab.sections as section (section.key)}
          <Field.Set>
            <div class="flex flex-col gap-1">
              <Field.Legend class="mb-0">{section.label}</Field.Legend>
              {#if section.description}<Field.Description>{section.description}</Field.Description>{/if}
            </div>
            <Field.Group>
              {#each section.settings as control (control.field.key)}
                {@const field = control.field}
                {#if control.secret}
                  <Field.Field>
                    <Field.Label for={`setting-${field.id}`}>{field.label}</Field.Label>
                    <Input id={`setting-${field.id}`} type="password" autocomplete="new-password" value={String(drafts[field.key] ?? "")} disabled={pending} placeholder={configured(field.key) ? "Configured — leave blank to keep" : ""} oninput={(event) => setDraft(field.key, event.currentTarget.value)} />
                    <Field.Description>{field.description ? `${field.description} ` : ""}{secretStorageNote}</Field.Description>
                  </Field.Field>
                {:else if field.type === "boolean"}
                  <Field.Field orientation="horizontal">
                    <Field.Content>
                      <Field.Label for={`setting-${field.id}`}>{field.label}</Field.Label>
                      {#if field.description}<Field.Description>{field.description}</Field.Description>{/if}
                    </Field.Content>
                    <Switch id={`setting-${field.id}`} checked={drafts[field.key] === "true"} disabled={pending} onCheckedChange={(checked) => setDraft(field.key, String(checked))} />
                  </Field.Field>
                {:else}
                  <FieldInputs fields={[field]} bind:values={drafts} disabled={pending} />
                {/if}
              {/each}
            </Field.Group>
          </Field.Set>
        {/each}
      </Tabs.Content>
    {/each}
    {#if error}<Field.Error>{error}</Field.Error>{/if}
    <div class="flex justify-end"><Button type="button" disabled={pending || !client} onclick={save}>{#if pending}<Spinner data-icon="inline-start" />{/if}Save settings</Button></div>
  </Tabs.Root>
{/if}
