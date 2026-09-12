const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = process.env.GROQ_MODEL ?? "openai/gpt-oss-120b";

if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not set");

export interface SynthesisInput {
  question: string;
  subgraphsUsed: Array<{ name: string; id: string }>;
  rawResults: unknown[];
}

/**
 * Synthesizes a natural-language answer from live Subgraph MCP query
 * results. This is the "meaningful synthesis, not raw-query passthrough"
 * step the track requires: the LLM never invents on-chain facts, it only
 * explains/summarizes the JSON it's handed.
 */
export async function synthesizeAnswer(input: SynthesisInput): Promise<string> {
  const system = [
    "You are Fanside, an AI agent that answers questions about on-chain activity",
    "using live data from The Graph's subgraphs. You are given the user's question",
    "and the raw JSON results of one or more real subgraph queries that were just",
    "executed. Write a clear, direct natural-language answer grounded ONLY in the",
    "provided data. Cite specific numbers from the data. If the data doesn't fully",
    "answer the question, say what's missing instead of guessing or inventing",
    "figures. Keep it concise — a few sentences to a short paragraph.",
  ].join(" ");

  const user = JSON.stringify(
    {
      question: input.question,
      subgraphs_queried: input.subgraphsUsed,
      raw_results: input.rawResults,
    },
    null,
    2,
  );

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq synthesis failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0]?.message?.content?.trim() ?? "";
}

export interface GeneratedQuery {
  query: string;
  variables: Record<string, unknown>;
}

/**
 * Turns a natural-language question plus a subgraph's real GraphQL schema
 * into an executable query. The model is given only the schema it's asked
 * about and told to use nothing else — this is what lets a free-text
 * question reach a live subgraph without a human writing GraphQL by hand.
 */
export async function generateGraphQLQuery(question: string, schemaSdl: string): Promise<GeneratedQuery> {
  const system = [
    "You write GraphQL queries for The Graph subgraphs. You will be given a",
    "subgraph's schema (SDL) and a user's question. Respond with ONLY a JSON",
    "object of the form {\"query\": \"...\", \"variables\": {...}} — a single valid",
    "GraphQL query string using only types/fields that exist in the given schema,",
    "plus any variables it needs. Keep result sets small (first: 5-10) unless the",
    "question clearly asks for more. No prose, no markdown fences, JSON only.",
  ].join(" ");

  const user = `Schema:\n${schemaSdl}\n\nQuestion: ${question}`;

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq query generation failed: ${res.status} ${body}`);
  }

  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  const content = data.choices[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(content) as GeneratedQuery;
  if (!parsed.query) throw new Error("Model did not return a query");
  return { query: parsed.query, variables: parsed.variables ?? {} };
}
