import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ExecResult, Outcome } from "../exec/executor.js";

export interface AuditRecord {
  v: 1;
  ts: string;
  platform: string;
  operation: string;
  method: string;
  host: string;
  path: string;
  status: number;
  duration_ms: number;
  outcome: Outcome;
  bytes: number;
  request_id: string;
}

/** A sink receives one finished JSONL line. MUST NOT be stdout (reserved for MCP). */
export type AuditSink = (line: string) => void;

export interface Clock {
  isoNow(): string;
  uuid(): string;
}

const systemClock: Clock = {
  isoNow: () => new Date().toISOString(),
  uuid: () => globalThis.crypto.randomUUID(),
};

/** Build an audit record. No secrets, no request/response bodies (v1). */
export function buildRecord(
  platform: string,
  operation: string,
  result: Pick<ExecResult, "method" | "host" | "path" | "status" | "durationMs" | "outcome" | "bytes">,
  clock: Clock = systemClock,
): AuditRecord {
  return {
    v: 1,
    ts: clock.isoNow(),
    platform,
    operation,
    method: result.method,
    host: result.host,
    path: result.path,
    status: result.status,
    duration_ms: result.durationMs,
    outcome: result.outcome,
    bytes: result.bytes,
    request_id: clock.uuid(),
  };
}

/** The audit file's location, relative to the user's home dir, when no override is set. */
export const DEFAULT_AUDIT_DIR = ".drawbridge";
export const DEFAULT_AUDIT_FILENAME = "audit.jsonl";

/**
 * Resolve the audit file path: `DRAWBRIDGE_AUDIT_FILE` wins; otherwise the default
 * `~/.drawbridge/audit.jsonl` (uniform across OSes — the monitor's zero-config
 * rendezvous file, DESIGN §10/§11). Pure: `home` is injected for tests/parity.
 */
export function resolveAuditFile(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  // An empty/whitespace override (e.g. `DRAWBRIDGE_AUDIT_FILE=$UNSET`) means "use the default".
  const override = env.DRAWBRIDGE_AUDIT_FILE;
  if (override && override.trim() !== "") return override;
  return join(home, DEFAULT_AUDIT_DIR, DEFAULT_AUDIT_FILENAME);
}

/**
 * Default sink: writes every record to stderr, and appends to the audit file
 * (`resolveAuditFile`), announcing the destination on stderr at startup. The parent
 * dir is created if missing (dir `0700` / file `0600`, owner-only — ignored on
 * Windows). A file that can't be created or written degrades to **stderr-only** with a
 * one-time warning — a broken audit file must never take down the MCP server (§10).
 */
export function defaultSink(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): AuditSink {
  const file = resolveAuditFile(env, home);
  let fileOk = true;
  const disable = (why: string, e: unknown) => {
    fileOk = false;
    process.stderr.write(`drawbridge: audit file disabled (${why}: ${file}): ${(e as Error).message}\n`);
  };
  try {
    const dir = dirname(file);
    if (dir) mkdirSync(dir, { recursive: true, mode: 0o700 });
    process.stderr.write(`drawbridge: audit -> ${file}\n`);
  } catch (e) {
    disable("cannot create directory", e);
  }
  return (line: string) => {
    process.stderr.write(line + "\n");
    if (!fileOk) return;
    try {
      appendFileSync(file, line + "\n", { mode: 0o600 });
    } catch (e) {
      disable("write failed", e);
    }
  };
}

export function writeAudit(sink: AuditSink, record: AuditRecord): void {
  sink(JSON.stringify(record));
}
