import AjvModule from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { readFileSync } from "node:fs";

// ajv ships as CJS; under NodeNext the runtime default import IS the class, but the
// types expose it as a namespace. Normalize to a constructor.
const Ajv2020 = (AjvModule as unknown as { default?: unknown }).default ?? AjvModule;
import { findConfigSchemaPath } from "../paths.js";
import { ConfigError, type DrawbridgeConfig, type OperationConfig } from "../model.js";
import { generatedOps, toolName } from "../tools/naming.js";

let cached: ValidateFunction | undefined;

function schemaValidator(): ValidateFunction {
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(findConfigSchemaPath(), "utf8"));
  // strictRequired off: if/then conditionals carry `required` in subschemas that do
  // not re-declare the properties (declared on the parent) — valid JSON Schema.
  const Ctor = Ajv2020 as new (opts: object) => { compile: (s: unknown) => ValidateFunction };
  const ajv = new Ctor({ allErrors: true, strict: true, strictRequired: false });
  const v = ajv.compile(schema);
  cached = v;
  return v;
}

const placeholders = (path: string): string[] =>
  [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]!);

/**
 * Validate a raw config object: JSON Schema first, then the cross-reference invariants
 * the schema cannot express. Throws ConfigError on the first problem. Returns the
 * config typed on success.
 */
export function validateConfig(raw: unknown): DrawbridgeConfig {
  const validate = schemaValidator();
  if (!validate(raw)) {
    const errs = (validate.errors ?? [])
      .map((e) => `  ${e.instancePath || "(root)"} ${e.message}`)
      .join("\n");
    throw new ConfigError(`Config does not match schema:\n${errs}`);
  }
  const config = raw as DrawbridgeConfig;

  // Invariant: tool names globally unique.
  const seen = new Map<string, string>();
  for (const [key, platform] of Object.entries(config.platforms)) {
    for (const op of generatedOps(platform)) {
      const name = toolName(key, op);
      if (seen.has(name)) {
        throw new ConfigError(
          `Duplicate tool name "${name}" from ${seen.get(name)} and ${key}.${op.name}.`,
        );
      }
      seen.set(name, `${key}.${op.name}`);
    }
  }

  // Per-operation invariants: path<->param coverage, value agreement.
  for (const [key, platform] of Object.entries(config.platforms)) {
    for (const op of platform.operations) {
      checkPathParams(key, op);
      checkValues(key, op);
    }
  }
  return config;
}

function checkPathParams(key: string, op: OperationConfig): void {
  const where = `${key}.${op.name}`;
  if (op.path.includes("..")) {
    throw new ConfigError(`${where}: path must not contain ".." segments.`);
  }
  const inPath = (op.params ?? []).filter((p) => p.in === "path").map((p) => p.name);
  const tokens = placeholders(op.path);
  for (const t of tokens) {
    if (!inPath.includes(t)) {
      throw new ConfigError(`${where}: path placeholder {${t}} has no matching in:path param.`);
    }
  }
  for (const p of inPath) {
    if (!tokens.includes(p)) {
      throw new ConfigError(`${where}: in:path param "${p}" does not appear in path template.`);
    }
  }
  // Reject duplicate placeholders.
  if (new Set(tokens).size !== tokens.length) {
    throw new ConfigError(`${where}: duplicate path placeholder.`);
  }
}

function checkValues(key: string, op: OperationConfig): void {
  for (const p of op.params ?? []) {
    if (p.default === undefined) continue;
    const where = `${key}.${op.name}.${p.name}`;
    if (p.type === "enum") {
      if (!(p.enum ?? []).includes(p.default as string)) {
        throw new ConfigError(`${where}: default "${String(p.default)}" is not one of the enum members.`);
      }
    } else if (!typeMatches(p.type, p.default)) {
      throw new ConfigError(`${where}: default ${JSON.stringify(p.default)} does not match type ${p.type}.`);
    }
  }
}

function typeMatches(type: string, v: unknown): boolean {
  switch (type) {
    case "string":
      return typeof v === "string";
    case "boolean":
      return typeof v === "boolean";
    case "number":
      return typeof v === "number";
    case "integer":
      return typeof v === "number" && Number.isInteger(v);
    case "array":
      return Array.isArray(v);
    default:
      return true;
  }
}
