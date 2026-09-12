import "dotenv/config";
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { paymentMiddleware } from "@x402/express";
import type { RoutesConfig, HTTPRequestContext } from "@x402/core/server";
import { resourceServer, sellerAddress, NETWORK } from "./facilitator.js";
import { classifyComplexity } from "./pricing.js";
import { answerQuestion } from "./agent.js";
import { logActivity, getActivity, getStats } from "./activity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 4050);
const DOMAIN_NAME = process.env.DOMAIN_NAME ?? `localhost:${PORT}`;

function questionFromContext(context: HTTPRequestContext): string {
  const body = context.adapter.getBody?.() as { question?: string } | undefined;
  return body?.question ?? "";
}

const routes: RoutesConfig = {
  "/api/ask": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: sellerAddress,
      price: (context) => classifyComplexity(questionFromContext(context)).price,
    },
    description: "Ask Fanside a natural-language question about on-chain activity (human/chat use).",
  },
  "/api/agent/query": {
    accepts: {
      scheme: "exact",
      network: NETWORK,
      payTo: sellerAddress,
      price: (context) => classifyComplexity(questionFromContext(context)).price,
    },
    description:
      "Machine-facing endpoint for other agents/apps. POST { question: string } after paying the x402 402 challenge; " +
      "receives { answer, tier, price, subgraphs_used, raw_results }. See /how-it-works for the machine-readable contract.",
  },
};

const app = express();
app.use(express.json());

app.use(paymentMiddleware(routes, resourceServer));

async function handleQuestion(req: Request, res: Response, caller: "human" | "agent") {
  const question = String(req.body?.question ?? "").trim();
  if (!question) {
    res.status(400).json({ error: "Missing 'question' in request body" });
    return;
  }

  const tier = classifyComplexity(question);
  try {
    const result = await answerQuestion(question);
    await logActivity({
      timestamp: new Date().toISOString(),
      question,
      tier: result.tier.tier,
      price: result.tier.price,
      subgraphsUsed: result.subgraphsUsed.map((s) => s.name),
      caller,
      ok: true,
    });
    res.json({
      answer: result.answer,
      tier: result.tier.tier,
      price_usdc: result.tier.price,
      subgraphs_used: result.subgraphsUsed,
      raw_results: result.rawResults,
    });
  } catch (err) {
    await logActivity({
      timestamp: new Date().toISOString(),
      question,
      tier: tier.tier,
      price: tier.price,
      subgraphsUsed: [],
      caller,
      ok: false,
    });
    console.error(err);
    res.status(502).json({ error: "Failed to answer question", detail: (err as Error).message });
  }
}

app.post("/api/ask", (req, res) => handleQuestion(req, res, "human"));
app.post("/api/agent/query", (req, res) => handleQuestion(req, res, "agent"));

// --- Dashboard / site data API (free, unauthenticated reads) ---
app.get("/api/stats", async (_req, res) => {
  res.json(await getStats());
});

app.get("/api/activity", async (_req, res) => {
  res.json(await getActivity());
});

app.get("/api/config", (_req, res) => {
  res.json({
    domain: DOMAIN_NAME,
    network: NETWORK,
    sellerAddress,
    tiers: {
      simple: "0.02",
      multi_field: "0.05",
      composition: "0.10",
    },
  });
});

app.use(express.static(path.join(__dirname, "..", "site")));

app.listen(PORT, () => {
  console.log(`fanside-ai listening on :${PORT} (domain: ${DOMAIN_NAME}, network: ${NETWORK}, seller: ${sellerAddress})`);
});
