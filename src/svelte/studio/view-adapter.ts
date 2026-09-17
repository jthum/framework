import type {
  CollectionDefinition,
  FieldOperator,
  JsonValue,
  SourceFilter,
  Spec,
  ViewDefinition,
} from "@jthum/framework/spec";
import type { FilterClause, FilterOp, ViewDraft, ViewMeasure } from "./authoring.js";
import { labelFromKey, slugify } from "./editor-data.js";

export class ViewAuthoringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ViewAuthoringError";
  }
}

export interface ViewAuthoringSchemas {
  /** Concrete schemas by Source key. Add attached schemas when available. */
  readonly [sourceKey: string]: CollectionDefinition;
}

export function localViewSchemas(spec: Pick<Spec, "collections">): ViewAuthoringSchemas {
  return Object.fromEntries(spec.collections.map((collection) => [collection.key, collection]));
}

/** Convert one canonical View into Studio's key-oriented working model. */
export function viewDraftFromDefinition(
  view: ViewDefinition,
  schemas: ViewAuthoringSchemas,
): ViewDraft {
  const schema = requireSchema(schemas, view.source);
  const aliases: Record<string, string> = {};
  const columnLabels: Record<string, string> = {};
  const fields =
    view.query?.select?.map((selection) => {
      const path = keyPath(schema, selection.path, schemas);
      if (selection.as !== selectionAlias(path)) aliases[path] = selection.as;
      const expectedLabel = labelFromKey(path.split(".").at(-1) ?? path);
      if (selection.label !== undefined && selection.label !== expectedLabel)
        columnLabels[path] = selection.label;
      return path;
    }) ?? [];
  const where: FilterClause[] = flattenFilters(view.query?.filter).map((filter) => ({
    field: keyPath(schema, filter.path, schemas),
    op: draftOperator(filter.operator),
    ...(filter.value === undefined ? {} : { value: filter.value }),
  }));
  const expose: string[] = [];
  const parameters: NonNullable<ViewDraft["parameters"]> = {};
  for (const parameter of view.parameters ?? []) {
    const field = keyPath(schema, parameter.path, schemas);
    if ((parameter.source ?? "input") === "input" && (parameter.operator ?? "eq") === "eq") {
      const expectedKey = selectionAlias(field);
      const expectedLabel = labelFromKey(field.split(".").at(-1) ?? field);
      expose.push(field);
      if (
        parameter.key !== expectedKey ||
        parameter.required !== undefined ||
        (parameter.label !== undefined && parameter.label !== expectedLabel)
      )
        parameters[field] = {
          key: parameter.key,
          ...(parameter.label !== undefined ? { label: parameter.label } : {}),
          ...(parameter.required !== undefined ? { required: parameter.required } : {}),
        };
    } else if (parameter.source === "context" && parameter.key === "record_id") {
      if (parameter.required !== true || parameter.label !== "Current record")
        throw new ViewAuthoringError(
          "The current-record parameter uses options that this editor cannot change safely.",
        );
      where.push({
        field,
        op: draftOperator(parameter.operator ?? "eq"),
        value: "$record.id",
      });
    } else {
      throw new ViewAuthoringError(
        `Parameter ${parameter.key} cannot be represented by the current View editor.`,
      );
    }
  }
  const aggregate = view.query?.aggregate;
  const groupBy = aggregate ? keyPath(schema, aggregate.group.path, schemas) : undefined;
  const measureLabels: Record<string, string> = {};
  const measures = aggregate
    ? Object.fromEntries(
        aggregate.measures.map((measure) => {
          if (measure.label !== undefined && measure.label !== labelFromKey(measure.as))
            measureLabels[measure.as] = measure.label;
          return [
            measure.as,
            {
              op: measure.operation,
              ...(measure.path ? { field: keyPath(schema, measure.path, schemas) } : {}),
              ...(measure.paths
                ? { fields: measure.paths.map((path) => keyPath(schema, path, schemas)) }
                : {}),
            } satisfies ViewMeasure,
          ];
        }),
      )
    : undefined;
  if (view.query?.offset !== undefined)
    throw new ViewAuthoringError(
      "Query offsets cannot be changed safely by the current View editor.",
    );
  const order = {
    ...Object.fromEntries(
      (view.query?.sort ?? []).map((sort) => [keyPath(schema, sort.path, schemas), sort.direction]),
    ),
    ...Object.fromEntries(
      (aggregate?.sort ?? []).map((sort) => [
        sort.key === aggregate?.group.as ? groupBy! : sort.key,
        sort.direction,
      ]),
    ),
  };
  return {
    id: view.id,
    key: view.key,
    label: view.label,
    ...(view.description ? { description: view.description } : {}),
    ...(view.meta ? { meta: structuredClone(view.meta) } : {}),
    source: view.source,
    fields: aggregate ? [groupBy!, ...Object.keys(measures ?? {})] : fields,
    ...(Object.keys(aliases).length ? { aliases } : {}),
    ...(Object.keys(columnLabels).length ? { column_labels: columnLabels } : {}),
    ...(where.length ? { where } : {}),
    ...(expose.length ? { expose } : {}),
    ...(Object.keys(parameters).length ? { parameters } : {}),
    ...(view.query?.limit !== undefined ? { limit: view.query.limit } : {}),
    ...(Object.keys(order).length ? { order_by: order } : {}),
    ...(groupBy
      ? {
          group_by: groupBy,
          ...(aggregate?.group.as !== selectionAlias(groupBy!)
            ? { group_alias: aggregate?.group.as }
            : {}),
          ...(aggregate?.group.label !== undefined &&
          aggregate.group.label !== labelFromKey(groupBy!)
            ? { group_label: aggregate.group.label }
            : {}),
          ...(aggregate?.group.labelPath
            ? { group_label_path: keyPath(schema, aggregate.group.labelPath, schemas) }
            : {}),
          measures,
          ...(Object.keys(measureLabels).length ? { measure_labels: measureLabels } : {}),
        }
      : {}),
    ...(view.presentation ? { presentation: structuredClone(view.presentation) } : {}),
  };
}

/** Convert a Studio draft to a canonical View while retaining identity and opaque metadata. */
export function viewDefinitionFromDraft(
  draft: ViewDraft,
  schemas: ViewAuthoringSchemas,
): ViewDefinition {
  const schema = requireSchema(schemas, draft.source);
  const parameters: Array<NonNullable<ViewDefinition["parameters"]>[number]> = [];
  const filters: SourceFilter[] = [];
  for (const clause of draftFilters(draft.where)) {
    const path = idPath(schema, clause.field, schemas);
    if (clause.value === "$record.id") {
      parameters.push({
        key: "record_id",
        label: "Current record",
        path,
        operator: canonicalOperator(clause.op),
        required: true,
        source: "context",
      });
    } else {
      filters.push({
        path,
        operator: canonicalOperator(clause.op),
        ...(clause.value === undefined ? {} : { value: jsonValue(clause.value) }),
      });
    }
  }
  for (const field of draft.expose ?? []) {
    const retained = draft.parameters?.[field];
    parameters.push({
      key: retained?.key ?? selectionAlias(field),
      label: retained?.label ?? labelFromKey(field.split(".").at(-1) ?? field),
      path: idPath(schema, field, schemas),
      ...(retained?.required !== undefined ? { required: retained.required } : {}),
    });
  }
  const aggregate = draft.group_by
    ? {
        group: {
          path: idPath(schema, draft.group_by, schemas),
          as: draft.group_alias ?? selectionAlias(draft.group_by),
          label: draft.group_label ?? labelFromKey(draft.group_by),
          ...(draft.group_label_path
            ? { labelPath: idPath(schema, draft.group_label_path, schemas) }
            : {}),
        },
        measures: Object.entries(draft.measures ?? {}).map(([as, measure]) => ({
          as,
          label: draft.measure_labels?.[as] ?? labelFromKey(as),
          operation: measure.op,
          ...(measure.field ? { path: idPath(schema, measure.field, schemas) } : {}),
          ...(measure.fields?.length
            ? { paths: measure.fields.map((field) => idPath(schema, field, schemas)) }
            : {}),
        })),
        ...aggregateSort(draft, draft.group_by),
      }
    : undefined;
  const aggregateKeys = new Set(
    aggregate ? [draft.group_by!, ...Object.keys(draft.measures ?? {})] : [],
  );
  const sort = Object.entries(draft.order_by ?? {}).flatMap(([field, direction]) =>
    aggregateKeys.has(field) ? [] : [{ path: idPath(schema, field, schemas), direction }],
  );
  const select = aggregate
    ? undefined
    : draft.fields.map((field) => ({
        path: idPath(schema, field, schemas),
        as: draft.aliases?.[field] ?? selectionAlias(field),
        label: draft.column_labels?.[field] ?? labelFromKey(field.split(".").at(-1) ?? field),
      }));
  return {
    id: draft.id,
    key: draft.key,
    label: draft.label,
    ...(draft.description ? { description: draft.description } : {}),
    ...(draft.meta ? { meta: structuredClone(draft.meta) } : {}),
    source: draft.source,
    query: {
      ...(filters.length === 1
        ? { filter: filters[0] }
        : filters.length
          ? { filter: { all: filters } }
          : {}),
      ...(sort.length ? { sort } : {}),
      ...(select?.length ? { select } : {}),
      ...(aggregate ? { aggregate } : {}),
      ...(draft.limit !== undefined ? { limit: draft.limit } : {}),
    },
    ...(parameters.length ? { parameters } : {}),
    ...(draft.presentation ? { presentation: structuredClone(draft.presentation) } : {}),
  };
}

function aggregateSort(draft: ViewDraft, groupBy: string) {
  const aliases = new Set([groupBy, ...Object.keys(draft.measures ?? {})]);
  const sort = Object.entries(draft.order_by ?? {}).flatMap(([key, direction]) =>
    aliases.has(key)
      ? [{ key: key === groupBy ? (draft.group_alias ?? selectionAlias(groupBy)) : key, direction }]
      : [],
  );
  return sort.length ? { sort } : {};
}

function flattenFilters(
  filter?: SourceFilter,
): Array<Extract<SourceFilter, { path: readonly string[] }>> {
  if (!filter) return [];
  if ("all" in filter) return filter.all.flatMap(flattenFilters);
  if ("any" in filter || "not" in filter)
    throw new ViewAuthoringError(
      "Nested any/not filters cannot be changed safely by the current View editor.",
    );
  return [filter];
}

function draftFilters(where: ViewDraft["where"]): FilterClause[] {
  if (!where) return [];
  if (Array.isArray(where)) return where;
  return Object.entries(where).map(([field, value]) => ({ field, op: "eq", value }));
}

function requireSchema(schemas: ViewAuthoringSchemas, key: string): CollectionDefinition {
  const schema = schemas[key];
  if (!schema) throw new ViewAuthoringError(`Source schema ${key} is unavailable.`);
  return schema;
}

function relatedSchema(schemas: ViewAuthoringSchemas, sourceId: string): CollectionDefinition {
  const schema = Object.values(schemas).find((candidate) => candidate.id === sourceId);
  if (!schema) throw new ViewAuthoringError(`Related Source ${sourceId} is unavailable.`);
  return schema;
}

function idPath(
  root: CollectionDefinition,
  keyPathValue: string,
  schemas: ViewAuthoringSchemas,
): string[] {
  let schema = root;
  return keyPathValue.split(".").map((key, index, keys) => {
    const field = schema.fields.find((candidate) => candidate.key === key);
    if (!field) throw new ViewAuthoringError(`Field path ${keyPathValue} cannot be resolved.`);
    if (index < keys.length - 1) {
      if (field.type !== "reference")
        throw new ViewAuthoringError(`${key} is not a reference Field.`);
      schema = relatedSchema(schemas, field.sourceId);
    }
    return field.id;
  });
}

function keyPath(
  root: CollectionDefinition,
  path: readonly string[],
  schemas: ViewAuthoringSchemas,
): string {
  let schema = root;
  return path
    .map((id, index) => {
      const field = schema.fields.find((candidate) => candidate.id === id);
      if (!field) throw new ViewAuthoringError(`Field ${id} cannot be resolved.`);
      if (index < path.length - 1) {
        if (field.type !== "reference")
          throw new ViewAuthoringError(`${field.key} is not a reference Field.`);
        schema = relatedSchema(schemas, field.sourceId);
      }
      return field.key;
    })
    .join(".");
}

function selectionAlias(path: string): string {
  return slugify(path.replaceAll(".", "_"));
}
function canonicalOperator(operator: FilterOp | undefined): FieldOperator {
  return operator === "not_empty"
    ? "notEmpty"
    : operator === "in" || operator === undefined
      ? "eq"
      : operator;
}
function draftOperator(operator: FieldOperator): FilterOp {
  return operator === "notEmpty" ? "not_empty" : operator;
}
function jsonValue(value: unknown): JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === "object")
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  throw new ViewAuthoringError("Filter value must be JSON-compatible.");
}
