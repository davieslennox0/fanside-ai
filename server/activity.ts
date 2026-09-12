import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const FILE = new URL("../activity.json", import.meta.url);

export interface ActivityEntry {
  timestamp: string;
  question: string;
  tier: string;
  price: string;
  subgraphsUsed: string[];
  caller: "human" | "agent";
  ok: boolean;
}

async function load(): Promise<ActivityEntry[]> {
  if (!existsSync(FILE)) return [];
  try {
    const raw = await readFile(FILE, "utf8");
    return JSON.parse(raw) as ActivityEntry[];
  } catch {
    return [];
  }
}

export async function logActivity(entry: ActivityEntry): Promise<void> {
  const entries = await load();
  entries.push(entry);
  // Keep the file bounded — this is a demo dashboard, not a data warehouse.
  const trimmed = entries.slice(-2000);
  await writeFile(FILE, JSON.stringify(trimmed, null, 2));
}

export async function getActivity(): Promise<ActivityEntry[]> {
  return load();
}

export async function getStats() {
  const entries = await load();
  const byTier: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let revenue = 0;

  for (const e of entries) {
    if (!e.ok) continue;
    byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;
    const day = e.timestamp.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
    revenue += Number(e.price) || 0;
  }

  return {
    totalQueries: entries.filter((e) => e.ok).length,
    totalFailed: entries.filter((e) => !e.ok).length,
    revenueUsdc: revenue,
    byTier,
    byDay,
    recent: entries.slice(-25).reverse(),
  };
}
