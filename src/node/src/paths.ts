import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
