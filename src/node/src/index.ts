#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfigFile } from "./config/loader.js";
import { createServer } from "./mcp/server.js";
import { ConfigError } from "./model.js";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
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
