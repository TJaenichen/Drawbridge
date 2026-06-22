# Proof — M4: demo configs (GitHub + Gitea private-network)

**Claim.** Both demo configs (`demo/drawbridge.github.yaml`, `demo/drawbridge.gitea.yaml`)
are valid and each exposes exactly its three allowlisted operations to the agent —
verifiable before any container, token, or live call.

## How to reproduce (Docker-free)

```
cd src/node && corepack pnpm install && corepack pnpm build
cd ../../proofs/m4-private-network && corepack pnpm install && node list-tools.mjs
```

`list-tools.mjs` starts the real Drawbridge server over stdio with each config and a
**dummy** token, then calls `listTools`. The server reaching "ready" proves the config
validated and loaded (including the static `User-Agent` header GitHub requires);
`listTools` makes no upstream call.

## Result (proof-output.txt)

Both `github_*` and `gitea_*` configs load and expose exactly their three allowlisted
tools (`list_issues`, `get_issue`, `create_issue`). Static-header injection (GitHub's
`User-Agent`/`Accept`) is separately locked by the shared `static-headers` golden
fixture, which passes in both languages.

## Live run (requires Docker — not run in this environment)

`demo/README.md` is the runbook: `docker compose up -d` a Gitea instance, mint a token,
point Drawbridge at it (or wire it into `claude_desktop_config.json`), and the agent can
list/create issues through the three allowlisted tools — the private-network crossing.
Docker was not available in the build environment, so the container run is documented
but not executed here; the config/tool wiring above is proven without it, and the live
HTTP path is already proven against real servers in `proofs/m1-node-runtime` and
`proofs/m3-dotnet-parity`.
