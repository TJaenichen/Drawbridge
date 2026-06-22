// Proof tool for M0. Verifies:
//   1. the config schema and fixture schema are valid 2020-12 documents (compile);
//   2. the example config validates;
//   3. every fixture validates against fixture.schema.json;
//   4. every tools/request/config_valid fixture's config validates against the config schema;
//   5. every config_invalid fixture is REJECTED at its expected pointer;
//   6. a set of inline bad configs are each rejected.
import Ajv2020 from "ajv/dist/2020.js";
import yaml from "js-yaml";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const specs = resolve(here, "../../specs");
const load = (p) => (extname(p) === ".json" ? JSON.parse(readFileSync(p, "utf8")) : yaml.load(readFileSync(p, "utf8")));

const configSchema = load(resolve(specs, "drawbridge.config.schema.json"));
const fixtureSchema = load(resolve(specs, "fixtures/fixture.schema.json"));

// strictRequired off: if/then conditionals put `required` in subschemas without re-declaring properties.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });

const results = { steps: [], failures: 0 };
const ok = (label, pass, detail = "") => {
  results.steps.push({ label, pass, detail });
  if (!pass) results.failures++;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${detail ? "  -> " + detail : ""}`);
};

let validateConfig, validateFixture;
try { validateConfig = ajv.compile(configSchema); ok("config schema compiles (valid 2020-12)", true); }
catch (e) { ok("config schema compiles", false, e.message); dump(); process.exit(1); }
try { validateFixture = ajv.compile(fixtureSchema); ok("fixture schema compiles (valid 2020-12)", true); }
catch (e) { ok("fixture schema compiles", false, e.message); dump(); process.exit(1); }

// 2. example config
const example = load(resolve(specs, "drawbridge.config.example.yaml"));
ok("example config validates", validateConfig(example), validateConfig.errors ? firstErr(validateConfig) : "");

// 3-5. walk fixtures
const fixturesDir = resolve(specs, "fixtures");
const fixtureFiles = readdirSync(fixturesDir, { recursive: true })
  .map((f) => resolve(fixturesDir, f))
  .filter((f) => extname(f) === ".json" && f !== resolve(fixturesDir, "fixture.schema.json"));

console.log(`\n-- ${fixtureFiles.length} fixtures --`);
for (const file of fixtureFiles) {
  const rel = relative(specs, file).replace(/\\/g, "/");
  const fx = load(file);
  ok(`fixture shape: ${rel}`, validateFixture(fx), validateFixture.errors ? firstErr(validateFixture) : "");

  const cfg = fx.config ?? (fx.config_ref ? load(resolve(dirname(file), fx.config_ref)) : null);
  if (fx.$kind === "tools" || fx.$kind === "request" || fx.$kind === "config_valid") {
    ok(`  config valid: ${rel}`, validateConfig(cfg), validateConfig.errors ? firstErr(validateConfig) : "");
  } else if (fx.$kind === "config_invalid") {
    const rejected = !validateConfig(cfg);
    const errs = validateConfig.errors || [];
    const pointerHit = !fx.expected?.pointer || errs.some((e) => e.instancePath === fx.expected.pointer);
    const msgHit = !fx.expected?.message_contains || errs.some((e) => (e.message || "").includes(fx.expected.message_contains));
    ok(`  rejected at expected pointer: ${rel}`, rejected && pointerHit && msgHit,
      rejected ? `errors at [${[...new Set(errs.map((e) => e.instancePath || "(root)"))].join(", ")}]` : "ACCEPTED (expected rejection)");
  }
}

// 6. inline bad configs (breadth beyond the committed fixtures)
const validPlatform = { base_url: "https://x.internal", auth: { type: "bearer", secret_env: "TOK" }, operations: [{ name: "op", description: "d", method: "GET", path: "/p" }] };
const base = { version: 1, platforms: { p: validPlatform } };
const inlineBad = [
  ["unknown version", { ...base, version: 2 }],
  ["oauth auth", { version: 1, platforms: { p: { ...validPlatform, auth: { type: "oauth", secret_env: "T" } } } }],
  ["missing description", { version: 1, platforms: { p: { ...validPlatform, operations: [{ name: "op", method: "GET", path: "/p" }] } } }],
  ["enum without enum list", { version: 1, platforms: { p: { ...validPlatform, operations: [{ name: "op", description: "d", method: "GET", path: "/p", params: [{ name: "s", in: "query", type: "enum" }] }] } } }],
  ["enum on non-enum type", { version: 1, platforms: { p: { ...validPlatform, operations: [{ name: "op", description: "d", method: "GET", path: "/p", params: [{ name: "s", in: "query", type: "string", enum: ["a"] }] }] } } }],
  ["array in path", { version: 1, platforms: { p: { ...validPlatform, operations: [{ name: "op", description: "d", method: "GET", path: "/p", params: [{ name: "a", in: "path", type: "array", items: { type: "string" } }] }] } } }],
  ["bad header name (CRLF)", { version: 1, platforms: { p: { ...validPlatform, auth: { type: "header", name: "X\r\nEvil", secret_env: "K" } } } }],
  ["raw_request present without enabled", { ...base, raw_request: {} }],
];
console.log(`\n-- ${inlineBad.length} inline bad configs (expect all rejected) --`);
for (const [name, cfg] of inlineBad) ok(`reject: ${name}`, !validateConfig(cfg), validateConfig.errors ? firstErr(validateConfig) : "ACCEPTED!");

dump();
process.exit(results.failures === 0 ? 0 : 1);

function firstErr(v) { const e = (v.errors || [])[0]; return e ? (e.instancePath || "(root)") + " " + e.message : ""; }
function dump() {
  console.log(`\n--- RESULT: ${results.failures === 0 ? "PASS" : "FAIL"} (${results.steps.length - results.failures}/${results.steps.length} checks) ---`);
}
