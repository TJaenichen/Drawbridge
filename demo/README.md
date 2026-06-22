# Private-network demo (Gitea)

Drawbridge lets a cloud agent (Claude Desktop / Cowork) operate a service it normally
couldn't reach — here, a **Gitea** instance standing in for an internal tool — while
exposing only the operations you allowlist and keeping the token server-side.

> Gitea is the castle; the token is the key you hold; Drawbridge is the drawbridge you
> lower for exactly three operations.

## Run it

```bash
# 1. Start Gitea (requires Docker).
cd demo && docker compose up -d
# Open http://localhost:3000, complete first-run setup, create a user + a repo,
# then Settings -> Applications -> generate a token with repo scope.

# 2. Point Drawbridge at it.
export GITEA_BASE_URL=http://localhost:3000
export GITEA_TOKEN=<your-gitea-token>

# 3a. Node:
node ../src/node/dist/index.js --config drawbridge.gitea.yaml
# 3b. or .NET:
dotnet ../src/dotnet/src/Drawbridge.Cli/bin/Debug/net10.0/Drawbridge.Cli.dll --config drawbridge.gitea.yaml
```

Or wire it into Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "gitea": {
      "command": "npx",
      "args": ["-y", "drawbridge-mcp", "--config", "/abs/path/demo/drawbridge.gitea.yaml"],
      "env": { "GITEA_BASE_URL": "http://localhost:3000", "GITEA_TOKEN": "…" }
    }
  }
}
```

The agent then sees exactly `gitea_list_issues`, `gitea_get_issue`, `gitea_create_issue`
— nothing else on the Gitea API is reachable, and the token never enters the model.

## What's proven without Docker

`proofs/m4-private-network` loads this config (with a dummy token) and shows the three
allowlisted tools are generated and the config validates — so the wiring is correct
before you ever start a container. The live container run above requires Docker.

## Note on GitHub as an alternate target

GitHub's API requires a `User-Agent` header on every request. Drawbridge v1 injects
only the auth header (no arbitrary static headers), so a live GitHub target needs the
**static-headers** feature (v2 parking lot). Gitea has no such requirement, so it's the
v1 demo target.
