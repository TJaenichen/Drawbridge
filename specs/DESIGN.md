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
development: a single declarative spec produces two byte-for-byte equivalent
implementations (TypeScript + C#), proven by a shared conformance harness.

**Non-goals (v1).** Multi-user identity (§8.4), OAuth flows (§7), response field
filtering implementation (§9), pagination, hot-reload, remote/HTTP transport,
the `raw_request` escape hatch (§8.3).

## 2. v1 scope & build sequence

v1 is large because parity, private-network reach, OpenAPI generation, and the
monitor are all in. To keep it from collapsing, build in ordered milestones — each
is independently demoable:

| Milestone | Deliverable | Demo |
|-----------|-------------|------|
| **M0** | Config schema (`drawbridge.config.schema.json`) + canonical-serialization rules + golden-fixture format | "the spec compiles" |
| **M1** | **Node**: config → typed tools → request execution → audit log, against the Prism mock | tool call creates a work item in the mock |
| **M2** | **Shared conformance harness** (golden fixtures) running against Node | parity tests green for one impl |
| **M3** | **.NET** implementation passing the *same* fixtures | byte-identical parity proven |
| **M4** | **Private-network demo**: point both at Gitea-in-Docker (no published ports) + GitHub | the marquee story |
| **M5** | **OpenAPI → draft config generator** + **React monitor** | spec-to-config + live audit dashboard (React) |

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
        max_response_bytes: 65536   # v1: truncate beyond this with a notice (§9)

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
  items:{type:…}}`. Emitted using the canonical serialization of §13.
- **read_only:** when `true`, operations whose `method` is not `GET` are **not
  generated at all** — the write tools do not exist (#10d).

## 6. Request execution

- **Path:** substitute `{name}` from `in: path` params; values are **URL-encoded**.
  Host and path template come only from config — never from the model (§8a).
- **Query:** `in: query` params appended; omitted when not supplied and no default.
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

**8.5 Write confirmation — [PROPOSED].** v1 relies on the MCP client's own
tool-approval UI for write operations; Drawbridge reserves an optional per-operation
`confirm: true` for a future server-side gate. (Confirm in §19.)

## 9. Response handling

- **v1:** return the upstream JSON body **as-is**, subject to `max_response_bytes` —
  beyond the cap the body is truncated and a `"truncated": true` notice is added.
- **[v2]:** `returns.fields` allowlist projects the response to named fields only
  (exfiltration control). Specced in the schema; **not enforced in v1**.

## 10. Audit logging

- **Format:** one JSON object per line (JSONL). Versioned record (`v: 1`).
- **Fields:** `ts, v, platform, operation, method, host, path, status, duration_ms,
  outcome (ok|client_error|server_error|timeout|refused), bytes, request_id`.
  **No secrets, no request/response bodies in v1** (bodies are [v2], opt-in).
- **Destination:** a configurable file path (default platform-appropriate), and
  optionally **stderr**. **Never stdout** — stdout is reserved for the MCP protocol.
- This log is the data source for the monitor (§11).

## 11. Monitor (React) — [PROPOSED architecture]

The monitor exists to (a) make the security story tangible and (b) be the React
artifact for the Slalom showcase. Proposed shape, to keep §12 (stdio-only) intact:

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

## 13. Cross-language parity contract (#15 — byte-identical)

Given the **same config** and the **same tool call**, both implementations MUST
produce byte-identical:
1. **Generated tool list** — names, descriptions, and input JSON Schemas.
2. **Outbound HTTP request** — method, full URL (incl. query), headers *excluding*
   the auth header, and body.
3. **Tool result mapping** — success payload and error structure.

To make byte-identity achievable across runtimes, both MUST use **canonical
serialization**:
- JSON object keys sorted lexicographically (UTF-8 code-unit order).
- No insignificant whitespace; UTF-8; LF only.
- Numbers in shortest round-trip form; booleans/null lowercase.
- Query parameters sorted by key, then value; percent-encoding upper-hex.
- Header names lower-cased and sorted for comparison.

The auth header value is excluded from comparison (it's secret); its *presence* and
name are asserted separately.

## 14. Testing strategy

- **Unit tests:** per component, in each language (TS `vitest`; .NET **NUnit +
  NSubstitute + FluentAssertions** — #22).
- **Golden / conformance fixtures (#16):** language-neutral JSON fixtures —
  `{config, tool_call} → {expected_request, expected_result}` — in `specs/fixtures/`.
  A thin runner in each language executes them against the **Prism mock** and asserts
  the §13 byte-identity. Shared fixtures are the parity proof; keep the runners as
  thin as possible so the shared surface is maximal.
- **Mutation testing (#22):** **StrykerJS** (Node) and **Stryker.NET** (.NET), gated
  in CI with a threshold (target TBD) — especially over the validator and executor.
- **Mock backend:** `npx @stoplight/prism mock specs/openapi.example.yaml`.

## 15. OpenAPI → config generation (in v1 — #18)

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

## 19. Open questions (need your input before implementing)

1. **Monitor scope/transport (§11).** Confirm the loopback read-only web server +
   WebSocket tailing the audit log — and is the monitor **v1 (M5)** or do you want it
   parked at v2 so M0–M4 land first?
2. **Write confirmation (§8.5).** Rely on the client's tool-approval UI for v1
   (reserve `confirm:` for later), or do you want a server-side confirmation gate now?
3. **Response size cap (§9).** Default `max_response_bytes` of 64 KiB with truncation —
   right default, or different (and global vs per-operation)?

## 20. Deferred to v2+ (parking lot)

Response field filtering · OAuth · `raw_request` · per-user identity & attribution ·
pagination · non-JSON content types · remote/HTTP transport · request/response body
logging · hot-reload · config includes/imports.
