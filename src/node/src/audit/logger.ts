import { appendFileSync } from "node:fs";
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

/** Default sink: stderr, plus an append-only file when DRAWBRIDGE_AUDIT_FILE is set. */
export function defaultSink(env: Record<string, string | undefined> = process.env): AuditSink {
  const file = env.DRAWBRIDGE_AUDIT_FILE;
  return (line: string) => {
    process.stderr.write(line + "\n");
    if (file) appendFileSync(file, line + "\n");
  };
}

export function writeAudit(sink: AuditSink, record: AuditRecord): void {
  sink(JSON.stringify(record));
}
