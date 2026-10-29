import type { SourceFilter, SourceQueryDefinition } from "./model.ts";

/** Paths used by row filtering, sorting and projection, in definition order. */
export function queryPaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  return [
    ...filterPaths(query.filter),
    ...(query.sort?.map((item) => item.path) ?? []),
    ...(query.select?.map((item) => item.path) ?? []),
  ];
}

/** Include aggregate group, label and measure paths for planning and validation. */
export function allQueryPaths(query: SourceQueryDefinition): readonly (readonly string[])[] {
  return [
    ...queryPaths(query),
    ...(query.aggregate
      ? [
          query.aggregate.group.path,
          ...(query.aggregate.group.labelPath ? [query.aggregate.group.labelPath] : []),
          ...query.aggregate.measures.flatMap((measure) => [
            ...(measure.path ? [measure.path] : []),
            ...(measure.paths ?? []),
          ]),
        ]
      : []),
  ];
}

function filterPaths(filter: SourceFilter | undefined): readonly (readonly string[])[] {
  if (!filter) return [];
  if ("all" in filter) return filter.all.flatMap(filterPaths);
  if ("any" in filter) return filter.any.flatMap(filterPaths);
  if ("not" in filter) return filterPaths(filter.not);
  return [filter.path];
}
