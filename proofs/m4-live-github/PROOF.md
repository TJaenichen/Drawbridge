# Proof — M4 live: real GitHub API through the proxy

**Claim.** Drawbridge's typed, allowlisted tools operate the **real** GitHub REST API
end to end — real bytes to `api.github.com`, with the injected `User-Agent` and a
server-side bearer token the model never sees.

## How it was run

The token lives only in the environment (`DRAWBRIDGE_GITHUB_TOKEN`); the driver
forwards it to the server as `GITHUB_TOKEN` and never prints it.

```
cd src/node && corepack pnpm install && corepack pnpm build
cd ../../proofs/m4-live-github && corepack pnpm install
$env:DRAWBRIDGE_GITHUB_TOKEN = "<a fine-grained PAT, Issues: read/write on one repo>"
node live.mjs        # create -> get -> list against TJaenichen/Drawbridge
node relist.mjs      # read-only re-list (consistency refresh)
```

## Result (proof-output.txt)

Through the proxy, against the live API:
- `github_create_issue` → created **#1** "Drawbridge live-call proof"
  (https://github.com/TJaenichen/Drawbridge/issues/1), state `open`.
- `github_get_issue {number:1}` → returned the live issue.
- `github_list_issues` → lists `#1` (after GitHub's brief create-then-list lag).

This is the live counterpart to the Docker-free `proofs/m4-private-network` proof: the
config validates and exposes exactly three tools, and here those tools actually drive a
real third-party service. GitHub's `User-Agent` requirement is satisfied by the static
`headers` feature; the bearer token is injected server-side and is absent from the tool
schemas, results, and audit log (per the §8 secret-confinement invariant).

The demo issue (#1) can be closed/deleted; it's a public artifact on the repo.
