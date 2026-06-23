# Proof — v2 slice 2: the React monitor (live, read-only dashboard)

**Claim.** The `drawbridge monitor` subcommand (DESIGN §11) starts a **loopback-only,
read-only** web server that renders a **live** React dashboard by **tailing the audit
JSONL log** — the MCP server and the monitor never talk directly; they rendezvous only
through the log file. New audit events appear in the browser with no page reload.

## How to reproduce

```
cd src/node            && corepack pnpm install && corepack pnpm build       # build server dist/
cd src/node/monitor-ui && corepack pnpm install && corepack pnpm build       # build the React UI -> monitor-ui/dist
cd ../../../proofs/m7-monitor && corepack pnpm install                       # MCP SDK + Playwright
corepack pnpm exec playwright install chromium                               # one-time browser download
node drive.mjs                                                               # writes proof-output.txt + screenshots
```

`drive.mjs` points the MCP server's audit at a temp file (`DRAWBRIDGE_AUDIT_FILE`),
starts the **real `drawbridge monitor` subcommand** against that file, drives tool calls
through the MCP server over stdio (3 ok, 1 upstream-404 error, 1 closed-world refusal),
opens the dashboard in **headless Chromium** (Playwright), screenshots it, then drives
**one more call** and shows the feed update **live**.

## What it demonstrates (see `proof-output.txt`, `dashboard.png`, `dashboard-live.png`)

1. **Tailing rendezvous (§11).** The monitor is launched with only `--audit-file`; it
   never connects to the MCP server. Yet after 5 tool calls the dashboard shows **5
   requests** — it read them purely by tailing the JSONL the server appended.
2. **Live updates over SSE.** With the page already open, a 6th call makes the feed jump
   to **6 requests** with **no reload** (`dashboard-live.png`) — the Server-Sent-Events
   stream pushed the new record and React prepended it.
3. **Error/refusal highlighting.** The undeclared `internal_tracker_delete_everything`
   call (closed-world refusal, §8b) renders amber with a `refused` tag, and a tool call
   that hits an upstream 404 renders red with a `client_error` tag; the summary cards
   read **ok: 4, refused: 1, errors: 1**.
4. **Read-only + loopback (the moat, §11).** The subcommand binds `127.0.0.1` only and
   prints `read-only, tailing <file>`. Backend tests (`monitor-server.test.ts`) assert
   the loopback bind, rejection of a non-loopback `Host` header (anti DNS-rebinding),
   `405` on non-GET, that no request path touches the audit file, and that a symlink in
   the asset dir can't escape the root. The dashboard only ever reads the redacted log.

## Unit coverage backing this

`src/node/test/monitor-tail.test.ts` (11) — replay, append, cumulative multi-poll, partial
trailing line, blank-line skip, malformed skip, not-yet-created file, truncation/rotation
recovery, unchanged-poll no-dup, and the oversize-line OOM-guard drop.
`src/node/test/monitor-server.test.ts` (9) — loopback-only bind, SSE backlog-then-live,
backlog ring cap, multi-client broadcast, read-only (405 + file untouched), non-loopback
`Host` rejection, static serving with traversal blocked + symlink confinement, and the
built-in fallback page. Run `corepack pnpm test`.
