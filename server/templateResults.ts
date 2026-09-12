import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { TemplateResult } from "./templates.js";

const FILE = new URL("../template-results.json", import.meta.url);

export interface StoredTemplateResult {
  templateId: string;
  timestamp: string;
  subgraphUsed: { name: string; id: string };
  result: TemplateResult;
  txHash?: string;
}

async function load(): Promise<Record<string, StoredTemplateResult>> {
  if (!existsSync(FILE)) return {};
  try {
    return JSON.parse(await readFile(FILE, "utf8"));
  } catch {
    return {};
  }
}

export async function saveTemplateResult(entry: StoredTemplateResult): Promise<void> {
  const all = await load();
  all[entry.templateId] = entry;
  await writeFile(FILE, JSON.stringify(all, null, 2));
}

/** Latest REAL run per template — never seeded/mocked. Missing key = never run. */
export async function getLatestResults(): Promise<Record<string, StoredTemplateResult>> {
  return load();
}
