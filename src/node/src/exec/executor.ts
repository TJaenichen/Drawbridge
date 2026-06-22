import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  type DrawbridgeConfig,
  type GeneratedTool,
  type ParamConfig,
} from "../model.js";
import type { Env } from "../config/loader.js";
import { buildAuthHeader } from "./auth.js";
import { type HttpClient, type HttpRequest, TimeoutError } from "./http.js";

export type Outcome = "ok" | "client_error" | "server_error" | "timeout" | "refused" | "error";

export interface ExecResult {
  outcome: Outcome;
  status: number;
  durationMs: number;
  bytes: number;
  truncated: boolean;
  data: unknown;
  message?: string;
  /** Audit/proof metadata — never includes the auth header value. */
  host: string;
  path: string;
  method: string;
}

export interface BuiltRequest {
  request: HttpRequest;
  authHeaderName: string;
  timeoutMs: number;
  maxBytes: number;
  host: string;
  path: string;
}

const param = (tool: GeneratedTool, where: ParamConfig["in"]) =>
  (tool.operation.params ?? []).filter((p) => p.in === where);

const value = (p: ParamConfig, args: Record<string, unknown>): unknown =>
  args[p.name] !== undefined ? args[p.name] : p.default;

/** Build the outbound request from config + tool + arguments (pure). */
export function buildRequest(
  config: DrawbridgeConfig,
  tool: GeneratedTool,
  args: Record<string, unknown>,
  env: Env,
): BuiltRequest {
  const platform = config.platforms[tool.platformKey]!;
  const op = tool.operation;

  // Path: substitute {name} from in:path params (URL-encoded). Host/template fixed.
  let path = op.path;
  for (const p of param(tool, "path")) {
    const v = value(p, args);
    if (v === undefined) throw new Error(`missing required path argument "${p.name}"`);
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(v)));
  }

  // Query: in:query params; arrays as repeated keys; omit when absent and no default.
  const pairs: string[] = [];
  for (const p of param(tool, "query")) {
    const v = value(p, args);
    if (v === undefined) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      pairs.push(`${encodeURIComponent(p.name)}=${encodeURIComponent(String(item))}`);
    }
  }
  const query = pairs.length ? `?${pairs.join("&")}` : "";

  // Body: in:body params assembled into a JSON object.
  const bodyParams = param(tool, "body");
  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (bodyParams.length) {
    const obj: Record<string, unknown> = {};
    for (const p of bodyParams) {
      const v = value(p, args);
      if (v !== undefined) obj[p.name] = v;
    }
    body = JSON.stringify(obj);
    headers["content-type"] = "application/json";
  }

  const auth = buildAuthHeader(platform.auth, env);
  headers[auth.name.toLowerCase()] = auth.value;

  const base = platform.base_url.replace(/\/$/, "");
  const request: HttpRequest = { method: op.method, url: `${base}${path}${query}`, headers };
  if (body !== undefined) request.body = body;

  const timeoutMs = op.timeout_ms ?? platform.timeout_ms ?? config.defaults?.timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = op.max_response_bytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  return { request, authHeaderName: auth.name.toLowerCase(), timeoutMs, maxBytes, host: new URL(base).host, path };
}

const classify = (status: number): Outcome =>
  status >= 200 && status < 300 ? "ok" : status >= 400 && status < 500 ? "client_error" : status >= 500 ? "server_error" : "error";

/** Execute a tool call: build, send, map response/errors, apply the size cap. */
export async function execute(
  config: DrawbridgeConfig,
  tool: GeneratedTool,
  args: Record<string, unknown>,
  env: Env,
  http: HttpClient,
  now: () => number = () => Date.now(),
): Promise<ExecResult> {
  const built = buildRequest(config, tool, args, env);
  const meta = { host: built.host, path: built.path, method: built.request.method };
  const start = now();

  let status = 0;
  let bodyText = "";
  try {
    const res = await http(built.request, built.timeoutMs);
    status = res.status;
    bodyText = res.body;
  } catch (e) {
    const durationMs = now() - start;
    if (e instanceof TimeoutError) {
      return { outcome: "timeout", status: 0, durationMs, bytes: 0, truncated: false, data: null, message: "request timed out", ...meta };
    }
    return { outcome: "error", status: 0, durationMs, bytes: 0, truncated: false, data: null, message: redact((e as Error).message), ...meta };
  }

  const durationMs = now() - start;
  const bytes = Buffer.byteLength(bodyText, "utf8");
  let truncated = false;
  if (bytes > built.maxBytes) {
    bodyText = Buffer.from(bodyText, "utf8").subarray(0, built.maxBytes).toString("utf8");
    truncated = true;
  }

  const outcome = classify(status);
  const data = parseMaybeJson(bodyText);
  const result: ExecResult = { outcome, status, durationMs, bytes, truncated, data, ...meta };
  if (outcome !== "ok") result.message = redact(typeof data === "string" ? data : JSON.stringify(data)).slice(0, 500);
  return result;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Defensive redaction of obvious secret-bearing tokens from a message. */
function redact(msg: string): string {
  return msg.replace(/(Bearer|Basic)\s+\S+/gi, "$1 [redacted]");
}
