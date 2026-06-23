import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The audit file's location, relative to the user's home dir, when no override is set. */
export const DEFAULT_AUDIT_DIR = ".drawbridge";
export const DEFAULT_AUDIT_FILENAME = "audit.jsonl";

/**
 * Resolve the audit file path: `DRAWBRIDGE_AUDIT_FILE` wins; otherwise the default
 * `~/.drawbridge/audit.jsonl` (uniform across OSes — the monitor's zero-config
 * rendezvous file, DESIGN §10/§11). Pure: `home` is injected for tests/parity. Shared
 * by the audit sink (§10) and the monitor subcommand (§11).
 */
export function resolveAuditFile(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir(),
): string {
  // An empty/whitespace override (e.g. `DRAWBRIDGE_AUDIT_FILE=$UNSET`) means "use the default".
  const override = env.DRAWBRIDGE_AUDIT_FILE;
  if (override && override.trim() !== "") return override;
  return join(home, DEFAULT_AUDIT_DIR, DEFAULT_AUDIT_FILENAME);
}

/**
 * Locate the repo's `specs/` directory (single source of truth for the schema) by
 * walking up from this module. Falls back to a bundled `schema/` dir when published.
 */
export function findConfigSchemaPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const specs = resolve(dir, "specs", "drawbridge.config.schema.json");
    if (existsSync(specs)) return specs;
    const bundled = resolve(dir, "schema", "drawbridge.config.schema.json");
    if (existsSync(bundled)) return bundled;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("Could not locate drawbridge.config.schema.json");
}
