import {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  type AuthConfig,
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

/** Build the outbound request from config + tool + arguments (pure). Throws on a
 *  missing required argument; callers (execute) surface that as a structured error. */
export function buildRequest(
  config: DrawbridgeConfig,
  tool: GeneratedTool,
  args: Record<string, unknown>,
  env: Env,
): BuiltRequest {
  const platform = config.platforms[tool.platformKey]!;
  const op = tool.operation;

  // Enforce required args (required:true OR in:path) before assembling anything.
  const missing = (op.params ?? [])
    .filter((p) => value(p, args) === undefined && (p.required === true || p.in === "path"))
    .map((p) => p.name);
  if (missing.length) throw new Error(`missing required argument(s): ${missing.join(", ")}`);

  // Path: substitute {name} from in:path params (URL-encoded). Host/template fixed.
  let path = op.path;
  for (const p of param(tool, "path")) {
    path = path.replace(`{${p.name}}`, encodeURIComponent(String(value(p, args))));
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

  // Static config headers (e.g. User-Agent) first; auth/content-type set below win.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(platform.headers ?? {})) headers[k.toLowerCase()] = v;

  // Body: in:body params assembled into a JSON object.
  const bodyParams = param(tool, "body");
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

/** Execute a tool call: build, send, map response/errors, apply the size cap. Never
 *  throws — build/auth/transport failures become a structured ExecResult so the call
 *  is always logged and returned as a tool error (§8e, §12). */
export async function execute(
  config: DrawbridgeConfig,
  tool: GeneratedTool,
  args: Record<string, unknown>,
  env: Env,
  http: HttpClient,
  now: () => number = () => Date.now(),
): Promise<ExecResult> {
  const platform = config.platforms[tool.platformKey]!;
  const secrets = secretValues(platform.auth, env);
  const scrub = (m: string) => redact(m, secrets);
  const meta = { method: tool.operation.method, host: safeHost(platform.base_url), path: tool.operation.path };
  const start = now();

  let built: BuiltRequest;
  try {
    built = buildRequest(config, tool, args, env);
  } catch (e) {
    return { outcome: "error", status: 0, durationMs: now() - start, bytes: 0, truncated: false, data: null, message: scrub((e as Error).message), ...meta };
  }
  meta.host = built.host;
  meta.path = built.path;

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
    return { outcome: "error", status: 0, durationMs, bytes: 0, truncated: false, data: null, message: scrub((e as Error).message), ...meta };
  }

  const durationMs = now() - start;
  const bytes = Buffer.byteLength(bodyText, "utf8");
  let truncated = false;
  if (bytes > built.maxBytes) {
    bodyText = truncateUtf8(bodyText, built.maxBytes);
    truncated = true;
  }

  const outcome = classify(status);
  const data = parseMaybeJson(bodyText);
  const result: ExecResult = { outcome, status, durationMs, bytes, truncated, data, ...meta };
  if (outcome !== "ok") result.message = scrub(typeof data === "string" ? data : JSON.stringify(data)).slice(0, 500);
  return result;
}

function parseMaybeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Truncate to at most maxBytes of UTF-8, trimming any dangling multibyte sequence so
 *  no U+FFFD replacement char is introduced. */
function truncateUtf8(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, "utf8");
  let end = Math.min(maxBytes, buf.length);
  // Back up over UTF-8 continuation bytes (0b10xxxxxx) to a code-point boundary.
  while (end > 0 && (buf[end]! & 0xc0) === 0x80) end--;
  return buf.subarray(0, end).toString("utf8");
}

/** The concrete secret strings for a platform's auth, for scrubbing from messages. */
function secretValues(auth: AuthConfig, env: Env): string[] {
  const out: string[] = [];
  if (auth.type === "bearer" && auth.secret_env) {
    const t = env[auth.secret_env];
    if (t) out.push(`Bearer ${t}`, t);
  } else if (auth.type === "header" && auth.secret_env) {
    const t = env[auth.secret_env];
    if (t) out.push(t);
  } else if (auth.type === "basic") {
    const u = env[auth.username_env!];
    const p = env[auth.password_env!];
    if (u && p) {
      const b = Buffer.from(`${u}:${p}`).toString("base64");
      out.push(`Basic ${b}`, b, `${u}:${p}`, p);
    }
  }
  return out.filter((s) => s.length > 0).sort((a, b) => b.length - a.length);
}

/** Scrub known secret values (and Bearer/Basic patterns) from a message (§8c). */
function redact(msg: string, secrets: string[]): string {
  let out = msg;
  for (const s of secrets) out = out.split(s).join("[redacted]");
  return out.replace(/(Bearer|Basic)\s+\S+/gi, "$1 [redacted]");
}

function safeHost(base: string): string {
  try {
    return new URL(base.replace(/\/$/, "")).host;
  } catch {
    return "";
  }
}
