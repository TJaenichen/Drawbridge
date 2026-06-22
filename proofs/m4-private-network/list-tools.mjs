// Docker-free M4 proof: load each demo config in the real Drawbridge server (via the
// MCP SDK client over stdio) and show the allowlisted tools the agent would see. The
// server reaching "ready" proves the config validated + loaded (incl. static headers
// like GitHub's User-Agent); tokens are dummies (listTools makes no upstream call).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const server = resolve(repo, "src/node/dist/index.js");

const targets = [
  { name: "GitHub (drawbridge.github.yaml)", config: "demo/drawbridge.github.yaml", env: { GITHUB_TOKEN: "dummy-token" } },
  { name: "Gitea (drawbridge.gitea.yaml)", config: "demo/drawbridge.gitea.yaml", env: { GITEA_BASE_URL: "http://localhost:3000", GITEA_TOKEN: "dummy-token" } },
];

let ok = true;
for (const t of targets) {
  const transport = new StdioClientTransport({
    command: "node",
    args: [server, "--config", resolve(repo, t.config)],
    env: { ...process.env, ...t.env },
    stderr: "ignore",
  });
  const client = new Client({ name: "m4", version: "0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  console.log(`\n${t.name} — config validated + loaded. Allowlisted tools:`);
  for (const tool of tools) console.log(`  - ${tool.name}: ${tool.description}`);
  console.log(`  => exactly ${tools.length} tools; nothing else on the API is reachable.`);
  if (tools.length !== 3) ok = false;
  await client.close();
}
process.exit(ok ? 0 : 1);
