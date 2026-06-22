#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { extname } from "node:path";
import yaml from "js-yaml";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFile } from "./config/loader.js";
import { createServer } from "./mcp/server.js";
import { generateConfig } from "./generate/openapi.js";
import { ConfigError } from "./model.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runGenerate(): void {
  const from = arg("--from");
  if (!from) {
    process.stderr.write("usage: drawbridge-mcp generate --from <openapi> [--platform <key>] [--out <config>]\n");
    process.exit(2);
  }
  const text = readFileSync(from, "utf8");
  const doc = (extname(from) === ".json" ? JSON.parse(text) : yaml.load(text)) as Record<string, unknown>;
  const config = generateConfig(doc, arg("--platform") ?? "api");
  const json = JSON.stringify(config, null, 2);
  const out = arg("--out");
  if (out) writeFileSync(out, json + "\n");
  else process.stdout.write(json + "\n");
  process.stderr.write("drawbridge: draft config generated — review and prune before exposing.\n");
}

async function main(): Promise<void> {
  if (process.argv.includes("generate")) {
    runGenerate();
    return;
  }
  const configPath = arg("--config");
  if (!configPath) {
    process.stderr.write("usage: drawbridge-mcp --config <path>\n");
    process.exit(2);
  }

  let config;
  try {
    config = loadConfigFile(configPath, process.env);
  } catch (e) {
    if (e instanceof ConfigError) {
      process.stderr.write(`drawbridge: ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }

  const server = createServer(config, { env: process.env });
  await server.connect(new StdioServerTransport());
  process.stderr.write("drawbridge: ready (stdio)\n");
}

main().catch((e) => {
  process.stderr.write(`drawbridge: fatal: ${(e as Error).message}\n`);
  process.exit(1);
});
