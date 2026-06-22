# Demos

Drawbridge lets a cloud agent (Claude Desktop / Cowork) operate an HTTP API it normally
couldn't — exposing only the operations you allowlist and keeping the token server-side.

Two configs are provided:

- **`drawbridge.github.yaml`** — the GitHub REST API. Reproducible by anyone with a
  token; shows static headers (GitHub requires a `User-Agent`).
- **`drawbridge.gitea.yaml`** — a self-hosted **Gitea** standing in for an *internal*
  service, run via Docker. The private-network story: Gitea is the castle, the token is
  the key you hold, Drawbridge is the drawbridge you lower for exactly three operations.

## GitHub (quick, reproducible)

```bash
export GITHUB_TOKEN=<your-github-pat>          # repo scope
node ../src/node/dist/index.js --config drawbridge.github.yaml
# or: dotnet ../src/dotnet/src/Drawbridge.Cli/bin/Debug/net10.0/Drawbridge.Cli.dll --config drawbridge.github.yaml
```

The agent sees exactly `github_list_issues`, `github_get_issue`, `github_create_issue`.
Drawbridge injects the required `User-Agent` (static header) and the bearer token; the
token never enters the model.

## Gitea (private-network story, requires Docker)

```bash
docker compose up -d                            # starts Gitea on http://localhost:3000
# Open http://localhost:3000, complete setup, create a user + repo, then mint a token.
export GITEA_BASE_URL=http://localhost:3000
export GITEA_TOKEN=<your-gitea-token>
node ../src/node/dist/index.js --config drawbridge.gitea.yaml
```

In a real deployment Gitea would sit on a private network with no public ingress, and
Drawbridge would be the controlled crossing.

## Wire into Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "drawbridge-mcp", "--config", "/abs/path/demo/drawbridge.github.yaml"],
      "env": { "GITHUB_TOKEN": "…" }
    }
  }
}
```

## What's proven without Docker / tokens

`proofs/m4-private-network` loads **both** configs (with dummy tokens) and shows each
exposes exactly its three allowlisted tools and validates — so the wiring is correct
before any container or live call. The static-header injection is locked by the shared
`static-headers` golden fixture (passes in both languages).
