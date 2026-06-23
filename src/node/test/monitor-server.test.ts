import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { appendFileSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMonitor, type MonitorServer } from "../src/monitor/server.js";

function tmpDir(): string {
  return mkdtempSync(join(tmpdir(), "drawbridge-monitor-"));
}

// Minimal HTTP GET helper. `headers` lets a test forge the Host header.
function get(
  host: string,
  port: number,
  path: string,
  method = "GET",
  headers: Record<string, string> = {},
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path, method, headers }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Open an SSE connection and accumulate the parsed `data:` payloads into `frames`.
function openSse(host: string, port: number): Promise<{ req: http.ClientRequest; frames: string[] }> {
  const frames: string[] = [];
  return new Promise((resolve, reject) => {
    const req = http.request({ host, port, path: "/events" }, (res) => {
      let buf = "";
      res.on("data", (c) => {
        buf += c.toString();
        let i: number;
        while ((i = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = frame.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
          if (data) frames.push(data);
        }
      });
      resolve({ req, frames });
    });
    req.on("error", reject);
    req.end();
  });
}

async function waitFor(frames: string[], n: number, ms = 2000): Promise<void> {
  const start = Date.now();
  while (frames.length < n) {
    if (Date.now() - start > ms) throw new Error(`SSE timeout: have ${frames.length}/${n}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

let monitor: MonitorServer | undefined;
afterEach(async () => {
  await monitor?.close();
  monitor = undefined;
});

describe("monitor server", () => {
  it("binds to loopback (127.0.0.1) only", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000 });
    expect(monitor.address().host).toBe("127.0.0.1");
  });

  it("streams the backlog on connect, then live records as they are appended", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, '{"operation":"a","outcome":"ok"}\n'); // pre-existing → backlog
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000 });
    const { host, port } = monitor.address();

    const sse = await openSse(host, port);
    await waitFor(sse.frames, 1);
    expect(JSON.parse(sse.frames[0]!).operation).toBe("a");

    appendFileSync(file, '{"operation":"b","outcome":"refused"}\n');
    monitor.poll(); // deterministic tail tick
    await waitFor(sse.frames, 2);
    expect(JSON.parse(sse.frames[1]!).outcome).toBe("refused");
    sse.req.destroy();
  });

  it("is read-only: non-GET methods are rejected and never touch the audit file", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, '{"operation":"a"}\n');
    const sizeBefore = statSync(file).size;
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000 });
    const { host, port } = monitor.address();

    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await get(host, port, "/events", method);
      expect(res.status).toBe(405);
    }
    expect(statSync(file).size).toBe(sizeBefore);
  });

  it("serves static assets from the UI dir and never escapes it via traversal", async () => {
    const ui = tmpDir();
    writeFileSync(join(ui, "index.html"), "<h1>dashboard</h1>");
    const secret = join(ui, "..", "secret.txt"); // sibling of the asset root
    writeFileSync(secret, "TOP-SECRET");
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000, uiDir: ui });
    const { host, port } = monitor.address();

    const index = await get(host, port, "/");
    expect(index.status).toBe(200);
    expect(index.body).toContain("dashboard");

    const traverse = await get(host, port, "/../secret.txt");
    expect([403, 404]).toContain(traverse.status);
    expect(traverse.body).not.toContain("TOP-SECRET"); // the sibling secret is never served
    rmSync(secret, { force: true });
  });

  it("rejects a symlink in the asset dir that points outside the root (realpath confinement)", async () => {
    const ui = tmpDir();
    writeFileSync(join(ui, "index.html"), "<h1>ok</h1>");
    const secret = join(tmpDir(), "secret.txt");
    writeFileSync(secret, "TOP-SECRET");
    let linked = false;
    try {
      symlinkSync(secret, join(ui, "leak"));
      linked = true;
    } catch {
      /* symlinks may require privilege on Windows — fall back to the absent-file assertion */
    }
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000, uiDir: ui });
    const { host, port } = monitor.address();

    const res = await get(host, port, "/leak");
    expect(res.body).not.toContain("TOP-SECRET"); // never leaks, regardless of platform
    expect(res.status).toBe(linked ? 403 : 404);
  });

  it("serves the built-in fallback page when no UI is bundled", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000, uiDir: "" });
    const { host, port } = monitor.address();
    const res = await get(host, port, "/");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Drawbridge monitor");
    expect(res.body).toContain("EventSource('/events')");
  });

  it("replays only the most recent `backlog` records to a new client", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, '{"request_id":"1"}\n{"request_id":"2"}\n{"request_id":"3"}\n');
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000, backlog: 2 });
    const { host, port } = monitor.address();
    const sse = await openSse(host, port);
    await waitFor(sse.frames, 2);
    await new Promise((r) => setTimeout(r, 50)); // allow any (incorrect) extra frame to arrive
    expect(sse.frames.map((f) => JSON.parse(f).request_id)).toEqual(["2", "3"]); // oldest dropped
    sse.req.destroy();
  });

  it("broadcasts a live record to every connected client", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000 });
    const { host, port } = monitor.address();
    const a = await openSse(host, port);
    const b = await openSse(host, port);
    appendFileSync(file, '{"request_id":"x","outcome":"ok"}\n');
    monitor.poll();
    await waitFor(a.frames, 1);
    await waitFor(b.frames, 1);
    expect(JSON.parse(a.frames[0]!).request_id).toBe("x");
    expect(JSON.parse(b.frames[0]!).request_id).toBe("x");
    a.req.destroy();
    b.req.destroy();
  });

  it("rejects a non-loopback Host header (anti DNS-rebinding)", async () => {
    const file = join(tmpDir(), "audit.jsonl");
    writeFileSync(file, "");
    monitor = await startMonitor({ auditFile: file, port: 0, pollMs: 100000, uiDir: "" });
    const { host, port } = monitor.address();
    const evil = await get(host, port, "/", "GET", { host: "attacker.example" });
    expect(evil.status).toBe(403);
    const ok = await get(host, port, "/", "GET", { host: `127.0.0.1:${port}` });
    expect(ok.status).toBe(200);
  });
});
