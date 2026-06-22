// Live end-to-end proof: drive the real GitHub REST API THROUGH the Drawbridge proxy
// (MCP client over stdio). Proves real bytes reach api.github.com with the injected
// User-Agent + bearer auth, and the typed/allowlisted tools work against a live service.
// Requires GITHUB_TOKEN in the env (forwarded to the server; never printed here).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const OWNER = "TJaenichen";
const REPO = "Drawbridge";
const token = process.env.DRAWBRIDGE_GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
if (!token) {
  console.error("set DRAWBRIDGE_GITHUB_TOKEN");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(repo, "src/node/dist/index.js"), "--config", resolve(repo, "demo/drawbridge.github.yaml")],
  env: { ...process.env, GITHUB_TOKEN: token },
  stderr: "ignore",
});
const client = new Client({ name: "live", version: "0" });
await client.connect(transport);
const txt = (r) => (r.content ?? []).map((c) => c.text).join("\n");

const title = "Drawbridge live-call proof";
const body = `Opened via the Drawbridge MCP proxy (github_create_issue) at ${new Date().toISOString()} — a live end-to-end proof that typed, allowlisted tools reach the real GitHub API through the bridge.`;

console.log("== github_create_issue ==");
const created = await client.callTool({ name: "github_create_issue", arguments: { owner: OWNER, repo: REPO, title, body } });
if (created.isError) {
  console.log("ERROR:", txt(created));
  await client.close();
  process.exit(1);
}
const issue = JSON.parse(txt(created));
console.log(`created #${issue.number}: ${issue.title}\nurl: ${issue.html_url}\nstate: ${issue.state}`);

console.log(`\n== github_get_issue #${issue.number} ==`);
const got = JSON.parse(txt(await client.callTool({ name: "github_get_issue", arguments: { owner: OWNER, repo: REPO, number: issue.number } })));
console.log(`#${got.number} ${got.title} — ${got.state}`);

console.log("\n== github_list_issues (state=open) ==");
const list = JSON.parse(txt(await client.callTool({ name: "github_list_issues", arguments: { owner: OWNER, repo: REPO } })));
console.log(list.map((i) => `#${i.number} ${i.title}`).join("\n"));

await client.close();
process.exit(0);
