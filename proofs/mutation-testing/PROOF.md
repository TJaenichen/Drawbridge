# Proof — mutation testing (both languages)

**Claim.** The test suites don't just pass — they *bite*. Mutation testing seeds
thousands of small faults and checks the tests catch them, so the score measures real
assertion strength, not line-coverage theatre.

## Scores

| Language | Tool | Mutation score | Reproduce |
|----------|------|---------------:|-----------|
| Node / TS | StrykerJS (vitest) | **76.4 %** | `cd src/node && corepack pnpm mutation` |
| .NET / C# | Stryker.NET | **61.4 %** | `cd src/dotnet/src/Drawbridge.Core && dotnet stryker` |

Per-file highlights (Node): `tools/generator.ts`, `naming.ts`, `model.ts` **100 %**;
`mcp/server.ts` 89 %, `auth.ts` 95 %, `loader.ts` 84 %, `executor.ts` 72 %.

> Mutation score is a **per-language test-quality** metric, **not** a parity metric —
> different mutators produce different edge-mutants per language, so the two numbers
> aren't meant to match. Behavioral parity is the conformance suite's job (it runs the
> same golden fixtures in both languages; see `proofs/m3-dotnet-parity`).

## What this run already caught and fixed

Running it honestly exposed and corrected real test/infra gaps:
- **Node started at 45.8 %** — because Stryker's sandbox couldn't resolve `specs/`, so
  the fixture-driven (conformance) tests silently didn't count. Switching Stryker to
  `inPlace` (no sandbox) let the strong fixture assertions count → **76.4 %**.
- **.NET started at 20 %** for the same reason. Fix: the conformance project now
  **bundles `specs/` into its build output** (self-contained fixtures), so they resolve
  in any working dir — and the `McpStdioServer` and `AuditLogger`, which had **no .NET
  unit tests** (an asymmetry with Node), got proper tests. → **61.4 %**.

## Methodology / honest caveats

- `inPlace` (Node) modifies sources during the run and restores them after; verified
  the tree is clean post-run.
- Excluded from mutation: `http.ts` / `Http.cs` (the real-HTTP edge, exercised by the
  e2e and live proofs, not unit tests) and `index.ts` / `Paths.cs` (CLI/path glue).
- Break thresholds are committed (`stryker.config.json` / `stryker-config.json`) so a
  regression below the floor fails the run.
- Mutation testing is a **manual gate** (`pnpm mutation` / `dotnet stryker`), not part
  of the per-push CI — it's minutes-long and run on demand.
