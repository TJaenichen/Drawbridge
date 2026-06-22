# Drawbridge — Design Specification

**Status:** draft v0.1 · **Audience:** implementers (Node + .NET) · **Source of truth** for behavior and the cross-language parity contract.

> A declarative, secure bridge that lets cloud AI agents reach the APIs inside a
> private network — on your terms. One spec, one config, one eval harness, two
> implementations that behave identically.

Items marked **[PROPOSED]** are my recommendation pending your confirmation (see
§19). Items marked **[v2]** are specified here but deliberately not implemented in v1.

---

## 1. Goals & non-goals

**Product goal.** Let Claude Desktop / Cowork reach internal HTTP APIs that live
behind a private-network boundary, exposing them as *typed, allowlisted* MCP tools —
not a raw passthrough.

**Engineering goal (the showcase).** Demonstrate spec-driven, AI-orchestrated
development: a single declarative spec produces two behaviorally equivalent
implementations (TypeScript + C#), proven by a shared conformance harness.

**Non-goals (v1).** Multi-user identity (§8.4), OAuth flows (§7), response field
filtering implementation (§9), pagination, hot-reload, remote/HTTP transport,
the `raw_request` escape hatch (§8.3).

## 2. v1 scope & build sequence

v1 is large because parity, private-network reach, and OpenAPI generation are all
in. To keep it from collapsing, build in ordered milestones — each is independently
demoable:

| Milestone | Deliverable | Demo |
|-----------|-------------|------|
| **M0** | Config schema (`drawbridge.config.schema.json`) + equivalence-comparison rules + golden-fixture format | "the spec compiles" |
| **M1** | **Node**: config → typed tools → request execution → audit log, against the Prism mock | tool call creates a work item in the mock |
| **M2** | **Shared conformance harness** (golden fixtures) running against Node | parity tests green for one impl |
| **M3** | **.NET** implementation passing the *same* fixtures | structural parity proven |
| **M4** | **Private-network demo**: point both at Gitea-in-Docker (no published ports) + GitHub | the marquee story |
| **M5** | **OpenAPI → draft config generator** | spec-to-config from `specs/openapi.example.yaml` |

**Demo targets.** Deterministic CI → **Prism mock** (from `specs/openapi.example.yaml`).
Marquee private-network → **Gitea in a Docker network with no published ports**.
Reproducible-by-anyone → **GitHub REST API**.

## 3. Architecture

Two processes that rendezvous via the **audit log file**:

```
                    ┌─────────────────────────── drawbridge (stdio) ───────────────────────────┐
 MCP client  <stdio>│ Config Loader → Validator → Tool Generator → [MCP tools]                  │
 (Desktop/Cowork)   │                                   │                                       │
                    │                          Request Executor → Auth Injector → upstream HTTP  │
                    │                                   │                                       │
                    │                              Audit Logger → JSONL file ──────────┐        │
                    └──────────────────────────────────────────────────────────────────┼────────┘
                                                                                         │ tail
                    ┌──────────────────────── drawbridge monitor (loopback) ────────────▼────────┐
 Browser <-127.0.0.1│ Read-only web server + WebSocket → React dashboard          [PROPOSED §11] │
                    └────────────────────────────────────────────────────────────────────────────┘
```

Components (all must exist identically in both languages except the monitor, which is
React-only):
1. **Config Loader** — reads YAML or JSON, resolves `${ENV}` interpolation.
2. **Validator** — validates against `drawbridge.config.schema.json`; fail-fast.
3. **Tool Generator** — emits one MCP tool per declared operation.
4. **Request Executor** — templates the request, calls upstream, maps the response.
5. **Auth Injector** — adds credentials from the environment; never model-visible.
6. **Audit Logger** — structured JSONL; never writes to stdout.
7. **OpenAPI Generator** (CLI) — OpenAPI doc → *draft* config for human pruning.
8. **Monitor** (React) — reads the audit log, renders a live dashboard.

## 4. Configuration schema

Canonical schema lives at **`specs/drawbridge.config.schema.json`** (JSON Schema,
draft 2020-12). Both implementations validate against it; the monitor and generator
reference it too.

```yaml
version: 1                          # REQUIRED. Config-format version (§17).

defaults:                           # optional, applied to every platform
  timeout_ms: 30000

platforms:
  <platform_key>:                   # [a-z0-9_]+ ; used as the tool-name prefix
    base_url: ${VAR} | literal      # host+path is FIXED; never model-controllable
    timeout_ms: 30000               # optional override
    read_only: false                # true ⇒ non-GET operations are NOT generated
    auth:
      type: bearer | header | basic
      # bearer:  secret_env: TOKEN
      # header:  name: X-Api-Key, secret_env: KEY
      # basic:   username_env: USER, password_env: PASS
    operations:
      - name: <operation_name>      # [a-z0-9_]+ ; tool = "<platform_key>_<name>"
        description: <string>        # REQUIRED (#14) — becomes the tool description
        method: GET|POST|PUT|PATCH|DELETE
        path: /work-items/{id}      # {param} placeholders bind to typed params
        params:                     # FLATTENED into one tool input object (#4)
          - { name: id, in: path,  type: integer, required: true }
          - { name: state, in: query, type: string, enum: [open, closed, all], default: open }
          - { name: title, in: body, type: string, required: true }
        returns:                    # [v2] field allowlist; specced, not enforced in v1
          fields: [id, state, title]
        max_response_bytes: 1048576 # v1: truncate beyond this (§9); default 1 MiB

raw_request:                        # [v2] reserved; MUST be absent/disabled in v1
  enabled: false
  allowed_hosts: []
```

**Parameter model (#4, #5 — KISS).** All of an operation's path/query/body params are
**flattened into a single MCP tool input object**. Each param declares `in:`
(`path|query|body`) so the executor knows where it goes. Supported types:
`string`, `integer`, `number`, `boolean`, `enum` (string enum), and `array` of any
of those. **No nested objects in v1.**

## 5. Tool generation rules

- **Name:** `"{platform_key}_{operation_name}"` (always prefixed — #3). Must be
  unique across the whole config; a collision is a fatal validation error.
- **Description:** the operation's `description` (required — #14). Missing ⇒ fatal.
- **Input schema:** a flat JSON Schema object built from `params` — `required` array
  from `required: true`, `enum`/`default` carried through, `array` → `{type:array,
  items:{type:…}}`. Compared structurally per §13.
- **read_only:** when `true`, operations whose `method` is not `GET` are **not
  generated at all** — the write tools do not exist (#10d).

**Validator-enforced invariants** (JSON Schema can't cross-reference, so the loader's
validator enforces these; each has a conformance fixture):
- **Tool-name uniqueness:** the computed `{platform}_{operation}` must be globally
  unique; a collision is fatal. (The underscore join is ambiguous — `a`+`b_c` vs
  `a_b`+`c` both yield `a_b_c` — so the validator rejects the resulting duplicate.)
- **Path ↔ param coverage:** every `{placeholder}` in `path` has exactly one matching
  `in:path` param; every `in:path` param appears in the template; `in:path` params are
  implicitly required; no `..` traversal segments.
- **Value agreement:** an `enum` param's `default` is one of its members; a `default`
  matches the param's declared type.

## 6. Request execution

- **Path:** substitute `{name}` from `in: path` params; values are **URL-encoded**.
  Host and path template come only from config — never from the model (§8a).
- **Query:** `in: query` params appended; omitted when not supplied and no default.
  **Array query params serialize as repeated keys** (`?label=a&label=b`); arrays are
  restricted to `in: query | body` (no array-in-path).
- **Body:** `in: body` params assembled into a JSON object; `Content-Type:
  application/json`. (Other content types: [v2].)
- **Timeout:** `timeout_ms` (operation → platform → defaults → 30000). On timeout,
  return a structured tool error (§12).
- **Errors (#13):** upstream 4xx/5xx → **structured MCP tool error** carrying the
  status code and a truncated, secret-redacted upstream message. No retries in v1.

## 7. Auth & secrets

- Types v1: **`bearer`**, **`header`** (arbitrary header name + secret), **`basic`**.
- **OAuth: [v2]** — schema reserves an `oauth` auth type; documented, not implemented.
- Secrets resolve from **environment variables only** via `${VAR}` interpolation,
  evaluated at startup. **A referenced but unset variable is a fatal error** (#8).
- Interpolation is allowed in `base_url` and the `*_env` fields.

## 8. Security model — invariants (the moat)

These are hard rules the conformance suite enforces (#10):

- **(a) No model-controlled routing.** The model can never control the host or the
  path *template* — only typed parameter *values* slotted into fixed positions
  (path params URL-encoded). `base_url` + `path` are config-only.
- **(b) Closed world.** Only declared operations exist. Anything else is *impossible*,
  not merely refused — there is no generic request tool in v1.
- **(c) Secret confinement.** Secrets never appear in tool schemas, descriptions,
  arguments, results, or logs (redacted).
- **(d) read_only enforcement.** `read_only: true` ⇒ non-GET tools are not generated.
- **(e) Full audit.** Every call logged: operation, method, host, status, duration,
  outcome — secrets redacted (§10).

**8.3 `raw_request` escape hatch — [v2].** Cut from v1; field reserved and MUST be
absent or `enabled: false`. Documented so the security story is explicit about what
is intentionally *not* built.

**8.4 Single-user assumption — [v1 constraint].** v1 assumes one user, one shared
token per platform from the environment (the laptop/stdio model). Per-user identity
and request attribution are **[v2]**; the schema reserves space but nothing is wired.

**8.5 Write confirmation — [decided].** v1 relies on the MCP client's own
tool-approval UI for write operations; Drawbridge reserves an optional per-operation
`confirm: true` for a future server-side gate (**[v2]**).

## 9. Response handling

- **v1:** return the upstream JSON body **as-is**, subject to `max_response_bytes`
  (**default 1 MiB**, per-operation override) — beyond the cap the body is truncated
  and a `"truncated": true` notice is added.
- **[v2]:** `returns.fields` allowlist projects the response to named fields only
  (exfiltration control). Specced in the schema; **not enforced in v1**.

## 10. Audit logging

- **Format:** one JSON object per line (JSONL). Versioned record (`v: 1`).
- **Fields:** `ts, v, platform, operation, method, host, path, status, duration_ms,
  outcome (ok|client_error|server_error|timeout|refused|error), bytes, request_id`.
  `error` covers build/transport failures (bad argument, connection refused, a status
  outside 2xx/4xx/5xx). **No secrets, no request/response bodies in v1** (bodies are
  [v2], opt-in).
- **Destination:** **stderr by default**; also appends to a file when
  `DRAWBRIDGE_AUDIT_FILE` is set. **Never stdout** — stdout is reserved for the MCP
  protocol. (A platform-default file path arrives with the v2 monitor, §11.)
- This log is the data source for the monitor (§11).

## 11. Monitor (React) — [v2]

Deferred to v2 so M0–M4 + OpenAPI generation land first. Note: this is the React
artifact for the Slalom showcase, so v1 proves TS+C# parity but the *React* piece
arrives with the monitor. Planned shape (v2), designed to keep §12 (stdio-only) intact:

- A separate subcommand — `drawbridge monitor` — starts a **loopback-only
  (127.0.0.1) read-only** web server that serves a Vite/React dashboard and streams
  audit events over a WebSocket by **tailing the JSONL audit log**.
- Loopback-only does not violate the "no inbound on the private network" invariant
  (it is local to the operator's machine).
- The MCP server (stdio) and the monitor never talk directly — they rendezvous only
  through the audit-log file, so the security-critical process stays minimal.
- Dashboard v1: live request feed, per-operation counts, error/refusal highlighting,
  latency. (Confirm scope/v1 in §19.)

## 12. MCP surface

- **Transport:** **stdio only** (#12).
- **Capabilities:** **tools only** — no resources or prompts in v1.
- **Server metadata:** name `drawbridge`, semantic version, config `version` echoed.
- **Errors:** returned as structured MCP tool errors (§6), never as protocol crashes.

## 13. Cross-language parity contract (#15 — structural/semantic equivalence)

Parity is about **behavior, not bytes.** Given the **same config** and the **same
tool call**, both implementations MUST produce **structurally equivalent** output —
the same objects with the same values. Field/key order, whitespace, and incidental
serialization formatting are explicitly **out of scope**: as long as it deserializes
to the same logical object, the two agree.

The three things that must be equivalent:
1. **Generated tool list** — same set of tool names, the same description per tool,
   and the same input schema *structurally* (same params, types, `required` set,
   `enum` members, `default` values). Order-independent.
2. **Outbound HTTP request** — same method; same URL **path**; same **query
   parameters as a set** of key/value pairs (order-independent); same **headers as a
   set** (excluding the auth header); same **body** compared as a **deep-equal JSON
   object** (key order irrelevant, values must match).
3. **Tool result mapping** — same result object (deep-equal) and the same error
   structure (status, outcome, message).

**How equivalence is checked.** The conformance runner normalizes both sides before
comparing — deep structural equality for JSON (recursively, key-order-independent),
sets for query params and headers, exact equality for values, methods, and the URL
path. This normalization is a **test-time concern**; neither implementation is
required to emit canonical output at runtime.

The auth header value is excluded from comparison (it's secret); its *presence* and
name are asserted separately.

## 14. Testing strategy

- **Unit tests:** per component, in each language (TS `vitest`; .NET **NUnit +
  NSubstitute + FluentAssertions** — #22).
- **Golden / conformance fixtures (#16):** language-neutral JSON fixtures —
  `{config, tool_call} → {expected_request, expected_result}` — in `specs/fixtures/`.
  A thin runner in each language executes them against the **Prism mock** and asserts
  the §13 structural equivalence. Shared fixtures are the parity proof; keep the runners as
  thin as possible so the shared surface is maximal.
- **Mutation testing (#22):** **StrykerJS** (Node) and **Stryker.NET** (.NET), gated
  in CI with a threshold (target TBD) — especially over the validator and executor.
- **Mock backend:** `npx @stoplight/prism mock specs/openapi.example.yaml`.

## 15. OpenAPI → config generation (in v1 — #18)

- **Implemented in both languages** (Node + .NET). The generator is part of the
  parity surface: given the same OpenAPI input it must produce structurally
  equivalent draft configs (§13), proven by shared fixtures.
- **CLI:** `drawbridge generate --from <openapi> --out <config> [--platform <key>]`.
- **Behavior:** emit a **draft** config containing *all* operations, each with a
  `# review` marker; the human **prunes** to the allowlist (curation *is* the
  security boundary — never auto-expose everything).
- **Mapping:** `operationId` → `operation.name`; `summary`/`description` → required
  `description`; parameters + requestBody → flattened `params`; `securityScheme` →
  an auth stub the human completes. Unsupported constructs (nested bodies, oneOf,
  etc.) are emitted as commented TODOs, never silently dropped.

## 16. Distribution & UX

- **Config formats:** YAML and JSON both accepted (#19); examples in YAML.
- **Node:** `npx -y drawbridge-mcp --config ./drawbridge.yaml`.
- **.NET:** self-contained single-file binary, same `--config` flag.
- **Client wiring** (`claude_desktop_config.json`):
  ```json
  {
    "mcpServers": {
      "drawbridge": {
        "command": "npx",
        "args": ["-y", "drawbridge-mcp", "--config", "C:/path/to/drawbridge.yaml"],
        "env": { "TRACKER_TOKEN": "…" }
      }
    }
  }
  ```

## 17. Versioning (#23 — bake it in everywhere)

- **Config:** top-level `version:` (integer); validator rejects unknown versions.
- **Config schema:** `$id` carries a schema version.
- **Audit records:** `v:` field per line.
- **Packages:** semantic versioning; the two implementations release in lockstep on
  the same version number to make "parity at version X" meaningful.

## 18. Non-functionals

- **License:** **MIT** (#21). *(Note: Apache-2.0 adds an explicit patent grant; MIT
  is simpler and maximally permissive. Flagging in case the patent grant matters.)*
- **Runtimes:** Node LTS (≥20); .NET 8+. **pnpm** for the Node workspace (npm is
  broken on this machine).
- **Dependencies:** minimal — official MCP SDK per language, a YAML parser, an HTTP
  client, a JSON Schema validator. No heavyweight frameworks in the core.

## 19. Resolved decisions

1. **Monitor (§11).** **Deferred to v2.** v1 ships M0–M4 + OpenAPI generation; the
   React monitor (and thus the React showcase) follows in v2.
2. **Write confirmation (§8.5).** **No server-side gate in v1** — rely on the MCP
   client's tool-approval UI; `confirm:` reserved for v2.
3. **Response size cap (§9).** **Default `max_response_bytes` = 1 MiB**, per-operation
   override; truncate beyond with a `"truncated": true` notice.
4. **Parity (§13).** **Structural/semantic equivalence, not byte-identical** — same
   objects and values; field order, whitespace, and formatting are out of scope.

## 20. Proof obligations

Every feature ships with a re-runnable **proof** under `proofs/<id>/` + a `PROOF.md`
(see CLAUDE.md §6). Proofs are committed; throwaway tooling to produce them lives in
the gitignored `scratchpad/`. Per-feature proof methods:

| Feature | How it's proven |
|---------|-----------------|
| Config load + `${ENV}` | Show a config with `${VAR}` → dump the resolved structure; show an unset var → the fail-fast error. |
| Validation | Feed a known-bad config → capture the rejection + reason; a good one → accepted. (before/after) |
| Tool generation | Dump the generated tool list + input schemas as JSON; assert names are `{platform}_{op}` and descriptions present. |
| `read_only` | Diff the generated tool list with `read_only: false` vs `true` — write tools absent in the latter. |
| Request execution | Capture the **actual outbound HTTP request** for a tool call (against the mock); show mock state **before vs after** a write (e.g. create → the item now lists). |
| Auth injection | Show the captured request **carries** the auth header (positive), **and** grep the tool dump + audit log to show the secret is **absent** (negative). |
| Error mapping | Drive 404/500/timeout from the mock → show the structured tool error returned. |
| Response cap | Return a >1 MiB body → show truncation + `"truncated": true`. |
| Audit log | Show the JSONL lines produced **and** that **stdout is clean** (only MCP protocol bytes). |
| Security invariants (§8) | One proof each — e.g. closed-world: show there is no tool able to reach an undeclared host/path. |
| Cross-language parity | The conformance runner output: **both** implementations pass the **same** `specs/fixtures/`; commit the run report. |
| OpenAPI generation | Input OpenAPI → generated draft config (before/after); show unsupported constructs become TODO comments, not silent drops. |

The proof step is a hard gate: if a proof is missing or inaccurate, the loop restarts
from Plan (CLAUDE.md §4).

## 21. Deferred to v2+ (parking lot)

React monitor (§11) · response field filtering · OAuth · `raw_request` · per-user
identity & attribution · server-side write confirmation · pagination · non-JSON
content types · remote/HTTP transport · request/response body logging · hot-reload ·
config includes/imports.
