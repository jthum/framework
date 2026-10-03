import { type ActionDefinition } from "../action-registry.ts";
import { type CoreActionPorts } from "./ports.ts";
import { resourceNotFound } from "../../errors/error.ts";
import { type SourceQueryDefinition } from "../../spec/model.ts";
import { recordValue, sourceRecordValue, actionTool, optionalActionObject } from "./values.ts";

export function recordsActions(
  ports: Pick<
    CoreActionPorts,
    "createActionRecord" | "actionRecordTarget" | "actionSource" | "sources" | "updateActionRecord"
  >,
): readonly ActionDefinition[] {
  return [
    {
      key: "records.create",
      tool: actionTool(
        "Create record",
        "Create a record in a local Collection using stable Source and Field IDs.",
        {
          sourceId: { type: "string", description: "Stable local Collection ID." },
          values: {
            type: "object",
            description: "Values keyed by stable Field ID.",
            additionalProperties: true,
          },
        },
        ["sourceId", "values"],
      ),
      run: async ({ context, input, publish }) => {
        const result = await ports.createActionRecord(context, input, publish);
        return recordValue(result.record, result.collection);
      },
    },
    {
      key: "records.get",
      tool: actionTool(
        "Get record",
        "Read one record from a local or attached Source.",
        {
          sourceId: { type: "string", description: "Stable Source ID." },
          recordId: { type: "string", description: "Runtime record ID." },
        },
        ["sourceId", "recordId"],
      ),
      run: async ({ context, input, runtime }) => {
        const target = await ports.actionRecordTarget(context, input);
        const record = await runtime.getSourceRecord(context, target.source.key, target.recordId);
        return record
          ? sourceRecordValue(record.id, target.source.id, target.source.schema, record.values)
          : null;
      },
    },
    {
      key: "records.list",
      tool: actionTool(
        "List records",
        "Query records from a local or attached Source.",
        {
          sourceId: { type: "string", description: "Stable Source ID." },
          query: { type: "json", description: "Optional canonical Source query." },
        },
        ["sourceId"],
      ),
      run: async ({ context, input }) => {
        const source = await ports.actionSource(context, input);
        const query = optionalActionObject(input.query, "query") as
          | SourceQueryDefinition
          | undefined;
        return (await ports.sources.query(context, source.key, query)).rows.map((record) =>
          sourceRecordValue(record.id, source.id, source.schema, record.values),
        );
      },
    },
    {
      key: "records.update",
      tool: actionTool(
        "Update record",
        "Update one record in a local or writable attached Source.",
        {
          sourceId: { type: "string", description: "Stable Source ID." },
          recordId: { type: "string", description: "Runtime record ID." },
          values: {
            type: "object",
            description: "Values keyed by stable Field ID.",
            additionalProperties: true,
          },
        },
        ["sourceId", "recordId", "values"],
      ),
      run: async ({ context, input, publish }) => {
        const result = await ports.updateActionRecord(context, input, publish);
        return recordValue(result.record, result.schema, result.sourceId);
      },
    },
    {
      key: "records.delete",
      tool: actionTool(
        "Delete record",
        "Delete one record from a local or writable attached Source.",
        {
          sourceId: { type: "string", description: "Stable Source ID." },
          recordId: { type: "string", description: "Runtime record ID." },
        },
        ["sourceId", "recordId"],
      ),
      run: async ({ context, input, runtime, publish }) => {
        const target = await ports.actionRecordTarget(context, input);
        const record = await runtime.getSourceRecord(context, target.source.key, target.recordId);
        if (!record) throw resourceNotFound("Record", target.recordId);
        await runtime.deleteSourceRecord(context, target.source.key, target.recordId);
        await publish({
          event: "record.deleted",
          sourceId: target.source.id,
          payload: {
            record: sourceRecordValue(
              record.id,
              target.source.id,
              target.source.schema,
              record.values,
            ),
            recordId: record.id,
          },
        });
        return { id: target.recordId };
      },
    },
  ];
}
