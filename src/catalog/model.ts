import type { SpecMeta } from "../spec/model.ts";

/** Minimum inert metadata shared by Block, Field, Page, and Workspace catalogs. */
export interface CatalogEntry {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly tags?: readonly string[];
  readonly meta?: SpecMeta;
}

export interface CatalogCategory {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly meta?: SpecMeta;
}

/** A host-installed source of inert catalog entries. Installation remains domain-specific. */
export interface CatalogSource<Entry extends CatalogEntry> {
  readonly key: string;
  readonly label: string;
  readonly description?: string;
  readonly categories?: readonly CatalogCategory[];
  readonly entries: readonly Entry[];
  readonly meta?: SpecMeta;
}

export type CatalogSourceInfo = Omit<CatalogSource<CatalogEntry>, "entries">;

export interface CatalogItem<Entry extends CatalogEntry> {
  readonly source: CatalogSourceInfo;
  readonly entry: Entry;
}

export interface CatalogQuery {
  readonly sourceKeys?: readonly string[];
  readonly category?: string;
  /** All requested tags must be present. */
  readonly tags?: readonly string[];
  readonly search?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface CatalogPage<Entry extends CatalogEntry> {
  readonly items: readonly CatalogItem<Entry>[];
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly hasMore: boolean;
}
