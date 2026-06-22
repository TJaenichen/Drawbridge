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
});
