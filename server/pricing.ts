export type Tier = "simple" | "multi_field" | "composition";

export interface TierInfo {
  tier: Tier;
  price: string; // USDC, decimal dollars, as @x402/evm's Money parser expects
  label: string;
  description: string;
}

export const TIERS: Record<Tier, TierInfo> = {
  simple: {
    tier: "simple",
    price: "0.02",
    label: "Single-subgraph lookup",
    description: "One subgraph, one field/entity (e.g. \"what's the current price of ETH on Uniswap v3\").",
  },
  multi_field: {
    tier: "multi_field",
    price: "0.05",
    label: "Multi-field query",
    description: "One subgraph, several fields/filters combined (e.g. top pools by volume AND fees over a time range).",
  },
  composition: {
    tier: "composition",
    price: "0.10",
    label: "Multi-subgraph composition",
    description: "Two or more subgraphs queried and combined (e.g. cross-referencing Uniswap liquidity with ENS ownership).",
  },
};

// Recognized protocol/subgraph keywords used only to *estimate* complexity
// before running the real query — not an exhaustive list, just enough
// signal to separate "one subgraph" from "several".
const PROTOCOL_KEYWORDS = [
  "uniswap", "aave", "compound", "ens", "lido", "curve", "balancer",
  "makerdao", "maker", "sushiswap", "sushi", "opensea", "seaport",
  "chainlink", "gmx", "pancakeswap", "1inch", "yearn", "synthetix",
  "rocketpool", "rocket pool", "frax", "convex", "morpho",
];

const MULTI_FIELD_SIGNALS = [
  " and ", " vs ", " versus ", " compare ", " both ", " each ", " top ",
  " over time", " historical", " trend", " breakdown", " by day", " by week",
];

export function classifyComplexity(question: string): TierInfo {
  const q = question.toLowerCase();

  const protocolHits = new Set(PROTOCOL_KEYWORDS.filter((kw) => q.includes(kw)));
  if (protocolHits.size >= 2) return TIERS.composition;

  const multiFieldHits = MULTI_FIELD_SIGNALS.filter((sig) => q.includes(sig)).length;
  const questionMarks = (q.match(/\?/g) ?? []).length;
  if (multiFieldHits >= 1 || questionMarks >= 2 || q.length > 220) return TIERS.multi_field;

  return TIERS.simple;
}
