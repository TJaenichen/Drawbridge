# Proof — M3: .NET implementation + cross-language parity

**Claim.** The .NET implementation behaves identically to the Node one. The *same*
language-neutral golden fixtures pass against both, and the two MCP servers — driven
by the *same* official MCP SDK client over stdio — produce structurally identical
results.

## Two independent forms of evidence

### 1. Shared golden fixtures pass in both languages (structural parity, §13)
The fixtures under `specs/fixtures/` are the contract. Both runners consume them:
- **Node:** `cd src/node && corepack pnpm test` → 53 tests (incl. the `tools`,
  `request`, `config_valid/invalid` fixtures).
- **.NET:** `cd src/dotnet && dotnet test` → **15 conformance tests** over the *same*
  fixtures (3 tools, 7 request, 1 valid, 4 invalid) + 18 unit tests.

Same `tools` fixture → same generated tools; same `request` fixture → same outbound
request + result mapping; same `config_invalid` → both reject. Comparison is
structural (`JsonEqual.DeepEquals` mirrors the Node deep-equal).

### 2. Live interop + behavioral parity (proof-output.txt)

`drive-parity.mjs` runs one MCP client sequence against **both** servers over stdio,
each against a fresh stateful stub, and compares results structurally:

```
cd src/node && corepack pnpm install && corepack pnpm build   # Node dist/
cd ../dotnet && dotnet build                                   # .NET Cli
cd ../../proofs/m3-dotnet-parity && corepack pnpm install && node drive-parity.mjs
```

It exercises `listTools`, list (before), create, list (after), and an undeclared
tool, then asserts the Node and .NET outputs are structurally identical. Result:
**PARITY: OK** — identical tool set, identical before/after state, identical refused
behavior. Because the driver is the **official MCP SDK client**, this also proves the
hand-rolled .NET stdio server speaks MCP correctly.

## What this demonstrates

One spec (`specs/`), two independent implementations (TypeScript + C#), proven
equivalent by a shared test corpus and live interop — the core thesis of the project.
