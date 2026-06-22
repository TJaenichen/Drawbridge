// Docker-free M4 proof: load the Gitea demo config in the real Drawbridge server (via
// the MCP SDK client over stdio) and show the exactly-three allowlisted tools the agent
// would see. The server starting "ready" proves the config validated and loaded; the
// token is a dummy (listTools makes no upstream call).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(repo, "src/node/dist/index.js"), "--config", resolve(repo, "demo/drawbridge.gitea.yaml")],
  env: { ...process.env, GITEA_BASE_URL: "http://localhost:3000", GITEA_TOKEN: "dummy-token-for-proof" },
  stderr: "inherit",
});
const client = new Client({ name: "m4", version: "0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log("Gitea config loaded + validated. Allowlisted tools the agent can see:");
for (const t of tools) console.log(`  - ${t.name}: ${t.description}`);
console.log(`\nExactly ${tools.length} tools exposed — nothing else on the Gitea API is reachable.`);

await client.close();
process.exit(tools.length === 3 ? 0 : 1);
