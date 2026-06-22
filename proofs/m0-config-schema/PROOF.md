# Proof — M0: config schema, fixture format, example

**Claim.** The v1 config schema is a valid JSON Schema, the example config and every
committed fixture's config validate against it, the fixture files validate against the
fixture-format schema, and every intentionally-bad config (committed `config_invalid`
fixtures + inline cases, incl. the security tightenings) is rejected — at the expected
location.

## How to reproduce

```
cd proofs/m0-config-schema
corepack pnpm install     # ajv + js-yaml (npm is broken on this machine; use pnpm)
node validate.mjs
```

Exit code 0 = pass. The validator reads the real artifacts under `../../specs/`.

## What it checks (27 checks, all PASS — see validation-output.txt)

1. `drawbridge.config.schema.json` and `fixtures/fixture.schema.json` compile as
   Draft 2020-12 (they are themselves well-formed).
2. `drawbridge.config.example.yaml` validates against the config schema.
3. Every fixture under `specs/fixtures/` validates against `fixture.schema.json`.
4. Every `tools` / `config_valid` fixture's config (inline or `config_ref`) validates
   against the config schema.
5. Every `config_invalid` fixture is **rejected**, with an error at its declared
   `expected.pointer` — covering the security tightenings: inline userinfo in
   `base_url`, protocol-relative `//host` path, wrong-type auth field, typo'd property.
6. Eight inline bad configs are each rejected: unknown version, oauth auth, missing
   description, enum-without-list, enum-on-wrong-type, array-in-path, CRLF header name,
   `raw_request` without explicit `enabled`.

## Bugs this proof caught during M0 (the loop working)

- The `*_env` fields reused the lowercase-only `identifier` pattern, so the example's
  `secret_env: TRACKER_TOKEN` failed validation. Fixed with a dedicated `envVar`
  pattern. (Independently flagged as a blocker by all 5 review agents.)
- The tools fixture's `config_ref` was `../…` instead of `../../…`, so it pointed at a
  non-existent path. Fixed.

## Notes

`validate.mjs` is committed here so the proof is self-contained; the throwaway copy in
`scratchpad/m0-validate/` is gitignored. `node_modules/` is not committed (gitignored).
