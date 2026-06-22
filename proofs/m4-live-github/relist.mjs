// Read-only: list issues through the proxy (used to refresh the list after GitHub's
// brief create-then-list consistency lag). Token comes from the environment.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const token = process.env.DRAWBRIDGE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) { console.error("set DRAWBRIDGE_GITHUB_TOKEN"); process.exit(2); }

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(repo, "src/node/dist/index.js"), "--config", resolve(repo, "demo/drawbridge.github.yaml")],
  env: { ...process.env, GITHUB_TOKEN: token },
  stderr: "ignore",
});
const client = new Client({ name: "relist", version: "0" });
await client.connect(transport);
const txt = (r) => (r.content ?? []).map((c) => c.text).join("\n");

const list = JSON.parse(txt(await client.callTool({ name: "github_list_issues", arguments: { owner: "TJaenichen", repo: "Drawbridge" } })));
console.log("== github_list_issues (state=open) ==");
console.log(list.map((i) => `#${i.number} ${i.title} — ${i.state}`).join("\n") || "(none)");
await client.close();
process.exit(0);
