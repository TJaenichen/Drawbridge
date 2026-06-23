// M6 proof driver: prove BOTH built servers, given ZERO audit configuration
// (DRAWBRIDGE_AUDIT_FILE unset), write their audit JSONL to the default location
// ~/.drawbridge/audit.jsonl — the monitor's zero-config rendezvous file (DESIGN §10/§11).
//
// For each language we point HOME/USERPROFILE at a throwaway temp dir (so the proof is
// hermetic and never touches the real home), drive a few tool calls over stdio through a
// real MCP client, then read back the default audit file and check:
//   - the file was created at <home>/.drawbridge/audit.jsonl with one JSONL record per call,
//   - stdout stayed pure MCP protocol (the client parsed every response — a stray byte breaks it),
//   - the bearer token never appears in the audit file (secret confinement, §8c),
//   - a refused (undeclared) tool is audited with outcome "refused".
// Finally we compare the two languages' (operation, outcome) sequences for parity (§13).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStub } from "./stub-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const config = resolve(repo, "specs/drawbridge.config.example.yaml");
const TOKEN = "proof-token-123";
const out = [];
const say = (s = "") => { out.push(s); console.log(s); };

const IMPLS = [
  { label: "Node / TypeScript", command: "node", args: [resolve(repo, "src/node/dist/index.js")] },
  {
    label: ".NET / C#",
    command: "dotnet",
    args: [resolve(repo, "src/dotnet/src/Drawbridge.Cli/bin/Release/net10.0/Drawbridge.Cli.dll")],
  },
];

async function runImpl(impl, port) {
  // Fresh stub per language so each run sees identical backend state (independent proofs).
  const { server } = await startStub(port);
  const home = mkdtempSync(join(tmpdir(), "drawbridge-home-"));
  const env = { ...process.env, TRACKER_BASE_URL: `http://localhost:${port}`, TRACKER_TOKEN: TOKEN, HOME: home, USERPROFILE: home };
  delete env.DRAWBRIDGE_AUDIT_FILE; // the whole point: NO explicit audit config

  const transport = new StdioClientTransport({
    command: impl.command,
    args: [...impl.args, "--config", config],
    env,
    stderr: "inherit",
  });
  const client = new Client({ name: "m6-proof", version: "0" });
  await client.connect(transport);

  try {
    await client.callTool({ name: "internal_tracker_create_work_item", arguments: { title: "Audit-path proof item" } });
    await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} });
    await client.callTool({ name: "internal_tracker_get_work_item", arguments: { id: 1 } });
    // undeclared tool -> closed-world refusal, audited with outcome "refused"
    await client.callTool({ name: "internal_tracker_delete_everything", arguments: {} });
  } finally {
    await client.close();
    server.close();
  }

  const auditPath = join(home, ".drawbridge", "audit.jsonl");
  const raw = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
  const records = raw.trim() ? raw.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
  return { home, auditPath, raw, records };
}

const summaries = [];
let port = 4056;
for (const impl of IMPLS) {
  say(`\n================  ${impl.label}  ================`);
  const r = await runImpl(impl, port++);
  say(`default audit file: ${r.auditPath.replace(r.home, "<temp-home>")}`);
  say(`exists: ${existsSync(r.auditPath)}   records: ${r.records.length}`);
  say(`secret "${TOKEN}" present in audit file: ${r.raw.includes(TOKEN)}  (must be false)`);
  say("records (operation / method / status / outcome):");
  for (const rec of r.records) say(`  - ${rec.operation}  ${rec.method || "-"}  ${rec.status}  ${rec.outcome}`);
  summaries.push({ label: impl.label, seq: r.records.map((x) => `${x.operation}:${x.outcome}`), token: r.raw.includes(TOKEN), count: r.records.length });
  rmSync(r.home, { recursive: true, force: true });
}

say("\n================  cross-language parity (§13)  ================");
const [a, b] = summaries;
const seqEqual = JSON.stringify(a.seq) === JSON.stringify(b.seq);
say(`${a.label} sequence: ${a.seq.join(", ")}`);
say(`${b.label} sequence: ${b.seq.join(", ")}`);
say(`identical (operation:outcome) sequence: ${seqEqual}`);

const refusedAudited =
  a.seq.includes("internal_tracker_delete_everything:refused") &&
  b.seq.includes("internal_tracker_delete_everything:refused");
const ok = seqEqual && a.count === 4 && b.count === 4 && !a.token && !b.token && refusedAudited;
say(`refused (undeclared) tool audited as outcome "refused" in both: ${refusedAudited}`);
say(`\nRESULT: ${ok ? "PASS" : "FAIL"} — both languages defaulted to ~/.drawbridge/audit.jsonl, 4 audited records each, no secret, identical sequence.`);

writeFileSync(join(here, "proof-output.txt"), out.join("\n") + "\n");
process.exit(ok ? 0 : 1);
