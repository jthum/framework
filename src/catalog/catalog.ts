import { ERROR_CODES, FrameworkError, resourceConflict } from "../errors/error.ts";
import type {
  CatalogEntry,
  CatalogItem,
  CatalogPage,
  CatalogQuery,
  CatalogSource,
  CatalogSourceInfo,
} from "./model.ts";

/** Read-only discovery across host-selected sources. It never installs or executes an entry. */
export class Catalog<Entry extends CatalogEntry> {
  private readonly installed: readonly CatalogSource<Entry>[];
  private readonly bySource = new Map<string, CatalogSource<Entry>>();

  constructor(sources: readonly CatalogSource<Entry>[] = []) {
    this.installed = structuredClone(sources);
    for (const source of this.installed) {
      requireKey(source.key, "Catalog source");
      if (this.bySource.has(source.key))
        throw resourceConflict(`Catalog source ${source.key} is already installed.`);
      const keys = new Set<string>();
      for (const entry of source.entries) {
        requireKey(entry.key, `Catalog entry in ${source.key}`);
        if (keys.has(entry.key))
          throw resourceConflict(`Catalog entry ${source.key}/${entry.key} is duplicated.`);
        keys.add(entry.key);
      }
      const categories = new Set<string>();
      for (const category of source.categories ?? []) {
        requireKey(category.key, `Catalog category in ${source.key}`);
        if (categories.has(category.key))
          throw resourceConflict(`Catalog category ${source.key}/${category.key} is duplicated.`);
        categories.add(category.key);
      }
      this.bySource.set(source.key, source);
    }
  }

  sources(): readonly CatalogSourceInfo[] {
    return structuredClone(this.installed.map(sourceInfo));
  }

  get(sourceKey: string, entryKey: string): Entry | null {
    const entry = this.bySource
      .get(sourceKey)
      ?.entries.find((candidate) => candidate.key === entryKey);
    return entry ? structuredClone(entry) : null;
  }

  list(query: CatalogQuery = {}): CatalogPage<Entry> {
    const offset = pageNumber(query.offset, "offset", 0);
    const limit = pageNumber(query.limit, "limit", Number.MAX_SAFE_INTEGER, 1);
    const selected = query.sourceKeys ? new Set(query.sourceKeys) : undefined;
    const tags = (query.tags ?? []).map(normalize).filter(Boolean);
    const search = normalize(query.search ?? "");
    const items: CatalogItem<Entry>[] = [];
    for (const source of this.installed) {
      if (selected && !selected.has(source.key)) continue;
      const info = sourceInfo(source);
      for (const entry of source.entries) {
        if (query.category !== undefined && entry.category !== query.category) continue;
        const entryTags = new Set((entry.tags ?? []).map(normalize));
        if (tags.some((tag) => !entryTags.has(tag))) continue;
        if (search) {
          const haystack = searchable(entry);
          if (!search.split(/\s+/u).every((term) => haystack.includes(term))) continue;
        }
        items.push({ source: info, entry });
      }
    }
    const page = items.slice(offset, offset + limit);
    return structuredClone({
      items: page,
      total: items.length,
      offset,
      limit: query.limit ?? Math.max(0, items.length - offset),
      hasMore: offset + page.length < items.length,
    });
  }
}

function sourceInfo<Entry extends CatalogEntry>(source: CatalogSource<Entry>): CatalogSourceInfo {
  return {
    key: source.key,
    label: source.label,
    ...(source.description === undefined ? {} : { description: source.description }),
    ...(source.categories === undefined ? {} : { categories: source.categories }),
    ...(source.meta === undefined ? {} : { meta: source.meta }),
  };
}

function searchable(entry: CatalogEntry): string {
  return normalize(
    [entry.key, entry.label, entry.description ?? "", ...(entry.tags ?? [])].join(" "),
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function requireKey(value: string, label: string): void {
  if (!value.trim()) invalid(`${label} key cannot be empty.`);
}

function pageNumber(value: number | undefined, key: string, fallback: number, minimum = 0): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < minimum)
    invalid(`Catalog ${key} must be an integer of at least ${minimum}.`);
  return value;
}

function invalid(message: string): never {
  throw new FrameworkError({ code: ERROR_CODES.validationInvalidInput, message });
}
