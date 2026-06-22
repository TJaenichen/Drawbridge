import { type AuthConfig, ConfigError } from "../model.js";
import type { Env } from "../config/loader.js";

export interface AuthHeader {
  name: string;
  value: string;
}

function reqEnv(env: Env, name: string | undefined): string {
  const v = name ? env[name] : undefined;
  if (v === undefined) throw new ConfigError(`Auth env var "${name}" is not set.`);
  return v;
}

/**
 * Build the auth header from config + environment. The secret is read here and never
 * exposed to the model, the tool schema, or the audit log (§8c).
 */
export function buildAuthHeader(auth: AuthConfig, env: Env): AuthHeader {
  switch (auth.type) {
    case "bearer":
      return { name: "authorization", value: `Bearer ${reqEnv(env, auth.secret_env)}` };
    case "header":
      return { name: auth.name!, value: reqEnv(env, auth.secret_env) };
    case "basic": {
      const user = reqEnv(env, auth.username_env);
      const pass = reqEnv(env, auth.password_env);
      return { name: "authorization", value: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}` };
    }
  }
}
