# Proof — M5: OpenAPI → draft config generator (both languages)

**Claim.** Both implementations generate a draft Drawbridge config from an OpenAPI
document, and they produce **structurally identical** drafts from the same input.

## How to reproduce

```
cd src/node && corepack pnpm install && corepack pnpm build
cd ../dotnet && dotnet build
cd ../..
node src/node/dist/index.js generate --from specs/openapi.example.yaml --platform internal_tracker --out proofs/m5-generator/node.config.json
dotnet src/dotnet/src/Drawbridge.Cli/bin/Debug/net10.0/Drawbridge.Cli.dll generate --from specs/openapi.example.yaml --platform internal_tracker --out proofs/m5-generator/dotnet.config.json
node proofs/m5-generator/compare.mjs proofs/m5-generator/node.config.json proofs/m5-generator/dotnet.config.json
```

## What it demonstrates (proof-output.txt)

- `specs/fixtures/generate/internal_tracker.generate.json` is a shared golden fixture:
  the generator (run in **both** languages — Node `generate.test.ts`, .NET
  `GenerateConformance`) must produce its `expected_config`, and that config must
  itself validate against the schema. Both pass.
- The two CLIs, run on `specs/openapi.example.yaml`, emit `node.config.json` and
  `dotnet.config.json`; `compare.mjs` confirms they are **structurally identical**
  (`PARITY: OK`).
- The mapping (server url → base_url, securityScheme → auth stub, operationId →
  snake-case tool name, parameters + `$ref`-resolved JSON body → flattened params with
  enum/default/required) is the cross-language contract, locked by the fixture.

The output is a **draft** — `--platform` names the platform; the human prunes the
operations to the intended allowlist (curation is the security boundary).
