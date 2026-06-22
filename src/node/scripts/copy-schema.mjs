// Bundle the canonical config schema into the package so the published (npx) build
// can locate it without the repo's specs/ dir. Keeps specs/ the single source.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "../../../specs/drawbridge.config.schema.json");
const outDir = resolve(here, "../schema");
mkdirSync(outDir, { recursive: true });
copyFileSync(src, resolve(outDir, "drawbridge.config.schema.json"));
console.log("copied schema -> src/node/schema/drawbridge.config.schema.json");
