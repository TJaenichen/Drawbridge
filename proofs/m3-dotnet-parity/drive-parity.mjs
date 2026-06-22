// M3 cross-language parity proof: drive the SAME MCP client sequence against the Node
// server and the .NET server (each over stdio, against a fresh stateful stub), then
// compare results structurally. Proves the .NET runtime speaks MCP (interop with the
// official SDK client) and behaves identically to Node.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStub } from "./stub-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const example = resolve(repo, "specs/drawbridge.config.example.yaml");
const txt = (r) => (r.content ?? []).map((c) => c.text).join("\n");

async function run(command, args, port) {
  const { server } = await startStub(port);
  const transport = new StdioClientTransport({
    command,
    args,
    env: { ...process.env, TRACKER_BASE_URL: `http://localhost:${port}`, TRACKER_TOKEN: "parity-token" },
    stderr: "ignore",
  });
  const client = new Client({ name: "parity", version: "0" });
  await client.connect(transport);

  const out = {};
  out.tools = (await client.listTools()).tools.map((t) => t.name).sort();
  out.before = JSON.parse(txt(await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} })));
  out.created = JSON.parse(txt(await client.callTool({ name: "internal_tracker_create_work_item", arguments: { title: "Parity check" } })));
  out.after = JSON.parse(txt(await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} })));
  const refused = await client.callTool({ name: "internal_tracker_nuke", arguments: {} });
  out.refused = { isError: refused.isError === true, text: txt(refused) };

  await client.close();
  server.close();
  return out;
}

const canon = (x) =>
  Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])]))
    : x;

const nodeOut = await run("node", [resolve(repo, "src/node/dist/index.js"), "--config", example], 4061);
const dllPath = resolve(repo, "src/dotnet/src/Drawbridge.Cli/bin/Debug/net10.0/Drawbridge.Cli.dll");
const dotnetOut = await run("dotnet", [dllPath, "--config", example], 4062);

console.log("== Node server ==");
console.log(JSON.stringify(nodeOut, null, 2));
console.log("\n== .NET server ==");
console.log(JSON.stringify(dotnetOut, null, 2));

const match = JSON.stringify(canon(nodeOut)) === JSON.stringify(canon(dotnetOut));
console.log(`\n== PARITY: ${match ? "OK — Node and .NET produced structurally identical results" : "MISMATCH"} ==`);
process.exit(match ? 0 : 1);
