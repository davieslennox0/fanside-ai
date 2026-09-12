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
  protocolKeyword: string; // search_subgraphs_by_keyword input
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
 * Curated "mini Dune" templates. Query shapes below follow the Uniswap v3
 * subgraph's well-documented, stable public schema (github.com/Uniswap/
 * v3-subgraph) — the two most standardized entities (UniswapDayData, Pool)
 * are used for the two templates most likely to verify cleanly on the first
 * try; the other two lean on much less standardized per-token schemas
 * (generic ERC-20 transfer/holder subgraphs vary a lot by which community
 * subgraph indexed that token) and are explicitly the ones most likely to
 * get dropped in scripts/verify-templates.mjs.
 */
export const TEMPLATES: QueryTemplate[] = [
  {
    id: "tvl-uniswap",
    name: "TVL over time — Uniswap v3",
    description: "Daily total value locked across all Uniswap v3 pools, most recent N days.",
    chartType: "line",
    price: TIERS.multi_field.price, // full time-series, costlier than a snapshot
    protocolKeyword: "uniswap v3",
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
    verified: false,
  },
  {
    id: "swap-volume-pools",
    name: "Swap volume by pool — Uniswap v3",
    description: "Top pools ranked by all-time swap volume (current snapshot, not historical).",
    chartType: "bar",
    price: TIERS.simple.price, // current-snapshot lookup, cheaper than a time-series
    protocolKeyword: "uniswap v3",
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
    verified: false,
  },
  {
    id: "daily-transfer-volume",
    name: "Daily transfer volume — named token",
    description: "Daily count of Transfer events for a token, most recent N days. Schema varies by which community subgraph indexed the token — unverified.",
    chartType: "line",
    price: TIERS.multi_field.price,
    protocolKeyword: "USDC token transfers",
    buildQuery: (params) => ({
      query: `query DailyTransfers($days: Int!) {
        tokenDayDatas(first: $days, orderBy: date, orderDirection: desc) {
          date
          dailyTxns
        }
      }`,
      variables: { days: Number(params.days ?? 30) },
    }),
    transform: (raw) => {
      const rows = extractRows(raw, "tokenDayDatas") as Array<{ date: number; dailyTxns: string }>;
      const sorted = [...rows].sort((a, b) => a.date - b.date);
      return {
        labels: sorted.map((r) => new Date(r.date * 1000).toISOString().slice(0, 10)),
        values: sorted.map((r) => Number(r.dailyTxns)),
        seriesLabel: "Transfers/day",
      };
    },
    verified: false,
  },
  {
    id: "top-holders",
    name: "Top holders — named token",
    description: "Largest current holders of a token by balance. Holder-level schemas are the least standardized across subgraphs — unverified.",
    chartType: "bar",
    price: TIERS.simple.price,
    protocolKeyword: "token holders",
    buildQuery: (params) => ({
      query: `query TopHolders($limit: Int!) {
        accountBalances(first: $limit, orderBy: amount, orderDirection: desc) {
          account { id }
          amount
        }
      }`,
      variables: { limit: Number(params.limit ?? 10) },
    }),
    transform: (raw) => {
      const rows = extractRows(raw, "accountBalances") as Array<{ account: { id: string }; amount: string }>;
      return {
        labels: rows.map((r) => `${r.account.id.slice(0, 6)}…${r.account.id.slice(-4)}`),
        values: rows.map((r) => Number(r.amount)),
        seriesLabel: "Balance",
      };
    },
    verified: false,
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
