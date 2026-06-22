// Config model — mirrors specs/drawbridge.config.schema.json (the source of truth).

export type AuthType = "bearer" | "header" | "basic";
export type ParamIn = "path" | "query" | "body";
export type ParamType = "string" | "integer" | "number" | "boolean" | "enum" | "array";
export type ElementType = "string" | "integer" | "number" | "boolean" | "enum";

export interface AuthConfig {
  type: AuthType;
  secret_env?: string;
  name?: string;
  username_env?: string;
  password_env?: string;
}

export interface ParamItems {
  type: ElementType;
  enum?: string[];
}

export interface ParamConfig {
  name: string;
  in: ParamIn;
  type: ParamType;
  required?: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
  items?: ParamItems;
}

export interface OperationConfig {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  timeout_ms?: number;
  path: string;
  params?: ParamConfig[];
  returns?: { fields?: string[] };
  max_response_bytes?: number;
}

export interface PlatformConfig {
  base_url: string;
  timeout_ms?: number;
  read_only?: boolean;
  auth: AuthConfig;
  operations: OperationConfig[];
}

export interface DrawbridgeConfig {
  version: 1;
  defaults?: { timeout_ms?: number };
  platforms: Record<string, PlatformConfig>;
  raw_request?: { enabled: false };
}

/** A generated MCP tool. inputSchema is JSON Schema (Draft 2020-12 compatible). */
export interface GeneratedTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Back-reference used by the executor to resolve the call. */
  platformKey: string;
  operation: OperationConfig;
}

export const DEFAULT_TIMEOUT_MS = 30000;
export const DEFAULT_MAX_RESPONSE_BYTES = 1048576;

/** Error thrown for any invalid configuration (fail-fast at startup). */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
