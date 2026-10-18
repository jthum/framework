/** Host-prepared display values. Loading, field choice and links remain host-owned. */
export interface RecordProperty {
  key: string;
  label: string;
  value: unknown;
  multiline?: boolean;
  /** Promote up to three values on full pages. Compact panels keep all facts together in supplied order. */
  highlight?: boolean;
}
