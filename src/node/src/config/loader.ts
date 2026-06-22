import { readFileSync } from "node:fs";
import { extname } from "node:path";
import yaml from "js-yaml";
import { ConfigError, type DrawbridgeConfig } from "../model.js";
import { validateConfig } from "./validator.js";

export type Env = Record<string, string | undefined>;

const ENV_REF = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** Recursively replace ${VAR} in every string. Records names that are unset. */
function interpolate(value: unknown, env: Env, missing: Set<string>): unknown {
  if (typeof value === "string") {
    return value.replace(ENV_REF, (_, name: string) => {
      const v = env[name];
      if (v === undefined) {
        missing.add(name);
        return "";
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map((v) => interpolate(v, env, missing));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolate(v, env, missing)]),
    );
  }
  return value;
}

/** Env var names a platform's auth resolves at request time. */
function authEnvVars(config: DrawbridgeConfig): string[] {
  const names: string[] = [];
  for (const platform of Object.values(config.platforms)) {
    const a = platform.auth;
    if (a.secret_env) names.push(a.secret_env);
    if (a.username_env) names.push(a.username_env);
    if (a.password_env) names.push(a.password_env);
  }
  return names;
}

/**
 * Validate then resolve a raw config against the environment. Fails fast if any
 * referenced env var (in ${...} interpolation or an auth *_env) is unset.
 */
export function loadConfig(raw: unknown, env: Env): DrawbridgeConfig {
  const config = validateConfig(raw);

  const missing = new Set<string>();
  const resolved = interpolate(config, env, missing) as DrawbridgeConfig;

  for (const name of authEnvVars(resolved)) {
    if (env[name] === undefined) missing.add(name);
  }
  if (missing.size > 0) {
    throw new ConfigError(`Missing required environment variable(s): ${[...missing].sort().join(", ")}`);
  }

  // Re-validate base_url AFTER interpolation: the schema only saw the ${...} literal,
  // so an env value could smuggle a bad scheme or inline userinfo (§8a defense-in-depth).
  for (const [key, platform] of Object.entries(resolved.platforms)) {
    if (!/^https?:\/\/[^@\s]+$/.test(platform.base_url)) {
      throw new ConfigError(`platform "${key}": resolved base_url "${platform.base_url}" must be http(s) with no inline userinfo.`);
    }
  }
  return resolved;
}

/** Read and parse a config file (YAML or JSON) — no resolution. */
export function parseConfigFile(path: string): unknown {
  const text = readFileSync(path, "utf8");
  return extname(path) === ".json" ? JSON.parse(text) : yaml.load(text);
}

/** Read, parse, validate, and resolve a config file. */
export function loadConfigFile(path: string, env: Env): DrawbridgeConfig {
  return loadConfig(parseConfigFile(path), env);
}
