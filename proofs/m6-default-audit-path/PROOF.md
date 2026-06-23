# Proof — v2 slice 1: default audit-file path (both languages)

**Claim.** With **zero audit configuration** (`DRAWBRIDGE_AUDIT_FILE` unset), both the
Node and the .NET server write their audit JSONL to the **default** location
`~/.drawbridge/audit.jsonl` — the monitor's zero-config rendezvous file (DESIGN §10/§11) —
and they do so **identically**: same records, no secret, stdout still clean.

## How to reproduce

```
cd src/node   && corepack pnpm install && corepack pnpm build          # build Node dist/
cd ../dotnet  && dotnet build src/Drawbridge.Cli/Drawbridge.Cli.csproj -c Release
cd ../../proofs/m6-default-audit-path && corepack pnpm install          # MCP client SDK
node drive.mjs                                                          # writes proof-output.txt
```

`drive.mjs` runs each language in turn: it starts a fresh stateful stub of the internal
API, points the spawned server's **`HOME`/`USERPROFILE` at a throwaway temp dir** (so the
proof is hermetic and never touches the real home), **unsets `DRAWBRIDGE_AUDIT_FILE`**, and
drives a real MCP client over stdio through four tool calls (create, list, get, and one
*undeclared* tool). Then it reads back the default audit file and checks it.

## What it demonstrates (see `proof-output.txt`)

1. **Zero-config default path.** Neither server is told where to log. Both create
   `<temp-home>/.drawbridge/audit.jsonl` and write **4 records** (one per call). The
   `drawbridge: audit -> <path>` startup line on stderr announces the resolved destination.
2. **Cross-language parity (§13).** The two languages produce the **identical**
   `(operation : outcome)` sequence:
   `create_work_item:ok, list_work_items:ok, get_work_item:ok, internal_tracker_delete_everything:refused`.
   The .NET home resolution now matches Node's `os.homedir()` (USERPROFILE on Windows,
   HOME on Unix), so the same temp-home redirection works for both.
3. **stdout stays clean (§10/§12).** The MCP client parses every response over stdio; a
   single stray byte on stdout would break the protocol. It doesn't — audit goes to the
   file + stderr only.
4. **Closed-world refusal is audited (§8b).** The undeclared `internal_tracker_delete_everything`
   tool is refused and recorded with `outcome:"refused"` in both languages.
5. **Secret confinement (§8c).** The bearer token (`proof-token-123`) is injected on every
   upstream call yet appears **nowhere** in the audit file — asserted false in both runs.

## Unit coverage backing this

`src/node/test/audit.test.ts` and `src/dotnet/.../AuditLoggerTests.cs` cover, symmetrically:
env-var precedence (incl. empty/whitespace treated as unset), the default path under a
fixed home, home resolution from `HOME`/`USERPROFILE`, the default sink creating
`~/.drawbridge/` and appending there (never stdout), and graceful degradation in **both**
failure modes — dir-uncreatable *and* append-fails-after-start — each asserting a single
one-time warning and no crash. The file/dir are created owner-only (`0600`/`0700`) on Unix.
