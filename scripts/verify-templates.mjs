#!/usr/bin/env node
// Standalone, unpaid verification: runs each template in server/templates.ts
// directly against the live Subgraph MCP (no x402 layer involved) and
// prints whether it returned real, usable rows. Nothing here is mocked —
// a failure here means the template genuinely doesn't resolve as written.
//
// Requires GRAPH_GATEWAY_API_KEY in .env. Run with:
//   npm run verify-templates
//
// After a template passes, flip its `verified: false` to `verified: true`
// in server/templates.ts so it gets wired into the paid /api/template/:id
// route and shown as runnable on the templates page.

import "dotenv/config";
import { runTemplate } from "../server/templateRunner.js";
import { TEMPLATES } from "../server/templates.js";

let anyFailed = false;

for (const template of TEMPLATES) {
  console.log(`\n=== ${template.id} (${template.name}) ===`);
  try {
    const run = await runTemplate(template.id, {});
    console.log(`  subgraph: ${run.subgraphUsed.name} (${run.subgraphUsed.id})`);
    console.log(`  PASS — ${run.result.values.length} data points, e.g. ${run.result.labels[0]}: ${run.result.values[0]}`);
  } catch (err) {
    anyFailed = true;
    console.log(`  FAIL — ${err.message}`);
  }
}

console.log(anyFailed ? "\nSome templates failed — see above. Do not mark those verified." : "\nAll templates passed.");
process.exit(anyFailed ? 1 : 0);
