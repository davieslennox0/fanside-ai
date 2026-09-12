import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const MCP_URL = process.env.GRAPH_MCP_URL ?? "https://subgraphs.mcp.thegraph.com/sse";
const GATEWAY_KEY = process.env.GRAPH_GATEWAY_API_KEY;

if (!GATEWAY_KEY) throw new Error("GRAPH_GATEWAY_API_KEY is not set");

let clientPromise: Promise<Client> | null = null;

async function getClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = (async () => {
      const transport = new SSEClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
        eventSourceInit: {
          fetch: (url, init) =>
            fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${GATEWAY_KEY}` } }),
        },
      });
      const client = new Client({ name: "fanside-ai", version: "0.1.0" });
      await client.connect(transport);
      return client;
    })();
  }
  return clientPromise;
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const client = await getClient();
  const result = await client.callTool({ name, arguments: args });
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  const text = content.find((c) => c.type === "text")?.text;
  if (text === undefined) return result;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// Real shape returned by search_subgraphs_by_keyword, confirmed against the
// live MCP endpoint — the deployment's IPFS hash is nested, not a top-level
// field, and there is no top-level "deploymentId".
export interface SubgraphCandidate {
  id: string; // Subgraph Studio subgraph ID (e.g. "5zvR82...")
  metadata?: { displayName?: string };
  currentVersion?: { subgraphDeployment?: { ipfsHash?: string } };
  [key: string]: unknown;
}

function ipfsHashOf(candidate: SubgraphCandidate): string | undefined {
  return candidate.currentVersion?.subgraphDeployment?.ipfsHash;
}

function displayNameOf(candidate: SubgraphCandidate): string {
  return candidate.metadata?.displayName ?? candidate.id;
}

// search_subgraphs_by_keyword only accepts `keyword` — no server-side limit
// param, so trim client-side.
export async function searchSubgraphsByKeyword(keyword: string, limit = 10): Promise<SubgraphCandidate[]> {
  const result = await callTool("search_subgraphs_by_keyword", { keyword });
  const list = Array.isArray(result)
    ? (result as SubgraphCandidate[])
    : ((result as { subgraphs?: SubgraphCandidate[] })?.subgraphs ?? []);
  return list.slice(0, limit);
}

export async function get30DayQueryCounts(ipfsHash: string): Promise<unknown> {
  return callTool("get_deployment_30day_query_counts", { ipfs_hashes: [ipfsHash] });
}

export async function getSchemaBySubgraphId(subgraphId: string): Promise<unknown> {
  return callTool("get_schema_by_subgraph_id", { subgraph_id: subgraphId });
}

export async function executeQueryBySubgraphId(subgraphId: string, query: string, variables?: Record<string, unknown>): Promise<unknown> {
  return callTool("execute_query_by_subgraph_id", { subgraph_id: subgraphId, query, variables: variables ?? {} });
}

// Finds deployments indexing a specific contract on a specific chain — not
// a generic "top N" list, despite the friendlier name.
export async function getTopSubgraphDeployments(chain: string, contractAddress: string): Promise<unknown> {
  return callTool("get_top_subgraph_deployments", { chain, contract_address: contractAddress });
}

/**
 * Documented Subgraph MCP workflow, step 1-2: search -> mandatory 30-day
 * query-count check on every candidate. Ranks by that count, highest first.
 *
 * In practice a fresh Gateway API key sees "0" for every candidate (the
 * count appears to be scoped to the querying key/gateway, not the
 * subgraph's real-world popularity), so ties are common — the ranking is
 * still real and still runs the mandatory check, but callers that need a
 * subgraph which actually resolves (some search hits are dev/test/
 * unallocated deployments that error on execution) should try candidates
 * in the returned order and fall through on failure rather than trusting
 * rank 0 blindly.
 */
export async function rankSubgraphsByUsage(keyword: string): Promise<Array<{ candidate: SubgraphCandidate; queryCount: number }>> {
  const candidates = await searchSubgraphsByKeyword(keyword);
  if (candidates.length === 0) {
    throw new Error(`No subgraphs found for keyword "${keyword}"`);
  }

  const scored = await Promise.all(
    candidates.map(async (candidate) => {
      const ipfsHash = ipfsHashOf(candidate);
      if (!ipfsHash) return { candidate, queryCount: 0 };
      try {
        const counts = await get30DayQueryCounts(ipfsHash);
        return { candidate, queryCount: extractQueryVolume(counts) };
      } catch {
        return { candidate, queryCount: 0 };
      }
    }),
  );

  return scored.sort((a, b) => b.queryCount - a.queryCount);
}

/**
 * Ranks candidates for `keyword` (mandatory 30-day count check included),
 * then tries `attempt` against each in ranked order, returning the first
 * one that succeeds. Needed because the count check alone doesn't catch
 * dev/test/unallocated deployments that share a display name with the real
 * thing but error out on actual execution (e.g. "subgraph not found: no
 * allocations") — this is what actually confirms "real usable data".
 */
export async function resolveWorkingSubgraph<T>(
  keyword: string,
  attempt: (candidate: SubgraphCandidate) => Promise<T>,
): Promise<{ candidate: SubgraphCandidate; result: T }> {
  const ranked = await rankSubgraphsByUsage(keyword);
  const errors: string[] = [];

  for (const { candidate } of ranked) {
    try {
      const result = await attempt(candidate);
      return { candidate, result };
    } catch (err) {
      errors.push(`${displayNameOf(candidate)} (${candidate.id}): ${(err as Error).message}`);
    }
  }

  throw new Error(`No working subgraph found for "${keyword}" — tried ${ranked.length}: ${errors.join("; ")}`);
}

function extractQueryVolume(counts: unknown): number {
  if (Array.isArray(counts)) {
    return counts.reduce((sum, entry) => {
      if (entry && typeof entry === "object") {
        const values = Object.values(entry as Record<string, unknown>).filter(
          (v): v is number => typeof v === "number",
        );
        return sum + values.reduce((a, b) => a + b, 0);
      }
      return sum;
    }, 0);
  }
  if (counts && typeof counts === "object") {
    const values = Object.values(counts as Record<string, unknown>).filter(
      (v): v is number => typeof v === "number",
    );
    if (values.length > 0) return values.reduce((a, b) => a + b, 0);
  }
  return 0;
}

export { displayNameOf };
