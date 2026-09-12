# Fanside AI

An x402-payable AI agent that answers natural-language questions about on-chain
activity by querying **The Graph's Subgraph MCP live** and synthesizing the
result with an LLM. Built for ETHOnline 2026's **"Best AI Tooling or AI Use
Case with The Graph"** track — **Start Fresh** submission, no prior work.

Live: `https://${DOMAIN_NAME}` (dashboard at `/dashboard.html`).

## What it does

1. You (or another agent) POST a question to `/api/ask` (human) or
   `/api/agent/query` (machine-facing).
2. The server classifies the question's complexity into one of three tiers
   and responds `402 Payment Required` priced accordingly — **before** any
   query runs.
3. You pay the x402 challenge (EIP-3009 or Permit2 USDC authorization) and
   retry with the payment header.
4. Fanside's own server verifies and settles the payment itself on **Base**
   — no external facilitator.
5. Only then does it call **The Graph's Subgraph MCP** live: keyword search →
   mandatory 30-day query-count check → schema → an LLM-generated GraphQL
   query → real execution against the subgraph.
6. A second LLM call turns the raw JSON into a plain-language answer grounded
   only in that data.

Nothing is mocked or cached: every priced answer requires a live subgraph
round trip that happens after payment, not before.

## Why Base, not the other projects' rails

This account also runs Hedera+Blocky402 (`hedera-x402`) and X Layer
(`pitchook`) x402 sellers. Fanside is deliberately separate: a fresh EVM
deployer/relayer wallet, its own USDC contract address on Base, and its own
self-hosted facilitator — not registered on Pitchook's router, not sharing
any wallet or deployment. The Graph itself is chain-agnostic (subgraphs index
whatever chain they were built for, commonly Ethereum mainnet); Base here is
only the settlement chain for the x402 payment.

Self-hosting the facilitator (rather than pointing at an external one like
Blocky402) mirrors the pattern already proven in `davieslennox0/pitchook`'s
Python `x402_seller.py`: the seller's own relayer key verifies the buyer's
EIP-3009/Permit2 signature and broadcasts settlement itself. Here it's ported
to TypeScript on top of `@x402/evm`'s `ExactEvmScheme` facilitator + viem,
instead of web3.py — see `server/facilitator.ts`.

## Architecture

```
server/
  facilitator.ts   self-hosted x402 facilitator + resource server wiring (viem + @x402/evm)
  pricing.ts        complexity classifier -> 3 pricing tiers, priced pre-execution
  mcpClient.ts       Subgraph MCP client (search -> query-count check -> schema -> execute)
  synth.ts           Groq calls: (a) NL question + schema -> GraphQL, (b) raw results -> NL answer
  agent.ts           orchestrates one paid question end to end
  activity.ts        append-only local log backing the dashboard's charts/table
  templates.ts        curated "mini Dune" query templates + verified flag
  templateRunner.ts    runs one template end to end (subgraph pick -> query -> transform)
  templateResults.ts   stores each template's latest REAL run for the templates page
  index.ts           Express app: payment-gated routes + dashboard API + static site
scripts/
  verify-templates.mjs   unpaid, direct-to-MCP check of every template's real data
  e2e-template-run.mjs   full paid run of one template via the live x402 gate
site/
  index.html          landing
  how-it-works.html   pipeline explainer + agent-facing API contract
  templates.html       curated query templates, priced + payable, real charts only
  dashboard.html       live charts (query volume, tier distribution) + activity table
```

## Pricing tiers

| Tier | Price | Example |
|---|---|---|
| Simple (single-subgraph lookup) | $0.02 | "What's the TVL of Aave right now?" |
| Multi-field | $0.05 | "Top 5 Uniswap pools by volume and fees this week" |
| Composition (multi-subgraph) | $0.10 | "Compare Uniswap and Aave activity this month" |

Classification is a lightweight heuristic on the question text (protocol
keyword count + multi-clause signals) — deliberately simple rather than
another network round trip, since the whole point is to price *before*
touching the subgraph.

## Agent-facing endpoint

`POST /api/agent/query` takes the same `{ "question": string }` body as the
human endpoint but is documented for programmatic callers: the response
includes `subgraphs_used` and `raw_results`, not just the prose answer, so a
calling agent can act on the underlying data. See `/how-it-works.html` for
the full request/response contract — this is meant as reusable
infrastructure other agents/apps can call, not just a chat UI.

## Query templates ("mini Dune")

`/templates.html` offers a small set of curated, pre-built queries — pick one,
pay its price, get a real chart. Same x402 gate and self-hosted facilitator as
`/api/ask`, just with a fixed query instead of a free-text question, so each
template's price is pulled straight from `pricing.ts`'s existing tier scale
(a full time-series costs the `multi_field` price, a current-snapshot ranking
costs the `simple` price) rather than a new pricing scheme.

A template only becomes payable — wired into `/api/template/:id` and offered
on the templates page — once `npm run verify-templates` confirms it against
**live** Subgraph MCP data. This is a real gate, not a formality: it caught
real problems (see below) before anything went live.

**Shipped, verified (2):** both pinned to Subgraph Studio ID
`5zvR82QoaXYFyDEKLZ9t6v9adgnptxYpKpSbxtgVENFV` ("Uniswap-V3"), the real
canonical Uniswap v3 Ethereum mainnet subgraph.
- `tvl-uniswap` — TVL over time (`$0.05`)
- `swap-volume-pools` — swap volume by pool, e.g. USDC/WETH, WETH/USDT (`$0.02`)

**Attempted and dropped (2):** "daily transfer volume" and "top holders" for
a named token, both meant to be generic across any ERC-20. Every candidate
subgraph found — via keyword search and via `get_top_subgraph_deployments`
for USDC's own contract address — came back `subgraph not found: no
allocations` at query time (no indexer currently serving that deployment),
even for one with substantial historical query fees. Schema fetches for these
succeeded fine; only live execution failed, which is exactly the distinction
`npm run verify-templates` exists to catch. Not shipping these two rather than
silently resolving to whichever unrelated schema happened to answer.

**Why pinned IDs, not live keyword search:** the first pass of `tvl-uniswap`
resolved to `uniswap-v4-base-3` — a Uniswap v4 Base subgraph that happens to
expose fields with the same names (`uniswapDayDatas`, `pools`) as v3's schema,
so the query executed and returned real numbers, just not from what the
template claims to measure. The Subgraph MCP's own mandatory 30-day
query-count check didn't help disambiguate — with a fresh Gateway API key
every candidate reports `0` (that count appears scoped to the querying
key/gateway, not the subgraph's real-world popularity). Curated templates
pin an exact, manually-confirmed subgraph ID instead of trusting keyword
search fresh on every run; free-text questions in `/api/ask` still use live
keyword search since there's no way to pre-curate those.

To re-run verification or add more templates:

```bash
npm run verify-templates                  # unpaid, direct-to-MCP check of every template
npm run server                            # restart to pick up any newly-payable routes
npm run e2e-template-run -- tvl-uniswap   # real paid run: pay on Base, get a real chart
```

`e2e-template-run` needs `BUYER_PRIVATE_KEY` funded with Base Sepolia ETH and
testnet USDC — a second fresh wallet from `scripts/generate-wallet.mjs`,
separate from the seller/relayer key.

## Running it

```bash
npm install
cp .env.example .env
# fill in GRAPH_GATEWAY_API_KEY (thegraph.com/studio) and GROQ_API_KEY
node scripts/generate-wallet.mjs   # fresh Base wallet -> SELLER_ADDRESS/SELLER_PRIVATE_KEY
# fund SELLER_ADDRESS with Base Sepolia ETH (gas for settlement broadcasts)
npm run server
```

`DOMAIN_NAME` is read from the environment, never hardcoded, so this can be
pointed at a real domain without touching code.

## Friction / notes for anyone building on this

- `@x402/evm`'s package is split into `exact/client`, `exact/server`, and
  `exact/facilitator` subpaths, each exporting a *different* class named
  `ExactEvmScheme` for its own role — easy to import the wrong one. The
  server-side one (`exact/server`) is a small, chain-agnostic policy object;
  the facilitator-side one (`exact/facilitator`) is the one that actually
  needs a signer.
- `toFacilitatorEvmSigner` (top-level `@x402/evm` export) composes a plain
  object of viem calls into the `FacilitatorEvmSigner` the facilitator scheme
  expects — no need to hand-write that adapter class, unlike the Python SDK
  reference this was ported from.
- `x402Facilitator.getSupported()` is synchronous and returns
  `{kinds, extensions, signers}`, while the `FacilitatorClient` interface
  `x402ResourceServer` expects wants an async `getSupported()` returning
  `SupportedResponse` (`{kinds, signers}`) — a thin `LocalFacilitatorClient`
  wrapper bridges the two in-process, with no HTTP hop to an external
  facilitator (see `server/facilitator.ts`).
- `@x402/evm`'s `DEFAULT_ASSETS` export ships the canonical USDC addresses
  per chain (including Base Sepolia's) — used that instead of guessing an
  address.
- The Subgraph MCP's real tool schemas (confirmed via `client.listTools()`,
  see `scripts/list-mcp-tools.mjs`) don't match what their friendly names
  suggest: `get_deployment_30day_query_counts` takes `ipfs_hashes: string[]`,
  not a `deployment_id`; `get_top_subgraph_deployments` takes `chain` +
  `contract_address` (find deployments indexing a contract) rather than a
  generic "top N" list; and `search_subgraphs_by_keyword` candidates carry
  the deployment IPFS hash nested at `currentVersion.subgraphDeployment.
  ipfsHash`, not a top-level field. Worth calling `listTools()` yourself
  before trusting a tool's name.
- Groq model catalogs differ per key — this project's key (reused from
  `hedera-x402`, see below) has no `llama-3.1`/`llama-3.3` model at all
  (`GET /v1/models` returns the qwen3/gpt-oss/allam/compound families only);
  requested `llama-3.1` and got a `model_not_found` 404, so this uses
  `openai/gpt-oss-20b` instead — check `/v1/models` for your own key rather
  than assuming a commonly-referenced model name is available.

**On the Groq key:** unlike the Gateway key and the Base wallet (fresh and
dedicated to this project, per the original brief), the Groq key is reused
from `hedera-x402` at the project owner's explicit direction — Groq isn't
the judged differentiator for this track, The Graph integration is, and the
two projects don't share rate-limit-sensitive load.

## Demo video shot list (2-4 min, not recorded in this session)

1. Landing page (`/`) — explain the pitch in one sentence.
2. `/how-it-works.html` — walk through the 6-step pipeline diagram.
3. Terminal: `curl` a question to `/api/ask`, show the real `402` with the
   priced `PAYMENT-REQUIRED` header.
4. Pay it (a small script/client signing the EIP-3009 authorization), show
   the `200` with a real synthesized answer.
5. Show the transaction on Base Sepolia's block explorer (real settlement).
6. Show Subgraph Studio's own usage dashboard ticking up from the live MCP
   call (proof it's not mocked).
7. `/dashboard.html` — the query just ran appears in the activity table and
   the tier-distribution chart updates.
8. Repeat once with a composition-tier question to show 2+ subgraphs queried.

## Open source

MIT-equivalent, public repo: `davieslennox0/fanside-ai`.
