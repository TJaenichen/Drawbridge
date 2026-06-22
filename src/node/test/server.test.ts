import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadConfig } from "../src/config/loader.js";
import { createServer, type ServerDeps } from "../src/mcp/server.js";
import type { HttpClient, HttpResponse } from "../src/exec/http.js";
import type { Clock } from "../src/audit/logger.js";

const clock: Clock = { isoNow: () => "2026-01-01T00:00:00.000Z", uuid: () => "id" };

const raw = {
  version: 1,
  platforms: {
    t: {
      base_url: "http://svc.internal",
      auth: { type: "bearer", secret_env: "TOK" },
      operations: [
        { name: "get", description: "Get a thing.", method: "GET", path: "/things/{id}", params: [{ name: "id", in: "path", type: "integer", required: true }] },
        { name: "create", description: "Create a thing.", method: "POST", path: "/things", params: [{ name: "title", in: "body", type: "string", required: true }] },
        { name: "big", description: "Big response.", method: "GET", path: "/big", max_response_bytes: 10 },
      ],
    },
  },
};
const env = { TOK: "secret" };

async function connect(http: HttpClient, sink: string[]) {
  const config = loadConfig(raw, env);
  const deps: ServerDeps = { env, http, sink: (l) => sink.push(l), clock, now: () => 0 };
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const server = createServer(config, deps);
  await server.connect(serverT);
  const client = new Client({ name: "t", version: "0" });
  await client.connect(clientT);
  return { client, server };
}

const respond = (status: number, body: string): HttpClient => async () => ({ status, body } as HttpResponse);

describe("MCP server handlers", () => {
  it("ListTools returns the generated tools", async () => {
    const { client } = await connect(respond(200, "{}"), []);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["t_big", "t_create", "t_get"]);
    expect(tools.find((t) => t.name === "t_get")!.description).toBe("Get a thing.");
  });

  it("CallTool ok returns the body text and audits outcome ok", async () => {
    const sink: string[] = [];
    const { client } = await connect(respond(200, '{"id":5}'), sink);
    const r = await client.callTool({ name: "t_get", arguments: { id: 5 } });
    expect(r.isError).toBeFalsy();
    expect((r.content as any)[0].text).toContain('"id": 5');
    expect(JSON.parse(sink[0]!).outcome).toBe("ok");
  });

  it("CallTool maps an upstream 500 to a structured error", async () => {
    const { client } = await connect(respond(500, "boom"), []);
    const r = await client.callTool({ name: "t_get", arguments: { id: 5 } });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toContain("Upstream 500 (server_error)");
  });

  it("a missing required arg becomes a structured error, still audited", async () => {
    const sink: string[] = [];
    const { client } = await connect(respond(200, "{}"), sink);
    const r = await client.callTool({ name: "t_get", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toMatch(/missing required argument/);
    expect(JSON.parse(sink[0]!).outcome).toBe("error");
  });

  it("appends a truncation note when the body exceeds the cap", async () => {
    const { client } = await connect(respond(200, "x".repeat(50)), []);
    const r = await client.callTool({ name: "t_big", arguments: {} });
    expect((r.content as any)[0].text).toContain("[response truncated]");
  });

  it("refuses an undeclared tool and audits outcome refused", async () => {
    const sink: string[] = [];
    const { client } = await connect(respond(200, "{}"), sink);
    const r = await client.callTool({ name: "t_nope", arguments: {} });
    expect(r.isError).toBe(true);
    expect((r.content as any)[0].text).toBe("Unknown tool: t_nope");
    expect(JSON.parse(sink[0]!).outcome).toBe("refused");
  });
});
