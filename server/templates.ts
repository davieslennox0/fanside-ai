import { TIERS } from "./pricing.js";

export type ChartType = "line" | "bar";

export interface TemplateResult {
  labels: string[];
  values: number[];
  seriesLabel: string;
}

export interface QueryTemplate {
  id: string;
  name: string;
  description: string;
  chartType: ChartType;
  price: string; // reuses the same USDC tier scale as pricing.ts's TIERS
  /**
   * Real Subgraph Studio subgraph ID, confirmed live via manual keyword
   * search (search_subgraphs_by_keyword "uniswap" -> "Uniswap-V3"). Curated
   * templates pin an exact known-good subgraph rather than trusting keyword
   * search fresh each run — search turned up several unallocated/dev/wrong-
   * version deployments sharing the same or a similar display name (see
   * README "Friction" for the full story), so pinning is what actually
   * makes "real usable data" reliable here, not a shortcut around it.
   */
  pinnedSubgraphId: string;
  buildQuery: (params: Record<string, unknown>) => { query: string; variables: Record<string, unknown> };
  transform: (raw: unknown) => TemplateResult;
  /**
   * Only flip this to true once scripts/verify-templates.mjs has actually
   * run this template against live Subgraph MCP data and it returned real,
   * usable rows. False means "candidate, not yet confirmed" — the
   * templates page will not offer an unverified template to run.
   */
  verified: boolean;
}

/**
 * Curated "mini Dune" templates, both pinned to Subgraph Studio ID
 * "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV" ("Uniswap-V3"), the real
 * canonical Uniswap v3 Ethereum mainnet subgraph confirmed live against
 * The Graph's Subgraph MCP.
 *
 * Two other candidates (daily transfer volume, top holders — both meant to
 * be generic per-token ERC-20 templates) were built and tested against real
 * live data and DROPPED: every actively-indexed candidate subgraph found via
 * keyword search and via get_top_subgraph_deployments(chain, contract) for
 * USDC came back "subgraph not found: no allocations" (no indexer currently
 * serving that deployment) at execution time, even when its schema fetched
 * fine and it had historically been a heavily-queried deployment. Not
 * shipping those two rather than quietly resolving them to whatever
 * unrelated schema happened to answer.
 */
export const TEMPLATES: QueryTemplate[] = [
  {
    id: "tvl-uniswap",
    name: "TVL over time — Uniswap v3",
    description: "Daily total value locked across all Uniswap v3 mainnet pools, most recent N days.",
    chartType: "line",
    price: TIERS.multi_field.price, // full time-series, costlier than a snapshot
    pinnedSubgraphId: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
    buildQuery: (params) => ({
      query: `query TvlOverTime($days: Int!) {
        uniswapDayDatas(first: $days, orderBy: date, orderDirection: desc) {
          date
          tvlUSD
        }
      }`,
      variables: { days: Number(params.days ?? 30) },
    }),
    transform: (raw) => {
      const rows = extractRows(raw, "uniswapDayDatas") as Array<{ date: number; tvlUSD: string }>;
      const sorted = [...rows].sort((a, b) => a.date - b.date);
      return {
        labels: sorted.map((r) => new Date(r.date * 1000).toISOString().slice(0, 10)),
        values: sorted.map((r) => Number(r.tvlUSD)),
        seriesLabel: "TVL (USD)",
      };
    },
    verified: true,
  },
  {
    id: "swap-volume-pools",
    name: "Swap volume by pool — Uniswap v3",
    description: "Top Uniswap v3 mainnet pools ranked by all-time swap volume (current snapshot, not historical).",
    chartType: "bar",
    price: TIERS.simple.price, // current-snapshot lookup, cheaper than a time-series
    pinnedSubgraphId: "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV",
    buildQuery: (params) => ({
      query: `query TopPools($limit: Int!) {
        pools(first: $limit, orderBy: volumeUSD, orderDirection: desc) {
          id
          token0 { symbol }
          token1 { symbol }
          volumeUSD
        }
      }`,
      variables: { limit: Number(params.limit ?? 10) },
    }),
    transform: (raw) => {
      const rows = extractRows(raw, "pools") as Array<{
        token0: { symbol: string };
        token1: { symbol: string };
        volumeUSD: string;
      }>;
      return {
        labels: rows.map((r) => `${r.token0.symbol}/${r.token1.symbol}`),
        values: rows.map((r) => Number(r.volumeUSD)),
        seriesLabel: "Volume (USD)",
      };
    },
    verified: true,
  },
];

function extractRows(raw: unknown, key: string): unknown[] {
  const data = (raw as { data?: Record<string, unknown> })?.data ?? (raw as Record<string, unknown>);
  const rows = data?.[key];
  if (!Array.isArray(rows)) {
    throw new Error(`Expected array at "${key}" in query result, got: ${JSON.stringify(raw).slice(0, 200)}`);
  }
  return rows;
}

export function getTemplate(id: string): QueryTemplate | undefined {
  return TEMPLATES.find((t) => t.id === id);
}
