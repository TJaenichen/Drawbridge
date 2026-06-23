// M7 proof driver: prove the `drawbridge monitor` subcommand renders a LIVE, read-only
// dashboard by tailing the audit log (DESIGN §11). Orchestration:
//   1. point the MCP server's audit at a temp file (DRAWBRIDGE_AUDIT_FILE),
//   2. start the real `drawbridge monitor` subcommand against that file (loopback),
//   3. drive tool calls through the MCP server so audit records append,
//   4. open the dashboard in headless Chromium (Playwright), screenshot it,
//   5. drive one MORE call and show the feed update LIVE (second screenshot),
//   6. assert the DOM reflects the audit stream (counts + a highlighted refusal).
import { chromium } from "playwright";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startStub } from "./stub-server.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../..");
const indexJs = resolve(repo, "src/node/dist/index.js");
const config = resolve(repo, "specs/drawbridge.config.example.yaml");
const PORT = 4738;
const STUB_PORT = 4060;
const TOKEN = "proof-token-123";
const out = [];
const say = (s = "") => { out.push(s); console.log(s); };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitForHttp(url, ms = 8000) {
  const start = Date.now();
  return new Promise((done, fail) => {
    const tick = () => {
      const req = http.get(url, (res) => { res.resume(); done(); });
      req.on("error", () => (Date.now() - start > ms ? fail(new Error("monitor never came up")) : setTimeout(tick, 100)));
    };
    tick();
  });
}

const auditDir = mkdtempSync(join(tmpdir(), "drawbridge-m7-"));
const auditFile = join(auditDir, "audit.jsonl");
writeFileSync(auditFile, ""); // start empty

const { server: stub } = await startStub(STUB_PORT);

// 1+2: start the real monitor subcommand against the temp audit file.
const monitor = spawn("node", [indexJs, "monitor", "--port", String(PORT), "--audit-file", auditFile], {
  stdio: ["ignore", "inherit", "inherit"],
});
await waitForHttp(`http://127.0.0.1:${PORT}/`);
say(`monitor up at http://127.0.0.1:${PORT} (tailing ${auditFile.replace(auditDir, "<temp>")})`);

// 2b: connect a real MCP client to the server, audit -> the same temp file.
const transport = new StdioClientTransport({
  command: "node",
  args: [indexJs, "--config", config],
  env: { ...process.env, TRACKER_BASE_URL: `http://localhost:${STUB_PORT}`, TRACKER_TOKEN: TOKEN, DRAWBRIDGE_AUDIT_FILE: auditFile },
  stderr: "inherit",
});
const client = new Client({ name: "m7-proof", version: "0" });
await client.connect(transport);

// 3: drive calls -> 3 ok + 1 error (upstream 404) + 1 refused = 5 audit records.
await client.callTool({ name: "internal_tracker_create_work_item", arguments: { title: "Monitor proof item" } });
await client.callTool({ name: "internal_tracker_list_work_items", arguments: {} });
await client.callTool({ name: "internal_tracker_get_work_item", arguments: { id: 1 } });
await client.callTool({ name: "internal_tracker_get_work_item", arguments: { id: 999 } }); // upstream 404 -> error
await client.callTool({ name: "internal_tracker_delete_everything", arguments: {} }); // refused

// 4: open the dashboard, wait for the stream to render all 5 rows incl. the refusal + error.
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForFunction(() => document.querySelectorAll('[data-testid="feed"] tbody tr.row').length >= 5, null, { timeout: 8000 });
await page.waitForSelector(".tag.refused");
await page.waitForSelector(".tag.error");
const shot1 = join(here, "dashboard.png");
await page.screenshot({ path: shot1, fullPage: true });

const total1 = await page.textContent(".card.total .value");
const refusedTag = await page.textContent(".tag.refused");
say(`after 5 calls: feed shows ${total1} requests; refusal + error rows are highlighted.`);

// 5: drive one MORE call and prove the feed updates LIVE (no reload).
await client.callTool({ name: "internal_tracker_create_work_item", arguments: { title: "Live update" } });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="feed"] tbody tr.row').length >= 6, null, { timeout: 8000 });
const shot2 = join(here, "dashboard-live.png");
await page.screenshot({ path: shot2, fullPage: true });
const total2 = await page.textContent(".card.total .value");
say(`after 1 more call (no page reload): feed updated live to ${total2} requests.`);

// 6: assertions
const okCount = await page.textContent(".card.ok .value");
const refusedCount = await page.textContent(".card.refused .value");
const errorCount = await page.textContent(".card.error .value");
const status = await page.textContent('[data-testid="status"]');
say(`cards — ok: ${okCount}, refused: ${refusedCount}, errors: ${errorCount}; connection: ${status?.trim()}`);

const pass =
  total1?.trim() === "5" && total2?.trim() === "6" &&
  okCount?.trim() === "4" && refusedCount?.trim() === "1" && errorCount?.trim() === "1" &&
  refusedTag?.trim() === "refused" && status?.trim() === "live";
say(`\nRESULT: ${pass ? "PASS" : "FAIL"} — the monitor tailed the audit log and rendered a live, read-only dashboard.`);
say(`screenshots: ${shot1.replace(here, ".")}, ${shot2.replace(here, ".")}`);

await browser.close();
await client.close();
monitor.kill();
stub.close();
rmSync(auditDir, { recursive: true, force: true });
writeFileSync(join(here, "proof-output.txt"), out.join("\n") + "\n");
await sleep(50);
process.exit(pass ? 0 : 1);
