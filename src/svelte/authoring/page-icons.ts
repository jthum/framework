import type { Component } from "svelte";
import CalendarIcon from "@lucide/svelte/icons/calendar";
import ChartBarIcon from "@lucide/svelte/icons/chart-bar";
import ChartLineIcon from "@lucide/svelte/icons/chart-line";
import ChartPieIcon from "@lucide/svelte/icons/chart-pie";
import ClockIcon from "@lucide/svelte/icons/clock";
import Columns3Icon from "@lucide/svelte/icons/columns-3";
import InboxIcon from "@lucide/svelte/icons/inbox";
import LayoutDashboardIcon from "@lucide/svelte/icons/layout-dashboard";
import LayersIcon from "@lucide/svelte/icons/layers";
import ListIcon from "@lucide/svelte/icons/list";
import TableIcon from "@lucide/svelte/icons/table";
import UsersIcon from "@lucide/svelte/icons/users";
import WalletIcon from "@lucide/svelte/icons/wallet";
import type { PageLayoutNode } from "../../spec/model.ts";

export const PAGE_ICON_KEYS = [
  "page",
  "dashboard",
  "table",
  "chart",
  "line",
  "donut",
  "board",
  "calendar",
  "list",
  "inbox",
  "people",
  "money",
  "time",
] as const;

export type PageIconKey = (typeof PAGE_ICON_KEYS)[number];

export const pageIconList: Array<{ key: PageIconKey; label: string; icon: Component }> = [
  { key: "page", label: "Page", icon: LayersIcon },
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboardIcon },
  { key: "table", label: "Table", icon: TableIcon },
  { key: "chart", label: "Bar chart", icon: ChartBarIcon },
  { key: "line", label: "Line chart", icon: ChartLineIcon },
  { key: "donut", label: "Donut", icon: ChartPieIcon },
  { key: "board", label: "Board", icon: Columns3Icon },
  { key: "calendar", label: "Calendar", icon: CalendarIcon },
  { key: "list", label: "List", icon: ListIcon },
  { key: "inbox", label: "Inbox", icon: InboxIcon },
  { key: "people", label: "People", icon: UsersIcon },
  { key: "money", label: "Money", icon: WalletIcon },
  { key: "time", label: "Time", icon: ClockIcon },
];

const byKey = new Map(pageIconList.map((item) => [item.key, item]));

export function isPageIcon(value: unknown): value is PageIconKey {
  return typeof value === "string" && byKey.has(value as PageIconKey);
}

export function normalizePageIcon(value: unknown): PageIconKey | undefined {
  if (value == null || value === "") return undefined;
  return isPageIcon(value) ? value : undefined;
}

export function pageIconEntry(value: unknown) {
  return (
    byKey.get(isPageIcon(value) ? value : "page") ?? {
      key: "page" as const,
      label: "Page",
      icon: LayersIcon,
    }
  );
}

function blockKeys(blocks: readonly PageLayoutNode[] | undefined): string[] {
  const keys: string[] = [];
  for (const block of blocks ?? []) {
    if (block.kind === "block") keys.push(block.block);
    if (block.kind === "group") keys.push(...blockKeys(block.children));
  }
  return keys;
}

export function guessPageIcon(blocks: readonly PageLayoutNode[] | undefined): PageIconKey {
  const keys = blockKeys(blocks);
  if (keys.includes("kanban")) return "board";
  if (keys.includes("calendar")) return "calendar";
  if (keys.includes("donut")) return "donut";
  if (keys.includes("line")) return "line";
  if (keys.includes("bar") || keys.includes("stacked_bar")) return "chart";
  if (keys.includes("table")) return "table";
  if (keys.includes("list")) return "list";
  if (keys.includes("metric") || keys.includes("stat")) return "dashboard";
  return "page";
}
