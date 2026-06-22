import { beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/loader.js";
import { generateTools } from "../src/tools/generator.js";
import { buildRequest, execute } from "../src/exec/executor.js";
import { type HttpClient, type HttpRequest, TimeoutError } from "../src/exec/http.js";
import type { GeneratedTool } from "../src/model.js";

const raw = {
  version: 1,
  platforms: {
    tracker: {
      base_url: "http://localhost:4010",
      auth: { type: "bearer", secret_env: "TOK" },
      operations: [
        { name: "list", description: "l", method: "GET", path: "/work-items", params: [{ name: "state", in: "query", type: "enum", enum: ["open", "closed"], default: "open" }] },
        { name: "get", description: "g", method: "GET", path: "/work-items/{id}", params: [{ name: "id", in: "path", type: "integer", required: true }] },
        { name: "create", description: "c", method: "POST", path: "/work-items", params: [{ name: "title", in: "body", type: "string", required: true }, { name: "type", in: "body", type: "enum", enum: ["task", "bug"], default: "task" }] },
        { name: "search", description: "s", method: "GET", path: "/search", params: [{ name: "labels", in: "query", type: "array", items: { type: "string" } }] },
      ],
    },
  },
};
const env = { TOK: "sekret-token" };
const config = loadConfig(raw, env);
let byName: Record<string, GeneratedTool>;
beforeAll(() => {
  byName = Object.fromEntries(generateTools(config).map((t) => [t.name, t]));
});

const stub = (status: number, body: string, sink?: HttpRequest[]): HttpClient => async (req) => {
  sink?.push(req);
  return { status, body };
};

describe("buildRequest", () => {
  it("assembles a POST body and applies a default", () => {
    const b = buildRequest(config, byName.tracker_create!, { title: "Investigate" }, env);
    expect(b.request.method).toBe("POST");
    expect(b.request.url).toBe("http://localhost:4010/work-items");
    expect(JSON.parse(b.request.body!)).toEqual({ title: "Investigate", type: "task" });
    expect(b.request.headers["content-type"]).toBe("application/json");
  });

  it("URL-encodes path params", () => {
    const b = buildRequest(config, byName.tracker_get!, { id: 42 }, env);
    expect(b.request.url).toBe("http://localhost:4010/work-items/42");
  });

  it("applies a query default and omits absent params", () => {
    const b = buildRequest(config, byName.tracker_list!, {}, env);
    expect(b.request.url).toBe("http://localhost:4010/work-items?state=open");
  });

  it("serializes array query params as repeated keys", () => {
    const b = buildRequest(config, byName.tracker_search!, { labels: ["a", "b"] }, env);
    expect(b.request.url).toBe("http://localhost:4010/search?labels=a&labels=b");
  });

  it("injects the auth header but keeps host/path metadata secret-free", () => {
    const b = buildRequest(config, byName.tracker_list!, {}, env);
    expect(b.request.headers["authorization"]).toBe("Bearer sekret-token");
    expect(b.authHeaderName).toBe("authorization");
    expect(b.host).toBe("localhost:4010");
  });
});

describe("execute — response/error mapping", () => {
  it("maps 2xx to ok and parses JSON", async () => {
    const r = await execute(config, byName.tracker_create!, { title: "x" }, env, stub(201, '{"id":7,"state":"open"}'));
    expect(r.outcome).toBe("ok");
    expect(r.data).toEqual({ id: 7, state: "open" });
  });

  it("maps 404 to client_error and 500 to server_error", async () => {
    expect((await execute(config, byName.tracker_get!, { id: 9 }, env, stub(404, "nope"))).outcome).toBe("client_error");
    expect((await execute(config, byName.tracker_get!, { id: 9 }, env, stub(500, "boom"))).outcome).toBe("server_error");
  });

  it("maps a timeout", async () => {
    const t: HttpClient = async () => {
      throw new TimeoutError();
    };
    expect((await execute(config, byName.tracker_list!, {}, env, t)).outcome).toBe("timeout");
  });

  it("truncates bodies over max_response_bytes", async () => {
    const big = "x".repeat(2000);
    const cfg = loadConfig({ ...raw, platforms: { tracker: { ...raw.platforms.tracker, operations: [{ ...raw.platforms.tracker.operations[2], max_response_bytes: 100 }] } } } as any, env);
    const tool = generateTools(cfg).find((t) => t.name === "tracker_create")!;
    const r = await execute(cfg, tool, { title: "x" }, env, stub(200, big));
    expect(r.truncated).toBe(true);
    expect((r.data as string).length).toBe(100);
  });

  it("maps a 302 (not auto-handled) to outcome error", async () => {
    expect((await execute(config, byName.tracker_list!, {}, env, stub(302, ""))).outcome).toBe("error");
  });

  it("returns a structured error (not a throw) for a missing required path arg", async () => {
    const r = await execute(config, byName.tracker_get!, {}, env, stub(200, "{}"));
    expect(r.outcome).toBe("error");
    expect(r.message).toMatch(/missing required argument/);
  });
});

const single = (extra: Record<string, unknown>, opExtra: Record<string, unknown> = {}, secret = "t") =>
  loadConfig(
    { version: 1, ...extra, platforms: { p: { base_url: "http://x.internal", auth: { type: "bearer", secret_env: "T" }, operations: [{ name: "op", description: "d", method: "GET", path: "/p", ...opExtra }], ...((extra as any).platformExtra ?? {}) } } } as any,
    { T: secret },
  );

describe("timeout precedence (op -> platform -> defaults -> 30000)", () => {
  const tmo = (cfg: any) => buildRequest(cfg, generateTools(cfg)[0]!, {}, { T: "t" }).timeoutMs;
  const build = (d?: number, p?: number, o?: number) => {
    const op: any = { name: "op", description: "d", method: "GET", path: "/p" };
    if (o !== undefined) op.timeout_ms = o;
    const plat: any = { base_url: "http://x.internal", auth: { type: "bearer", secret_env: "T" }, operations: [op] };
    if (p !== undefined) plat.timeout_ms = p;
    const cfg: any = { version: 1, platforms: { p: plat } };
    if (d !== undefined) cfg.defaults = { timeout_ms: d };
    return loadConfig(cfg, { T: "t" });
  };
  it("operation wins", () => expect(tmo(build(1000, 2000, 3000))).toBe(3000));
  it("platform when no operation override", () => expect(tmo(build(1000, 2000))).toBe(2000));
  it("defaults when no op/platform", () => expect(tmo(build(1000))).toBe(1000));
  it("30000 when nothing set", () => expect(tmo(build())).toBe(30000));
});

describe("safety details", () => {
  it("truncates on a UTF-8 boundary — no U+FFFD replacement char", async () => {
    const cfg = single({}, { max_response_bytes: 10 });
    const tool = generateTools(cfg)[0]!;
    const r = await execute(cfg, tool, {}, { T: "t" }, async () => ({ status: 200, body: "€".repeat(20) }));
    expect(r.truncated).toBe(true);
    expect(r.data).not.toContain("�");
    expect(r.data).toBe("€€€"); // 10 bytes / 3 bytes-per-€ = 3 whole chars
  });

  it("redacts the configured secret from an upstream error message", async () => {
    const cfg = single({}, {}, "supersecret");
    const tool = generateTools(cfg)[0]!;
    const r = await execute(cfg, tool, {}, { T: "supersecret" }, async () => ({ status: 401, body: '{"error":"invalid token supersecret"}' }));
    expect(r.message).not.toContain("supersecret");
    expect(r.message).toContain("[redacted]");
  });
});
