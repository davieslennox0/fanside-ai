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
import { pickBestSubgraph, executeQueryBySubgraphId } from "../server/mcpClient.js";
import { TEMPLATES } from "../server/templates.js";

let anyFailed = false;

for (const template of TEMPLATES) {
  console.log(`\n=== ${template.id} (${template.name}) ===`);
  try {
    const { candidate } = await pickBestSubgraph(template.protocolKeyword);
    console.log(`  subgraph: ${candidate.displayName ?? candidate.id} (${candidate.id})`);

    const { query, variables } = template.buildQuery({});
    const raw = await executeQueryBySubgraphId(candidate.id, query, variables);
    console.log("  raw response:", JSON.stringify(raw).slice(0, 500));

    const result = template.transform(raw);
    if (result.values.length === 0) {
      throw new Error("transform() returned zero data points — query ran but returned nothing usable");
    }
    console.log(`  PASS — ${result.values.length} data points, e.g. ${result.labels[0]}: ${result.values[0]}`);
  } catch (err) {
    anyFailed = true;
    console.log(`  FAIL — ${err.message}`);
  }
}

console.log(anyFailed ? "\nSome templates failed — see above. Do not mark those verified." : "\nAll templates passed.");
process.exit(anyFailed ? 1 : 0);
