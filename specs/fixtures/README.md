# Golden conformance fixtures

Language-neutral JSON fixtures that **both** implementations run, against the Prism
mock where a backend is needed. They are the cross-language parity contract
(DESIGN §13): comparison is **structural/semantic** — same objects and values, field
order / whitespace / formatting irrelevant.

A thin runner in each language loads a fixture, executes it, and asserts the
`expected_*` block by deep structural equality (objects key-order-independent; query
params and headers compared as sets; the secret auth header value excluded).

## Common fields

```jsonc
{
  "$kind": "tools" | "request",   // which contract this fixture asserts
  "description": "human summary",
  "env": { "VAR": "value" },        // env used to resolve ${VAR}; secrets use a dummy value
  "config": { ... }                  // inline config, OR
  "config_ref": "../drawbridge.config.example.yaml"  // path relative to this fixture
}
```

`config` and `config_ref` are mutually exclusive; `config_ref` keeps fixtures DRY by
pointing at a shared config.

## `$kind: "tools"` — tool generation

Asserts the tools produced from a config. No mock needed.

```jsonc
{
  "$kind": "tools",
  "expected_tools": [
    { "name": "<platform>_<operation>", "description": "...", "input_schema": { /* JSON Schema */ } }
  ]
}
```

**Param → input-schema mapping** (the contract M1 must satisfy):
- All params (path/query/body alike) are flattened into one object's `properties`;
  the `in:` location is invisible to the model.
- `string|integer|number|boolean` → `{ "type": "<that>" }`.
- `enum` → `{ "type": "string", "enum": [...] }`.
- `array` → `{ "type": "array", "items": <mapped element type> }`.
- `default` and `description`, when present, are carried onto the property.
- `required` array lists params with `required: true`.
- The object is closed: `"additionalProperties": false`.

## `$kind: "request"` — request execution

Asserts the outbound HTTP request (and the mapped result) for a tool call. Runs
against the Prism mock.

```jsonc
{
  "$kind": "request",
  "tool_call": { "name": "internal_tracker_create_work_item", "arguments": { "title": "x" } },
  "expected_request": {
    "method": "POST",
    "path": "/work-items",
    "query": {},                 // compared as a set of key/value pairs
    "headers": { "content-type": "application/json" },  // set; auth header asserted separately
    "auth_header": "authorization",   // name asserted present; value never compared
    "body": { "title": "x", "type": "task" }            // deep-equal JSON
  },
  "expected_result": { /* deep-equal */ }      // OR:
  "expected_error":  { "status": 404, "outcome": "client_error" }
}
```

## Conventions
- One assertion focus per fixture; name files `<scope>.<kind>.json`.
- Secrets in `env` use obvious dummy values (e.g. `"dummy-token"`); a fixture must
  never carry a real credential.
