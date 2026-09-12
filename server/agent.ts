import { resolveWorkingSubgraph, getSchemaBySubgraphId, executeQueryBySubgraphId, displayNameOf } from "./mcpClient.js";
import { generateGraphQLQuery, synthesizeAnswer } from "./synth.js";
import { classifyComplexity, type TierInfo } from "./pricing.js";

const PROTOCOL_KEYWORDS = [
  "uniswap", "aave", "compound", "ens", "lido", "curve", "balancer",
  "makerdao", "maker", "sushiswap", "sushi", "opensea", "seaport",
  "chainlink", "gmx", "pancakeswap", "1inch", "yearn", "synthetix",
  "rocketpool", "rocket pool", "frax", "convex", "morpho",
];

function extractKeywords(question: string): string[] {
  const q = question.toLowerCase();
  const hits = PROTOCOL_KEYWORDS.filter((kw) => q.includes(kw));
  return hits.length > 0 ? [...new Set(hits)] : [question];
}

function schemaToSdl(schema: unknown): string {
  if (typeof schema === "string") return schema;
  if (schema && typeof schema === "object") {
    const s = schema as Record<string, unknown>;
    for (const key of ["schema", "sdl", "data", "result"]) {
      if (typeof s[key] === "string") return s[key] as string;
    }
  }
  return JSON.stringify(schema);
}

export interface AnswerResult {
  answer: string;
  tier: TierInfo;
  subgraphsUsed: Array<{ name: string; id: string }>;
  rawResults: unknown[];
}

/**
 * Full pipeline for one paid question: keyword search -> mandatory 30-day
 * query-count check -> schema -> LLM-generated GraphQL -> live execution ->
 * synthesis. Runs one subgraph per extracted keyword so a "composition"
 * question (mentions 2+ protocols) really does query 2+ live subgraphs.
 */
export async function answerQuestion(question: string): Promise<AnswerResult> {
  const tier = classifyComplexity(question);
  const keywords = extractKeywords(question);

  const subgraphsUsed: Array<{ name: string; id: string }> = [];
  const rawResults: unknown[] = [];

  for (const keyword of keywords) {
    const { candidate, result: attemptResult } = await resolveWorkingSubgraph(keyword, async (c) => {
      const schema = await getSchemaBySubgraphId(c.id);
      const sdl = schemaToSdl(schema);
      const { query, variables } = await generateGraphQLQuery(question, sdl);
      const result = await executeQueryBySubgraphId(c.id, query, variables);
      return { query, result };
    });

    const name = displayNameOf(candidate);
    subgraphsUsed.push({ name, id: candidate.id });
    rawResults.push({ subgraph: name, query: attemptResult.query, result: attemptResult.result });
  }

  const answer = await synthesizeAnswer({ question, subgraphsUsed, rawResults });

  return { answer, tier, subgraphsUsed, rawResults };
}
