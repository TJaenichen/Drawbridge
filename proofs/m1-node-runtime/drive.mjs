// M1 proof driver: connect a real MCP client over stdio to the built Drawbridge
// server, pointed at the stateful stub. Demonstrates tool generation, request
// execution + auth injection, real before/after state, and the closed-world guard.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStub } from "./stub-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const PORT = 4055;

const { server, log } = await startStub(PORT);

const transport = new StdioClientTransport({
  command: "node",
  args: [resolve(repo, "src/node/dist/index.js"), "--config", resolve(repo, "specs/drawbridge.config.example.yaml")],
  env: { ...process.env, TRACKER_BASE_URL: `http://localhost:${PORT}`, TRACKER_TOKEN: "proof-token-123" },
  stderr: "inherit",
});
const client = new Client({ name: "m1-proof", version: "0" });
await client.connect(transport);

const print = (label, r) => {
  const texts = (r.content ?? []).map((c) => c.text);
  console.log(`\n== ${label} ==${r.isError ? "  (isError)" : ""}`);
  console.log(texts.join("\n"));
};

const tools = await client.listTools();
console.log("== generated tools ==");
console.log(tools.tools.map((t) => `${t.name}`).join(", "));

print("BEFORE: list_work_items", await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} }));
print("create_work_item {title: 'Investigate prod timeout'}", await client.callTool({ name: "internal_tracker_create_work_item", arguments: { title: "Investigate prod timeout" } }));
print("AFTER: list_work_items", await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} }));
print("get_work_item {id: 1}", await client.callTool({ name: "internal_tracker_get_work_item", arguments: { id: 1 } }));
print("closed-world: undeclared tool is refused", await client.callTool({ name: "internal_tracker_delete_everything", arguments: {} }));

console.log("\n== stub server request log (note auth=present on every call) ==");
console.log(log.join("\n"));

await client.close();
server.close();
process.exit(0);
