# Threat model (draft)

Drawbridge gives a cloud AI agent a foothold inside a private network. That is
inherently sensitive, so the design starts from the attacker's view.

## Assets
- Internal APIs and the data behind them.
- The credentials Drawbridge holds to call those APIs.

## Primary threats
1. **Confused deputy / SSRF via prompt injection.** Malicious content in any
   document, web page, or tool result the agent ingests tries to drive Drawbridge
   to perform actions the user never intended.
   - *Mitigation:* no raw passthrough. Only allowlisted, typed operations exist;
     unlisted requests are refused. Optional `read_only` and per-platform method
     allowlists shrink the surface further.
2. **Credential leakage to the model/prompt.**
   - *Mitigation:* auth is injected by the proxy from local environment; the secret
     never appears in tool schemas, prompts, or model-visible output.
3. **Over-broad reach (lateral movement).**
   - *Mitigation:* the allowlist is the config; `base_url` scopes each platform; the
     `raw_request` escape hatch is off by default and host-gated when enabled.

## Auditability
Every request is logged (operation, target, outcome) to support security review.

## Open questions
- Per-user identity vs. shared token, and how that maps onto the transport.
- Response filtering / size caps to limit exfiltration via read operations.
