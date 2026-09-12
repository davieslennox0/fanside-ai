import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fetchAllWidgets, type WidgetData } from "./widgets.js";

const FILE = new URL("../widget-results.json", import.meta.url);
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min, per task spec

export type StoredWidgets = Record<string, WidgetData & { fetchedAt: string; error?: string }>;

async function load(): Promise<StoredWidgets> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

async function save(data: StoredWidgets): Promise<void> {
  await writeFile(FILE, JSON.stringify(data, null, 2));
}

export async function getWidgets(): Promise<StoredWidgets> {
  return load();
}

/**
 * Refreshes every widget by calling the Subgraph MCP directly (same
 * mcpClient.ts functions /api/ask uses internally) — no x402 payment, no
 * wallet, no USDC anywhere in this path. This is the project owner's own
 * dashboard data, fetched server-side with just the Gateway API key,
 * exactly like /api/stats or /api/activity already are. Payment stays
 * scoped to /api/ask, /api/agent/query and /api/template/:id only.
 */
let inFlight: Promise<StoredWidgets> | null = null;
let lastRefreshStartedAt = 0;
const MIN_MANUAL_REFRESH_GAP_MS = 15_000; // guards against refresh-button spam

export async function refreshWidgets(): Promise<StoredWidgets> {
  if (inFlight) return inFlight; // a manual click during the interval's own run just waits on it
  lastRefreshStartedAt = Date.now();
  inFlight = (async () => {
    const data = await fetchAllWidgets();
    await save(data);
    return data;
  })();
  try {
    return await inFlight;
  } finally {
    inFlight = null;
  }
}

/** For the manual "Refresh now" button — same real query path, just rate-limited. */
export async function refreshWidgetsManually(): Promise<{ data: StoredWidgets; throttled: boolean }> {
  if (!inFlight && Date.now() - lastRefreshStartedAt < MIN_MANUAL_REFRESH_GAP_MS) {
    return { data: await load(), throttled: true };
  }
  return { data: await refreshWidgets(), throttled: false };
}

export function startWidgetRefreshLoop(): void {
  refreshWidgets().catch((err) => console.error("Initial widget refresh failed:", err));
  setInterval(() => {
    refreshWidgets().catch((err) => console.error("Widget refresh failed:", err));
  }, REFRESH_INTERVAL_MS);
}
