import { describe, expect, it, vi } from "vitest";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.js";
import { generateTools } from "../src/tools/generator.js";
import { execute } from "../src/exec/executor.js";
import { type Clock, buildRecord, defaultSink, writeAudit } from "../src/audit/logger.js";

const fixedClock: Clock = { isoNow: () => "2026-01-01T00:00:00.000Z", uuid: () => "fixed-id" };

const raw = {
  version: 1,
  platforms: {
    tracker: {
      base_url: "http://localhost:4010",
      auth: { type: "bearer", secret_env: "TOK" },
      operations: [{ name: "create", description: "c", method: "POST", path: "/work-items", params: [{ name: "title", in: "body", type: "string", required: true }] }],
    },
  },
};
const env = { TOK: "super-secret-value" };

describe("audit logging", () => {
  it("emits a structured record with no secrets or bodies", async () => {
    const config = loadConfig(raw, env);
    const tool = generateTools(config).find((t) => t.name === "tracker_create")!;
    const result = await execute(config, tool, { title: "x" }, env, async () => ({ status: 201, body: '{"id":1}' }));

    const lines: string[] = [];
    const record = buildRecord(tool.platformKey, tool.operation.name, result, fixedClock);
    writeAudit((l) => lines.push(l), record);

    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toEqual({
      v: 1,
      ts: "2026-01-01T00:00:00.000Z",
      platform: "tracker",
      operation: "create",
      method: "POST",
      host: "localhost:4010",
      path: "/work-items",
      status: 201,
      duration_ms: parsed.duration_ms,
      outcome: "ok",
      bytes: 8,
      request_id: "fixed-id",
    });
    // Secret confinement: the record must never carry the credential or a body.
    expect(lines[0]).not.toContain("super-secret-value");
    expect(lines[0]).not.toContain("Bearer");
  });
});

describe("defaultSink", () => {
  it("writes to stderr (never stdout) and appends to the audit file", () => {
    const file = join(tmpdir(), `drawbridge-audit-${process.pid}.jsonl`);
    rmSync(file, { force: true });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const sink = defaultSink({ DRAWBRIDGE_AUDIT_FILE: file });
    sink('{"a":1}');
    sink('{"a":2}');
    const errCalls = errSpy.mock.calls.length;
    const outCalls = outSpy.mock.calls.length;
    errSpy.mockRestore();
    outSpy.mockRestore();
    expect(errCalls).toBe(2);
    expect(outCalls).toBe(0);
    expect(readFileSync(file, "utf8")).toBe('{"a":1}\n{"a":2}\n');
    rmSync(file, { force: true });
  });
});
