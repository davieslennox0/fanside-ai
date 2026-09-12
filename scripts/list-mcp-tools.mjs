import "dotenv/config";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const GATEWAY_KEY = process.env.GRAPH_GATEWAY_API_KEY;
const transport = new SSEClientTransport(new URL(process.env.GRAPH_MCP_URL), {
  requestInit: { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
  eventSourceInit: {
    fetch: (url, init) => fetch(url, { ...init, headers: { ...init?.headers, Authorization: `Bearer ${GATEWAY_KEY}` } }),
  },
});
const client = new Client({ name: "diag", version: "0.0.1" });
await client.connect(transport);
const { tools } = await client.listTools();
for (const t of tools) {
  console.log("===", t.name, "===");
  console.log(JSON.stringify(t.inputSchema, null, 2));
}
process.exit(0);
