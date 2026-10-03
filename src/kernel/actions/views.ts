import { type ActionDefinition } from "../action-registry.ts";
import { prepareCreateValues } from "../record-values.ts";
import { type CoreActionPorts } from "./ports.ts";
import { resourceConflict, resourceNotFound } from "../../errors/error.ts";
import { semanticKey, type IdGenerator } from "../defaults.ts";
import {
  type CollectionDefinition,
  type FieldDefinition,
  type JsonValue,
} from "../../spec/model.ts";
import { type CollectionRecord } from "../../persistence/records.ts";
import { type SourceColumn, type SourceRow } from "../sources.ts";
import {
  sourceRecordValue,
  actionTool,
  requiredActionString,
  optionalActionObject,
} from "./values.ts";

export function viewsActions(
  ports: Pick<
    CoreActionPorts,
    | "views"
    | "resolveWorkspace"
    | "sources"
    | "ids"
    | "assertAuthorized"
    | "collectionResource"
    | "clock"
    | "assertReferences"
    | "getScopeConfig"
    | "applyScopeConfigChange"
    | "applySpecChange"
  >,
): readonly ActionDefinition[] {
  return [
    {
      key: "views.list",
      tool: actionTool(
        "List views",
        "Discover saved Views and their stable IDs before querying them.",
        {},
      ),
      run: async ({ context }) =>
        (await ports.views.list(context)).map((view) => ({
          id: view.id,
          key: view.key,
          label: view.label,
          description: view.description ?? null,
          source: view.source,
          parameters: (view.parameters ?? []).map((parameter) => ({
            key: parameter.key,
            label: parameter.label ?? parameter.key,
            required: parameter.required ?? false,
          })),
        })),
    },
    {
      key: "views.query",
      tool: actionTool(
        "Query view",
        "Run a saved View using its stable ID and declared parameters.",
        {
          viewId: { type: "string", description: "Stable View ID." },
          parameters: {
            type: "object",
            description: "Values for parameters declared by the View.",
            additionalProperties: true,
          },
        },
        ["viewId"],
      ),
      run: async ({ context, input }) => {
        const workspace = await ports.resolveWorkspace(context);
        const viewId = requiredActionString(input.viewId, "viewId");
        const view = workspace.spec.views.find((candidate) => candidate.id === viewId);
        if (!view) throw resourceNotFound("View", viewId);
        const parameters = optionalActionObject(input.parameters, "parameters");
        const result = await ports.views.query(
          context,
          view.key,
          parameters === undefined ? {} : { parameters },
        );
        const source = [...workspace.spec.collections, ...workspace.spec.sources].find(
          (candidate) => candidate.key === view.source,
        );
        if (!source) throw resourceNotFound("Source", view.source);
        const descriptor = await ports.sources.describe(context, source.key);
        if (!descriptor) throw resourceNotFound("Source", view.source);
        return result.data.rows.map((record) =>
          sourceRecordValue(record.id, source.id, descriptor.schema, record.values),
        );
      },
    },
    {
      key: "views.snapshot",
      tool: actionTool(
        "Snapshot view",
        "Create an independent local Collection from the current result of a View.",
        {
          viewId: { type: "string", description: "Stable View ID." },
          label: { type: "string", description: "Label for the new Collection." },
          key: { type: "string", description: "Optional semantic Collection key." },
          description: { type: "string" },
          parameters: {
            type: "object",
            description: "Values for parameters declared by the View.",
            additionalProperties: true,
          },
          meta: { type: "json", description: "Optional Collection metadata." },
        },
        ["viewId", "label"],
      ),
      run: async ({ context, input, publish }) => {
        const workspace = await ports.resolveWorkspace(context);
        const viewId = requiredActionString(input.viewId, "viewId");
        const view = workspace.spec.views.find((candidate) => candidate.id === viewId);
        if (!view) throw resourceNotFound("View", viewId);
        const label = requiredActionString(input.label, "label");
        const key =
          input.key === undefined
            ? semanticKey(label, "snapshot")
            : requiredActionString(input.key, "key");
        if (workspace.spec.collections.some((collection) => collection.key === key))
          throw resourceConflict(`Collection key ${key} is already in use.`);
        const parameters = optionalActionObject(input.parameters, "parameters");
        const meta = optionalActionObject(input.meta, "meta");
        const result = await ports.views.snapshot(
          context,
          view.key,
          parameters === undefined ? {} : { parameters },
        );
        const fields = snapshotFields(result.data.columns, result.data.rows, ports.ids);
        const titleFieldId = firstTextFieldId(fields);
        const collection: CollectionDefinition = {
          id: ports.ids.create("definition"),
          key,
          label,
          ...(typeof input.description === "string" && input.description.trim()
            ? { description: input.description.trim() }
            : {}),
          ...(meta === undefined ? {} : { meta: structuredClone(meta) }),
          fields,
          ...(titleFieldId === undefined ? {} : { titleFieldId }),
        };
        await ports.assertAuthorized({
          context,
          operation: "records.create",
          resource: ports.collectionResource(context, collection),
        });
        const stamp = ports.clock.now();
        const records: CollectionRecord[] = [];
        for (const row of result.data.rows) {
          const values = prepareCreateValues(collection, row.values);
          await ports.assertReferences(context, collection, values);
          records.push({
            id: ports.ids.create("record"),
            collectionId: collection.id,
            values,
            createdAt: stamp,
            updatedAt: stamp,
            createdBy: context.actorId,
            updatedBy: context.actorId,
          });
        }
        if (context.scope) {
          const config = await ports.getScopeConfig(context);
          await ports.applyScopeConfigChange(
            context,
            { ...config, collections: [...config.collections, collection] },
            [{ collection, records }],
          );
        } else {
          await ports.applySpecChange(
            context,
            { ...workspace.spec, collections: [...workspace.spec.collections, collection] },
            [{ collection, records }],
          );
        }
        const output: JsonValue = {
          collectionId: collection.id,
          collectionKey: collection.key,
          recordIds: records.map((record) => record.id),
          count: records.length,
        };
        await publish({
          event: "snapshot.created",
          sourceId: collection.id,
          payload: { snapshot: output, viewId },
        });
        return output;
      },
    },
  ];
}

function snapshotFields(
  columns: readonly SourceColumn[],
  rows: readonly SourceRow[],
  ids: IdGenerator,
): FieldDefinition[] {
  const keys = new Set<string>();
  return columns.map((column) => {
    const base = semanticKey(column.key || column.label, "field");
    let key = base;
    for (let suffix = 2; keys.has(key); suffix += 1) key = `${base}_${suffix}`;
    keys.add(key);
    return {
      id: ids.create("definition"),
      key,
      label: column.label,
      type: snapshotFieldType(column, rows),
    } as FieldDefinition;
  });
}

function snapshotFieldType(
  column: SourceColumn,
  rows: readonly SourceRow[],
): FieldDefinition["type"] {
  if (column.type === "json" || column.type === "reference") return "json";
  if (
    rows.some((row) => {
      const value = row.values[column.key];
      return Boolean(value && typeof value === "object");
    })
  )
    return "json";
  if (column.type === "choice") return "text";
  return column.type;
}

function firstTextFieldId(fields: readonly FieldDefinition[]): string | undefined {
  return fields.find((field) => field.type === "text")?.id;
}
