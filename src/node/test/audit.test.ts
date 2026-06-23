import { describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config/loader.js";
import { generateTools } from "../src/tools/generator.js";
import { execute } from "../src/exec/executor.js";
import { type Clock, buildRecord, defaultSink, resolveAuditFile, writeAudit } from "../src/audit/logger.js";

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
    // construction announces "audit -> <file>"; each record is exactly one stderr write.
    const recordWrites = errSpy.mock.calls.filter((c) => String(c[0]).startsWith("{")).length;
    const outCalls = outSpy.mock.calls.length;
    errSpy.mockRestore();
    outSpy.mockRestore();
    expect(recordWrites).toBe(2);
    expect(outCalls).toBe(0);
    expect(readFileSync(file, "utf8")).toBe('{"a":1}\n{"a":2}\n');
    rmSync(file, { force: true });
  });
});

describe("resolveAuditFile (default path)", () => {
  it("prefers DRAWBRIDGE_AUDIT_FILE when set", () => {
    expect(resolveAuditFile({ DRAWBRIDGE_AUDIT_FILE: "/tmp/x.jsonl" }, "/home/u")).toBe("/tmp/x.jsonl");
  });

  it("falls back to ~/.drawbridge/audit.jsonl under home", () => {
    expect(resolveAuditFile({}, "/home/u")).toBe(join("/home/u", ".drawbridge", "audit.jsonl"));
  });
});

describe("defaultSink default path + degradation", () => {
  it("creates ~/.drawbridge/ under home and appends there with no env var (never stdout)", () => {
    const home = mkdtempSync(join(tmpdir(), "drawbridge-home-"));
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const sink = defaultSink({}, home);
      sink('{"a":1}');
      const outCalls = outSpy.mock.calls.length;
      const expected = join(home, ".drawbridge", "audit.jsonl");
      expect(outCalls).toBe(0);
      expect(readFileSync(expected, "utf8")).toBe('{"a":1}\n');
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("degrades to stderr-only (no throw, no stdout) when the audit dir can't be created", () => {
    // home is a regular FILE, so mkdir of <file>/.drawbridge must fail.
    const homeFile = join(tmpdir(), `drawbridge-not-a-dir-${process.pid}`);
    writeFileSync(homeFile, "x");
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const sink = defaultSink({}, homeFile);
      expect(() => sink('{"a":1}')).not.toThrow();
      expect(outSpy.mock.calls.length).toBe(0);
      // a warning + the record both went to stderr; the file was never created
      expect(errSpy.mock.calls.some((c) => String(c[0]).includes("audit file disabled"))).toBe(true);
      expect(existsSync(join(homeFile, ".drawbridge", "audit.jsonl"))).toBe(false);
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
      rmSync(homeFile, { force: true });
    }
  });

  it("degrades with a one-time warning when the dir is created but appends fail", () => {
    // The parent dir is fine, but the audit FILE path is itself a directory, so every
    // append throws — exercising the post-start "write failed" branch + the one-time latch.
    const home = mkdtempSync(join(tmpdir(), "drawbridge-home-"));
    mkdirSync(join(home, ".drawbridge", "audit.jsonl"), { recursive: true });
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const outSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const sink = defaultSink({}, home); // mkdir(parent) succeeds, announces destination
      expect(() => sink('{"a":1}')).not.toThrow();
      expect(() => sink('{"a":2}')).not.toThrow();
      expect(outSpy.mock.calls.length).toBe(0);
      const warnings = errSpy.mock.calls.filter((c) => String(c[0]).includes("write failed")).length;
      expect(warnings).toBe(1); // one warning despite two failing appends
    } finally {
      errSpy.mockRestore();
      outSpy.mockRestore();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
