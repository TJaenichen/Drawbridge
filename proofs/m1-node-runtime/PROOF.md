# Proof — M1: Node runtime, end to end

**Claim.** A real MCP client, talking to the built Drawbridge stdio server over the
wire, can list the generated tools and call them — and a write actually changes
backend state, auth is injected on every request, undeclared tools are refused, and
every call is audited with no secrets.

## How to reproduce

```
cd src/node && corepack pnpm install && corepack pnpm build   # build dist/
cd ../../proofs/m1-node-runtime && corepack pnpm install       # MCP client SDK
node drive.mjs
```

`drive.mjs` starts a **stateful** stub of the work-tracking API (so before/after is
real, unlike the stateless Prism mock), then spawns `node src/node/dist/index.js
--config specs/drawbridge.config.example.yaml` with `TRACKER_BASE_URL`/`TRACKER_TOKEN`
in the env, and drives it via the MCP SDK client over stdio.

## What it demonstrates (see proof-output.txt)

1. **Tool generation over the wire:** `listTools` returns the 3 prefixed tools
   (`internal_tracker_list_work_items`, `_get_work_item`, `_create_work_item`).
2. **Real before/after state:** `list` is `[]` → `create {title}` returns the new
   item → `list` now contains it → `get {id:1}` returns it. Path templating
   (`/work-items/{id}`) and body assembly + the `type:"task"` default all work.
3. **Auth injection:** the stub rejects any request without `Authorization` (401);
   its request log shows `auth=present` on **every** call, so Drawbridge injected the
   bearer token from `TRACKER_TOKEN` without it ever appearing in the tool schema.
4. **Closed world (§8b):** calling an undeclared tool
   (`internal_tracker_delete_everything`) returns an MCP error "Unknown tool" — there
   is no route to an unlisted operation.
5. **Audit (§10):** each call emits a JSONL record on **stderr** (stdout is reserved
   for the MCP protocol) with operation/method/host/path/status/outcome/duration — and
   **no secret and no body**. The refused call is logged with `outcome:"refused"`.

## Unit coverage backing this

`src/node` has 27 vitest tests (config loading + `${ENV}` fail-fast, schema +
invariant validation incl. the 3 `tools` golden fixtures, request building, response/
error mapping, truncation, audit secret-confinement). Run `corepack pnpm test`.
