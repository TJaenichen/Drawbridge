# Proof — M4: private-network demo (Gitea)

**Claim.** The Gitea demo config (`demo/drawbridge.gitea.yaml`) is valid and exposes
exactly the three allowlisted operations to the agent — verifiable before any container
is started.

## How to reproduce (Docker-free)

```
cd src/node && corepack pnpm install && corepack pnpm build
cd ../../proofs/m4-private-network && corepack pnpm install && node list-tools.mjs
```

`list-tools.mjs` starts the real Drawbridge server over stdio with the Gitea config and
a **dummy** token, then calls `listTools`. The server reaching "ready" proves the config
validated and loaded; `listTools` makes no upstream call.

## Result (proof-output.txt)

```
Gitea config loaded + validated. Allowlisted tools the agent can see:
  - gitea_list_issues: List issues in a repository.
  - gitea_get_issue: Get a single issue by its index.
  - gitea_create_issue: Create an issue in a repository.

Exactly 3 tools exposed — nothing else on the Gitea API is reachable.
```

## Live run (requires Docker — not run in this environment)

`demo/README.md` is the runbook: `docker compose up -d` a Gitea instance, mint a token,
point Drawbridge at it (or wire it into `claude_desktop_config.json`), and the agent can
list/create issues through the three allowlisted tools — the private-network crossing.
Docker was not available in the build environment, so the container run is documented
but not executed here; the config/tool wiring above is proven without it, and the live
HTTP path is already proven against real servers in `proofs/m1-node-runtime` and
`proofs/m3-dotnet-parity`.
