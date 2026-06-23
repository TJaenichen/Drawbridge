# Drawbridge — Handover

Pick-up document for continuing in a fresh session. Read this, then `CLAUDE.md`
(how we work) and `specs/DESIGN.md` (the spec / source of truth).

- **Repo:** https://github.com/TJaenichen/Drawbridge (public, MIT)
- **State as of this handover:** v1 complete + hardened (CI + mutation testing), **plus
  v2 slices 1–2 shipped** (default audit-file path + the React monitor — see §8). Latest
  commit `c8554a2` on `main`. Working tree clean.
- **Local path:** `D:\work\Drawbridge`

---

## 1. What Drawbridge is

A declarative, secure **MCP proxy**: it exposes a private network's HTTP APIs to a
cloud AI agent (Claude Desktop / Cowork) as **typed, allowlisted tools** — the
disciplined alternative to a "run any HTTP request" tool (a confused-deputy/SSRF
hazard). You describe platforms + operations in a config; Drawbridge auto-generates
schema'd MCP tools, injects auth server-side (the model never sees the token), and
refuses anything not declared.

**The thesis it demonstrates:** one spec → **two behaviorally-identical implementations**
(TypeScript + C#), proven equivalent by a shared golden-fixture conformance suite and a
live cross-language parity proof. It's a "show, don't tell" showcase (general-purpose,
not tied to any job/pitch).

---

## 2. Status & numbers

| | Node (TS) | .NET (C#) |
|---|---|---|
| Location | `src/node` | `src/dotnet` |
| Tests | 82 (`corepack pnpm test`) | 20 conformance + 32 unit (`dotnet test`) |
| Mutation score | **76.4%** StrykerJS | **61.4%** Stryker.NET |
| Runtime | MCP stdio server (official SDK) | MCP stdio server (hand-rolled JSON-RPC) |
| Distribution target | `npx -y drawbridge-mcp` | self-contained binary |

- **CI:** `.github/workflows/ci.yml` — runs both suites on push/PR to `main`, green badge
  in README. (Mutation testing is a **manual** gate, not in CI — it's minutes-long.)
- **Milestones M0–M5** all built and proven. Plus a live GitHub proof and mutation proof.

---

## 3. Repo layout (where everything is)

```
CLAUDE.md                 working agreement: principles + the build loop + review panel
README.md                 front page (status, quickstart, layout)
specs/
  DESIGN.md               THE SPEC — source of truth for behavior + parity contract
  drawbridge.config.schema.json   the config JSON Schema (the contract)
  drawbridge.config.example.yaml  example config (the canonical sample)
  openapi.example.yaml            example OpenAPI (drives the generator + Prism mock)
  fixtures/               SHARED golden fixtures — run in BOTH languages
    fixture.schema.json   the fixture-format contract
    tools/  requests/  validation/  generate/
docs/
  threat-model.md         security threat model
  HANDOVER.md             this file
proofs/                   committed, re-runnable proofs (M0–M5, m4-live-github, mutation-testing)
demo/                     runnable demos: GitHub + Gitea configs, docker-compose, README
src/
  node/                   TypeScript implementation (+ OpenAPI generator)
  dotnet/                 C# implementation (.slnx solution: Core/Cli/Tests/Conformance)
.github/workflows/ci.yml  CI
```

### Node file map (`src/node/src/`)
`model.ts` · `paths.ts` (schema locator) · `config/{loader,validator}.ts` ·
`tools/{generator,naming}.ts` · `exec/{auth,http,executor}.ts` · `audit/logger.ts` ·
`mcp/server.ts` (uses `@modelcontextprotocol/sdk`) · `generate/openapi.ts` ·
`index.ts` (CLI: default=serve, `generate` subcommand). Tests in `test/*.test.ts` +
`test/fixtures.ts`. `stryker.config.json`, `scripts/copy-schema.mjs`.

### .NET file map (`src/dotnet/src/Drawbridge.Core/`)
`Model.cs` · `Paths.cs` · `Yaml.cs` (YAML→JsonNode w/ type inference) · `JsonEqual.cs`
(structural equality) · `Config/{ConfigValidator,ConfigLoader}.cs` ·
`Tools/ToolGenerator.cs` · `Exec/{AuthInjector,Http,Executor}.cs` · `Audit/AuditLogger.cs` ·
`Mcp/McpStdioServer.cs` (hand-rolled JSON-RPC, **not** the SDK) · `Generate/OpenApiGenerator.cs`.
CLI in `Drawbridge.Cli/Program.cs`. Tests in `test/Drawbridge.Tests/` (unit) +
`test/Drawbridge.Conformance/` (fixtures). `stryker-config.json`, `dotnet-tools.json`.

---

## 4. How it works (architecture)

**Pipeline (both languages, mirrored component-for-component):**
config loader (`${ENV}` interpolation, fail-fast) → validator (JSON Schema + the
invariants schema can't express) → tool generator (config → typed MCP tools) → MCP
stdio server → on a tool call: request executor (path templating + URL-encode,
repeated-key array query, body assembly, **static headers**, auth injection,
response/error mapping, UTF-8-safe truncation, secret redaction) → audit logger (JSONL).

**Principles (CLAUDE.md §1–2):** DRY / clean / KISS / YAGNI; **pure core, I/O at the
edges** (HTTP client, audit sink, clock, env all injected — no DI framework). The
language-neutral artifacts in `specs/` are the single source of truth; each language
mirrors the same component boundaries, so the conformance fixtures are the contract.

**Parity contract (DESIGN §13):** **structural/semantic equivalence, NOT byte-identical** —
same objects + values; field order / whitespace / formatting are out of scope. Verified
by the shared fixtures (`JsonEqual` / vitest `toEqual`) and the live parity proof.

**Security moat (DESIGN §8):** (a) no model-controlled host/path — only typed param
*values* slotted into fixed positions, URL-encoded; (b) closed world — only declared
ops exist, unknown tool = refused; (c) secret confinement — token never in schemas,
results, or audit (redaction scrubs actual secret values); (d) `read_only` omits write
tools; (e) every call audited. `raw_request` is reserved but **not built** in v1.

---

## 5. How to build / test / run / prove

**Node** (Windows: `pnpm` is not on PATH — use `corepack pnpm`; npm is broken here):
```
cd src/node
corepack pnpm install
corepack pnpm build        # tsc -> dist/ (prebuild copies schema into src/node/schema)
corepack pnpm test         # vitest, 58 tests
corepack pnpm mutation     # StrykerJS (minutes; inPlace mode)
```

**.NET** (.NET 10 SDK; solution is `.slnx`, the new XML format):
```
cd src/dotnet
dotnet test Drawbridge.slnx                              # 20 conformance + 26 unit
cd src/Drawbridge.Core && dotnet stryker                 # Stryker.NET (minutes)
```

**Run the server** (stdio MCP):
```
node src/node/dist/index.js --config <config.yaml>
dotnet src/dotnet/src/Drawbridge.Cli/bin/Debug/net10.0/Drawbridge.Cli.dll --config <config.yaml>
```

**Generate a config from OpenAPI:**
```
node src/node/dist/index.js generate --from specs/openapi.example.yaml --platform foo
```

**Proofs** (each `proofs/<id>/PROOF.md` has repro steps): `m0-config-schema`,
`m1-node-runtime`, `m3-dotnet-parity`, `m4-private-network`, `m4-live-github`,
`m5-generator`, `mutation-testing`.

**Demos** (`demo/README.md`): GitHub (set `GITHUB_TOKEN`, reproducible) and Gitea
(`docker compose up`, private-network story).

---

## 6. Gotchas (the things that cost time — read before touching)

- **pnpm via corepack only.** `pnpm` isn't on PATH; npm is broken (Node 24 / minizlib).
  Always `corepack pnpm …`. `packageManager` is pinned in `package.json`.
- **pnpm v10 + esbuild:** ignored build scripts are a CI **error**, not a warning.
  `package.json` has `"pnpm": { "onlyBuiltDependencies": ["esbuild"] }` — keep it.
- **.slnx, net10.0.** `dotnet new sln` produced `.slnx`. SDK 9 + 10 are installed.
- **Schema bundling.** The validator loads `drawbridge.config.schema.json` by walking up
  for `specs/` or a bundled `schema/`. Node copies it via `scripts/copy-schema.mjs`
  (prebuild/prepare → `src/node/schema/`, gitignored). .NET copies it into build output
  via `Drawbridge.Core.csproj`. Don't break these or published/sandboxed runs can't find
  the schema.
- **Conformance fixtures resolution.** `Drawbridge.Conformance.csproj` bundles `specs/**`
  into its output so fixtures resolve from any working dir (incl. the mutation sandbox).
  Node fixtures resolve via `../../../specs` from the test file.
- **Mutation testing quirks:** StrykerJS needs `"inPlace": true` (so the sandbox can see
  `specs/`) + explicit `"plugins": ["@stryker-mutator/vitest-runner"]` (pnpm symlinks
  break auto-discovery). `inPlace` rewrites sources during the run and restores them
  after — verify `git status` is clean afterward. Both configs exclude `http`/`Http`
  (real-HTTP edge) and `index`/`Paths` (glue).
- **ajv (Node):** ESM/NodeNext default-import needs the normalization in `validator.ts`;
  `strictRequired:false` (the `if/then` idiom puts `required` in subschemas).
- **JsonSchema.Net 9.2.2 (.NET):** `Evaluate` takes a `JsonElement` (not `JsonNode`);
  results expose `.IsValid` / `.Details` / `.Errors` (no `HasErrors`).
- **The .NET MCP server is hand-rolled** (newline-delimited JSON-RPC in `McpStdioServer.cs`),
  *deliberately* — the official C# SDK was preview/attribute-based and a poor fit for
  dynamically-generated tools. It's proven correct by driving it with the **official Node
  SDK client** in `proofs/m3-dotnet-parity`.
- **Secrets/tokens:** the harness safety classifier blocks inlining a token on a command
  line or writing it to a file. Pass tokens via an **env var read at runtime** (the live
  GitHub proof uses `DRAWBRIDGE_GITHUB_TOKEN`).
- **Line endings:** `.gitattributes` normalizes to LF; ignore the CRLF/LF git warnings.

---

## 7. Key decisions (and why)

- **Two implementations, one spec** — the showcase. Parity = structural, not byte.
- **Static headers (v1):** added so GitHub works (`User-Agent` required). Config-only,
  non-secret, injected before auth/content-type. `platform.headers` in the schema.
- **Generator output is JSON** (not commented YAML); unsupported OpenAPI constructs
  **coerce to `type: string`** in the draft (documented, human prunes). `snake()`
  always yields a valid identifier; relative server URLs → `${BASE_URL}` sentinel.
- **Audit → stderr always**, plus a file: `DRAWBRIDGE_AUDIT_FILE` if set, else the **default
  `~/.drawbridge/audit.jsonl`** (v2 slice 1 — created if missing, owner-only perms, degrades
  to stderr-only on write failure). Both languages resolve home identically (USERPROFILE on
  Windows, HOME on Unix). See `proofs/m6-default-audit-path`.
- **Audit `outcome` enum** includes `error` (build/transport failures) beyond the 4 HTTP
  outcomes + `timeout`/`refused`.
- Full decision log: DESIGN.md §19 + the five review-panel passes (M0/M1/M3 + final),
  every blocker/major fixed and locked with a fixture.

### Known minor deferred items (from the M3 review — low-risk, documented)
- Static `Content-Type` with no body: .NET drops it, Node sends it (unusual config).
- YAML hex/octal/leading-zero scalar inference differs slightly (js-yaml vs the hand
  converter). Number-to-string for non-canonical numeric args (e.g. `1.0`) can differ.
- None affect the fixtures, the demos, or the security invariants.

---

## 8. v2 backlog & recommended next step

Parking lot (DESIGN §21), rough value order for the showcase:

0. **✅ DONE — default audit-file path (v2 slice 1).** Both languages default to
   `~/.drawbridge/audit.jsonl` when `DRAWBRIDGE_AUDIT_FILE` is unset (the monitor's
   zero-config rendezvous file). Commit `8252844`, proof `proofs/m6-default-audit-path`.
   This was the monitor's prerequisite — **the monitor can now be built directly.**
1. **✅ DONE — React monitor (v2 slice 2).** `drawbridge monitor` — a loopback-only,
   read-only web server (`src/node/src/monitor/{tail,server}.ts`, subcommand in
   `index.ts`) that tails the default audit log and streams it **live over SSE** to a
   Vite/React dashboard (`src/node/monitor-ui/`, built to `monitor-ui/dist`). Live feed,
   per-op counts, error/refusal highlighting, latency. React-only/Node-only (documented
   parity exemption, §3). Commit `c8554a2`, proof `proofs/m7-monitor` (Playwright
   screenshots). `resolveAuditFile` now lives in `paths.ts` (shared by sink + monitor).
   - **Run it:** `node src/node/dist/index.js monitor` (defaults to port 4737 + the
     default audit file). Build the UI first: `cd src/node/monitor-ui && corepack pnpm
     install && corepack pnpm build`.
   - **Open follow-up (parked, §21):** the published npm package does **not** yet bundle
     `monitor-ui/dist`, so `npx drawbridge-mcp monitor` would serve the built-in fallback
     page, not the React UI. `findUiDir()` already looks for a bundled `ui/` dir; a
     `prepack` step should build monitor-ui and copy its `dist` → `ui/` (mirror
     `copy-schema.mjs`) and add `ui` to `package.json` `files`. Not needed until publish.
2. **Response field-filtering** — the `returns.fields` exfiltration control (already
   schema-reserved, specced §9, not enforced in v1).
3. **OAuth** auth type (schema reserves it; §7).
4. **Per-user identity / attribution** (§8.4).

Other deferred: `raw_request` escape hatch, pagination, non-JSON content types,
remote/HTTP transport, request/response body logging, hot-reload, config includes.

---

## 9. The working loop (how to keep building — CLAUDE.md §4–6)

Per feature/milestone: **Plan → Build → Test → Run tests → Fix → Review (5 parallel
agents: spec / functionality / architecture / coverage / **security**) → Implement fixes
→ loop tests → Provide proof → Verify proof.** Throwaway tooling lives in gitignored
`scratchpad/`; committed evidence in `proofs/<id>/PROOF.md`. The review panels are run
as background `Workflow` fan-outs (see this session's history). Commit + push as you go.

---

## 10. Misc

- Captured in the user's Omni wiki as general evidence:
  `domains/road-to-dark-factory/wiki/evidence/drawbridge-showcase.md` (separate vault).
- The demo GitHub issue (#1 "Drawbridge live-call proof") can be closed/deleted.
- Commit-message trailers (`Co-Authored-By` / `Claude-Session`) in history are this
  session's harness convention; a new session will have its own.
