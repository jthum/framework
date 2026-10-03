import { invalidInput } from "../errors/error.ts";
import type { SourceQueryDefinition } from "../spec/model.ts";

export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 1000;
export const MAX_SNAPSHOT_ROWS = 10000;

export function boundedQuery(query: SourceQueryDefinition): SourceQueryDefinition {
  const limit = query.limit ?? DEFAULT_QUERY_LIMIT;
  if (!Number.isInteger(limit) || limit < 0 || limit > MAX_QUERY_LIMIT)
    throw invalidInput(`Query limit must be an integer between 0 and ${MAX_QUERY_LIMIT}.`);
  if (query.offset !== undefined && (!Number.isSafeInteger(query.offset) || query.offset < 0))
    throw invalidInput("Query offset must be a non-negative safe integer.");
  return { ...query, limit };
}
