import { type ActionDefinition } from "../action-registry.ts";
import { type CoreActionPorts } from "./ports.ts";
import { actionTool } from "./values.ts";

export function sourcesActions(
  ports: Pick<CoreActionPorts, "sources">,
): readonly ActionDefinition[] {
  return [
    {
      key: "sources.list",
      tool: actionTool(
        "List sources",
        "Discover available Sources, their stable IDs, and Field schemas before using record tools.",
        {},
      ),
      run: async ({ context }) =>
        (await ports.sources.list(context)).map((source) => ({
          id: source.schema.id,
          key: source.key,
          label: source.label,
          kind: source.kind,
          fields: source.schema.fields.map((field) => ({
            id: field.id,
            key: field.key,
            label: field.label,
            type: field.type,
            required: field.required ?? false,
          })),
          capabilities: { ...source.capabilities },
        })),
    },
  ];
}
