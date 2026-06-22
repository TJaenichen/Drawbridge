import { readdirSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const here = dirname(fileURLToPath(import.meta.url));
export const SPECS_DIR = resolve(here, "../../../specs");
export const FIXTURES_DIR = resolve(SPECS_DIR, "fixtures");

export interface Fixture {
  $kind: "tools" | "request" | "config_valid" | "config_invalid";
  description: string;
  env?: Record<string, string>;
  config?: unknown;
  config_ref?: string;
  expected_tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  expected?: { pointer?: string; message_contains?: string };
  tool_call?: { name: string; arguments: Record<string, unknown> };
  stub_response?: { status: number; body: string };
  expected_request?: {
    method: string;
    path: string;
    query?: Record<string, unknown>;
    headers?: Record<string, string>;
    auth_header?: string;
    body?: unknown;
  };
  expected_result?: unknown;
  expected_error?: { status: number; outcome: string; message_contains?: string };
  __file: string;
}

const parse = (p: string): unknown =>
  extname(p) === ".json" ? JSON.parse(readFileSync(p, "utf8")) : yaml.load(readFileSync(p, "utf8"));

export function loadFixtures(kind: Fixture["$kind"]): Fixture[] {
  return readdirSync(FIXTURES_DIR, { recursive: true })
    .map((f) => resolve(FIXTURES_DIR, f.toString()))
    .filter((f) => extname(f) === ".json" && !f.endsWith("fixture.schema.json"))
    .map((f) => ({ ...(parse(f) as Fixture), __file: f }))
    .filter((fx) => fx.$kind === kind);
}

/** Resolve a fixture's config (inline or config_ref). */
export function fixtureConfig(fx: Fixture): unknown {
  if (fx.config !== undefined) return fx.config;
  if (fx.config_ref) return parse(resolve(dirname(fx.__file), fx.config_ref));
  throw new Error(`fixture ${fx.__file} has neither config nor config_ref`);
}
