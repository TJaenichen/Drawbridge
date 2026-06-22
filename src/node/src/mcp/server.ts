import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { DrawbridgeConfig, GeneratedTool } from "../model.js";
import type { Env } from "../config/loader.js";
import { generateTools } from "../tools/generator.js";
import { execute } from "../exec/executor.js";
import { type HttpClient, fetchClient } from "../exec/http.js";
import { type AuditSink, type Clock, buildRecord, defaultSink, writeAudit } from "../audit/logger.js";

export interface ServerDeps {
  env?: Env;
  http?: HttpClient;
  sink?: AuditSink;
  clock?: Clock;
  /** Monotonic clock for duration measurement; injectable for deterministic tests. */
  now?: () => number;
}

const VERSION = "0.1.0";

/** Build a configured MCP server (stdio is connected separately, in index.ts). */
export function createServer(config: DrawbridgeConfig, deps: ServerDeps = {}): Server {
  const env = deps.env ?? process.env;
  const http = deps.http ?? fetchClient;
  const sink = deps.sink ?? defaultSink(env);

  const tools = generateTools(config);
  const byName = new Map<string, GeneratedTool>(tools.map((t) => [t.name, t]));

  const server = new Server(
    { name: "drawbridge", version: VERSION },
    { capabilities: { tools: {} }, instructions: `Drawbridge proxy (config version ${config.version}). Tools are typed, allowlisted proxies to internal APIs; credentials stay server-side.` },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = byName.get(name);

    if (!tool) {
      // Closed world (§8b): an undeclared tool is impossible to route.
      writeAudit(
        sink,
        buildRecord("", name, { method: "", host: "", path: "", status: 0, durationMs: 0, outcome: "refused", bytes: 0 }, deps.clock),
      );
      return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }

    const result = await execute(config, tool, args, env, http, deps.now);
    writeAudit(sink, buildRecord(tool.platformKey, tool.operation.name, result, deps.clock));

    if (result.outcome === "ok") {
      const text = typeof result.data === "string" ? result.data : JSON.stringify(result.data, null, 2);
      const note = result.truncated ? "\n\n[response truncated]" : "";
      return { content: [{ type: "text", text: text + note }] };
    }
    return {
      isError: true,
      content: [{ type: "text", text: `Upstream ${result.status} (${result.outcome})${result.message ? ": " + result.message : ""}` }],
    };
  });

  return server;
}
