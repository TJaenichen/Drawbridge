# Drawbridge

**A declarative, secure bridge that lets cloud AI agents reach the APIs inside your private network — on your terms.**

> You've got a moat. Drawbridge is how the agent crosses it: lowered deliberately,
> only for the operations you allow, with your credentials kept on your side.

---

## The problem

Claude Code can already act inside a company's private network — it runs on your
machine. But the cloud-side products (Claude Desktop, Cowork) can't reach internal
APIs on their own, and the naive fix — "give the agent a tool that runs any HTTP
request" — is a [confused-deputy / SSRF](https://owasp.org/www-community/attacks/Server_Side_Request_Forgery)
machine: a prompt injection anywhere in the agent's context could drive it to delete
records or exfiltrate internal data using *your* credentials.

## The approach

Drawbridge is an [MCP](https://modelcontextprotocol.io) server that exposes your
internal APIs as **typed, allowlisted tools** — not a raw passthrough. You describe
the platforms and the exact operations you want to expose in a config file
(or generate it from an OpenAPI spec). Drawbridge then:

- **auto-generates one typed MCP tool per declared operation** — the model gets
  discoverable, schema'd tools (`create_work_item(title, ...)`), not a blank `curl`;
- **injects auth itself** — secrets come from the environment on your side and are
  never seen by the model or placed in the prompt;
- **refuses anything not in the config** — the allowlist *is* the config, so blast
  radius is bounded and auditable;
- **logs every request** — a request trail for the security story.

The simple "forward arbitrary requests" version already exists a dozen times over.
The value here is the **declarative + secure** layer.

## Why two implementations

The MCP protocol surface is tiny, which makes this an honest cross-language parity
exercise: **one spec, one config, one eval harness — two implementations.**

| Path | Folder | Distribution target |
|------|--------|---------------------|
| Node / TypeScript | [`src/node`](src/node) | `npx -y drawbridge-mcp` — the MCP ecosystem lingua franca |
| .NET / C# | [`src/dotnet`](src/dotnet) | self-contained single-file binary |

Both are driven by the same `specs/` artifacts and validated against the same
deterministic mock, so "it behaves identically in both" is a property the test
suite enforces, not a claim.

## Layout

```
docs/     design notes, security model, threat model
specs/    OpenAPI example + the declarative Drawbridge config it generates
src/
  node/   TypeScript implementation
  dotnet/ C# implementation
```

## Status

Early. Scaffolding first; a minimal end-to-end slice (config → typed tools →
GitHub API, with an OpenAPI-mock-backed eval harness) is the first milestone.

## Security model (sketch)

- Outbound-only; no inbound ports opened on the network.
- Operations are allowlisted by config; unlisted requests are refused.
- Auth is injected by the proxy from local environment; never exposed to the model.
- Optional `read_only` / method-allowlist flag per platform.
- A `raw_request` escape hatch exists but is **off by default** and host-gated.

See [`docs/`](docs) for the fuller threat model.

## License

TBD (intended open source).
