import { executeQueryBySubgraphId } from "./mcpClient.js";

export interface WidgetRow {
  label: string;
  value: number;
  meta?: string; // secondary detail shown alongside the row (e.g. tx hash, timestamp)
}

export interface WidgetData {
  id: string;
  title: string;
  valueLabel: string; // what `value` in each row represents, for axis/column labels
  rows: WidgetRow[];
}

export interface WidgetDef {
  id: string;
  title: string;
  description: string;
  subgraphId: string; // pinned, same reasoning as server/templates.ts
  valueLabel: string;
  fetch: () => Promise<WidgetRow[]>;
}

const AAVE_V3_ETHEREUM = "JCNWRypm7FYwV8fx5HhzZPSFaMxgkPuw4TnR3Gpi81zk"; // "Aave V3 Ethereum"
const UNISWAP_V3_ETHEREUM = "5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV"; // "Uniswap-V3"
const ENS_ETHEREUM = "5XqPmWe6gjyrJtFn9cLy237i4cWw2j9HcUJEXsP5qGtH"; // "ENS"

function short(addr: string): string {
  return addr.length > 10 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/**
 * Third widget slot was originally scoped as "top Robinhood-launched
 * tokens by volume" — searched Subgraph MCP for "robinhood", "tokenized
 * stock", "dinari", "xstock", "backed finance", "tokenized equity",
 * "stock token arbitrum", "RWA stock": zero results for every term. No
 * actively-indexed subgraph exists for Robinhood's tokenized stock
 * launches, so that widget isn't feasible with real Graph data and isn't
 * shipped. Replaced with recent ENS registrations — real, live, and
 * verified against the same mainnet ENS subgraph other Ethereum tooling
 * uses.
 */
export const WIDGETS: WidgetDef[] = [
  {
    id: "aave-top-lenders",
    title: "Top 15 Aave v3 lenders",
    description: "Largest open collateral positions on Aave v3 Ethereum, by current balance.",
    subgraphId: AAVE_V3_ETHEREUM,
    valueLabel: "Balance (native units)",
    fetch: async () => {
      const raw = (await executeQueryBySubgraphId(
        AAVE_V3_ETHEREUM,
        `query {
          positions(where: {side: COLLATERAL, hashClosed: null}, orderBy: balance, orderDirection: desc, first: 15) {
            account { id }
            balance
            asset { symbol decimals }
          }
        }`,
        {},
      )) as { data: { positions: Array<{ account: { id: string }; balance: string; asset: { symbol: string; decimals: number } }> } };

      return raw.data.positions.map((p) => ({
        label: short(p.account.id),
        value: Number(p.balance) / 10 ** p.asset.decimals,
        meta: p.asset.symbol,
      }));
    },
  },
  {
    id: "uniswap-large-swaps",
    title: "Uniswap v3 swaps over $50K",
    description: "Most recent Uniswap v3 Ethereum swaps with USD value above $50,000.",
    subgraphId: UNISWAP_V3_ETHEREUM,
    valueLabel: "Amount (USD)",
    fetch: async () => {
      const raw = (await executeQueryBySubgraphId(
        UNISWAP_V3_ETHEREUM,
        `query {
          swaps(where: {amountUSD_gt: "50000"}, orderBy: timestamp, orderDirection: desc, first: 15) {
            timestamp
            amountUSD
            token0 { symbol }
            token1 { symbol }
            transaction { id }
          }
        }`,
        {},
      )) as {
        data: {
          swaps: Array<{
            timestamp: string;
            amountUSD: string;
            token0: { symbol: string };
            token1: { symbol: string };
            transaction: { id: string };
          }>;
        };
      };

      return raw.data.swaps.map((s) => ({
        label: `${s.token0.symbol}/${s.token1.symbol}`,
        value: Number(s.amountUSD),
        meta: short(s.transaction.id),
      }));
    },
  },
  {
    id: "ens-recent-registrations",
    title: "Recent ENS registrations",
    description: "Most recently registered .eth names and what they cost, mainnet ENS registry.",
    subgraphId: ENS_ETHEREUM,
    valueLabel: "Cost (ETH)",
    fetch: async () => {
      const raw = (await executeQueryBySubgraphId(
        ENS_ETHEREUM,
        `query {
          registrations(orderBy: registrationDate, orderDirection: desc, first: 15) {
            domain { name }
            cost
            registrant { id }
          }
        }`,
        {},
      )) as {
        data: {
          registrations: Array<{ domain: { name: string | null }; cost: string | null; registrant: { id: string } }>;
        };
      };

      return raw.data.registrations.map((r) => ({
        label: r.domain.name ?? "(unknown)",
        value: Number(r.cost ?? 0) / 1e18,
        meta: short(r.registrant.id),
      }));
    },
  },
];

export async function fetchAllWidgets(): Promise<Record<string, WidgetData & { fetchedAt: string; error?: string }>> {
  const result: Record<string, WidgetData & { fetchedAt: string; error?: string }> = {};

  for (const widget of WIDGETS) {
    const fetchedAt = new Date().toISOString();
    try {
      const rows = await widget.fetch();
      result[widget.id] = { id: widget.id, title: widget.title, valueLabel: widget.valueLabel, rows, fetchedAt };
    } catch (err) {
      result[widget.id] = { id: widget.id, title: widget.title, valueLabel: widget.valueLabel, rows: [], fetchedAt, error: (err as Error).message };
    }
  }

  return result;
}
