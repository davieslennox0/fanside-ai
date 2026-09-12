#!/usr/bin/env node
// Full end-to-end verification for one template: pays the real x402
// challenge on Base with BUYER_PRIVATE_KEY, gets settled by the running
// server's self-hosted facilitator, and prints the real chart data plus
// the settlement transaction. Nothing here is mocked — a failure means a
// real step (payment, MCP query, or transform) genuinely broke.
//
// Requires the server already running (npm run server) and BUYER_PRIVATE_KEY
// funded with Base Sepolia ETH + testnet USDC. Run with:
//   node scripts/e2e-template-run.mjs <template-id> [baseUrl]

import "dotenv/config";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "@x402/fetch";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { decodePaymentResponseHeader } from "@x402/core/http";

const templateId = process.argv[2];
const baseUrl = process.argv[3] ?? `http://localhost:${process.env.PORT ?? 4050}`;

if (!templateId) {
  console.error("Usage: node scripts/e2e-template-run.mjs <template-id> [baseUrl]");
  process.exit(1);
}

const buyerKey = process.env.BUYER_PRIVATE_KEY;
if (!buyerKey) throw new Error("BUYER_PRIVATE_KEY is not set");

const account = privateKeyToAccount(buyerKey);
const network = `eip155:${process.env.BASE_CHAIN_ID ?? 84532}`;

const client = new x402Client().register(network, new ExactEvmScheme(account));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

console.log(`Paying for template "${templateId}" as ${account.address} on ${network}...`);

const res = await fetchWithPay(`${baseUrl}/api/template/${templateId}`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({}),
});

if (!res.ok) {
  console.error(`Request failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}

const body = await res.json();
console.log("\nResult:", JSON.stringify(body, null, 2));

const paymentResponseHeader = res.headers.get("payment-response") ?? res.headers.get("x-payment-response");
if (paymentResponseHeader) {
  const settlement = decodePaymentResponseHeader(paymentResponseHeader);
  console.log("\nSettlement:", JSON.stringify(settlement, null, 2));
} else {
  console.log("\n(No payment-response header found to decode — check response headers manually.)");
}
