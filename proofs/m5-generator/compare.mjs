// Compares two generated draft configs structurally (order-independent for objects).
import { readFileSync } from "node:fs";

const [a, b] = process.argv.slice(2);
const A = JSON.parse(readFileSync(a, "utf8"));
const B = JSON.parse(readFileSync(b, "utf8"));
const canon = (x) =>
  Array.isArray(x) ? x.map(canon)
    : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, canon(x[k])]))
    : x;

const match = JSON.stringify(canon(A)) === JSON.stringify(canon(B));
console.log("Generated draft config (Node):");
console.log(JSON.stringify(A, null, 2));
console.log(`\nPARITY: ${match ? "OK — Node and .NET generators produced structurally identical drafts" : "MISMATCH"}`);
process.exit(match ? 0 : 1);
