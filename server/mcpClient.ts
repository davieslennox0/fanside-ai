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

export interface SubgraphCandidate {
  id: string;
  displayName?: string;
  ipfsHash?: string;
  deploymentId?: string;
  [key: string]: unknown;
}

export async function searchSubgraphsByKeyword(keyword: string, limit = 5): Promise<SubgraphCandidate[]> {
  const result = await callTool("search_subgraphs_by_keyword", { keyword, limit });
  return Array.isArray(result) ? (result as SubgraphCandidate[]) : ((result as { subgraphs?: SubgraphCandidate[] })?.subgraphs ?? []);
}

export async function get30DayQueryCounts(deploymentId: string): Promise<unknown> {
  return callTool("get_deployment_30day_query_counts", { deployment_id: deploymentId });
}

export async function getSchemaBySubgraphId(subgraphId: string): Promise<unknown> {
  return callTool("get_schema_by_subgraph_id", { subgraph_id: subgraphId });
}

export async function executeQueryBySubgraphId(subgraphId: string, query: string, variables?: Record<string, unknown>): Promise<unknown> {
  return callTool("execute_query_by_subgraph_id", { subgraph_id: subgraphId, query, variables: variables ?? {} });
}

export async function getTopSubgraphDeployments(limit = 10): Promise<unknown> {
  return callTool("get_top_subgraph_deployments", { limit });
}

/**
 * Documented Subgraph MCP workflow: search -> mandatory 30-day query-count
 * check (picks the deployment that's actually being used/maintained, not a
 * stale abandoned one with the same name) -> schema -> execute.
 * Returns the chosen subgraph plus everything the synthesis step needs to
 * cite where the data came from.
 */
export async function pickBestSubgraph(keyword: string): Promise<{ candidate: SubgraphCandidate; queryCounts: unknown }> {
  const candidates = await searchSubgraphsByKeyword(keyword);
  if (candidates.length === 0) {
    throw new Error(`No subgraphs found for keyword "${keyword}"`);
  }

  let best = candidates[0];
  let bestCounts: unknown = null;
  let bestScore = -1;

  for (const candidate of candidates.slice(0, 3)) {
    const deploymentId = candidate.deploymentId ?? candidate.id;
    try {
      const counts = await get30DayQueryCounts(deploymentId);
      const score = extractQueryVolume(counts);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
        bestCounts = counts;
      }
    } catch {
      // If the count check fails for a candidate, skip it rather than fail the whole request.
    }
  }

  return { candidate: best, queryCounts: bestCounts };
}

function extractQueryVolume(counts: unknown): number {
  if (counts && typeof counts === "object") {
    const values = Object.values(counts as Record<string, unknown>).filter(
      (v): v is number => typeof v === "number",
    );
    if (values.length > 0) return values.reduce((a, b) => a + b, 0);
  }
  return 0;
}
