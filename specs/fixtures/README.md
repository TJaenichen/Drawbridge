# Golden conformance fixtures

Language-neutral JSON fixtures that **both** implementations run, against the Prism
mock where a backend is needed. They are the cross-language parity contract
(DESIGN §13): comparison is **structural/semantic** — same objects and values, field
order / whitespace / formatting irrelevant.

A thin runner in each language loads a fixture, validates it against
[`fixture.schema.json`](fixture.schema.json), executes it, and asserts the
`expected_*` block by deep structural equality (objects key-order-independent; query
params and headers compared as sets; the secret auth header value excluded).

Layout by kind: `fixtures/tools/`, `fixtures/requests/`, `fixtures/validation/`.
File names: `<scope>.<kind>.json`.

## Common fields

```jsonc
{
  "$kind": "tools" | "request" | "config_valid" | "config_invalid",   // which contract this fixture asserts
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

## `$kind: "config_valid"` / `"config_invalid"` — schema behavior

Assert that a config is accepted / rejected by `drawbridge.config.schema.json`. With
only positive fixtures, a validator that accepts everything would pass — so the
schema's *rejection* behavior must be asserted too.

```jsonc
// config_invalid: config is inline (intentionally malformed)
{ "$kind": "config_invalid", "description": "...",
  "config": { "version": 1, "platforms": { "p": { "base_urls": "http://x" } } },
  "expected": { "pointer": "/platforms/p", "message_contains": "additional properties" } }

// config_valid: config or config_ref must validate
{ "$kind": "config_valid", "description": "header auth", "config": { /* ... */ } }
```

## Invariants the schema CANNOT express — validator-enforced (M1)

JSON Schema can't cross-reference, so these are the validator's job (DESIGN §5/§6/§8)
and each gets a fixture so M1 must enforce them:
- **Tool-name uniqueness:** the computed `{platform}_{operation}` must be globally
  unique; a collision is fatal. (Note the join is ambiguous — `a`+`b_c` vs `a_b`+`c`
  both yield `a_b_c`; the validator rejects the resulting duplicate.)
- **Path ↔ param coverage:** every `{placeholder}` in `path` has exactly one matching
  `in:path` param, every `in:path` param appears in the template, and `in:path`
  params are implicitly required. No `..` traversal segments.
- **Value agreement:** an `enum` param's `default` must be one of its members; a
  `default` must match the param's declared type.

## Serialization rules (pin parity hazards)
- **Array in query:** repeated-key, e.g. `?label=a&label=b` (not comma-joined).
- Array params are restricted to `in: query | body` (no array-in-path).

## M1 fixture backlog (deferred, not dropped)
Authored here as targets; these need the M1 executor/mock to run:
`request` fixtures for **type:header** and **type:basic** auth (assert header name,
value excluded); **error mapping** (500→server_error, undeclared tool→refused,
timeout); **response cap** truncation + `"truncated": true`; **${ENV} unset → fatal**.

## Conventions
- One assertion focus per fixture; name files `<scope>.<kind>.json`.
- Secrets in `env` use obvious dummy values (e.g. `"dummy-token"`); a fixture must
  never carry a real credential.
