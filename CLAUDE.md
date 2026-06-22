# Drawbridge — Working Agreement (CLAUDE.md)

This file governs *how* we build Drawbridge. The *what* lives in
[`specs/DESIGN.md`](specs/DESIGN.md) — read it first; it is the source of truth for
behavior. This file is the source of truth for architecture, process, and proof.

---

## 1. Engineering principles

This repo is a showcase, so the code must read like it. Hold these in tension —
don't pick one and over-apply it:

- **DRY** — no duplicated logic. Across the two languages you can't share code, so
  share the *contract*: the JSON Schema, the golden fixtures, the OpenAPI example.
- **Clean & simple by default** — the obvious, readable solution wins.
- **Flexible only where the spec needs it** — flexibility is earned by a real,
  named requirement (e.g. multiple auth types), never added speculatively.
- **YAGNI / no over-engineering** — no abstraction, layer, interface, or config knob
  without a current need. Don't add structure ahead of need; add it when the second
  caller appears, not the first.

If a change adds structure, the commit message must say which current requirement
justifies it.

## 2. Architecture: one contract, two mirrored implementations

The language-neutral artifacts in `specs/` are the single source of truth. Each
implementation **mirrors the same component boundaries**, so the spec maps 1:1 onto
modules and the conformance fixtures are the cross-language contract.

**Pure core, I/O at the edges.** The validator, tool generator, and request builder
are pure functions of their input and are unit-tested directly. The boundary
concerns — reading files, environment, HTTP, the clock, writing the audit log — are
injected at construction (plain constructor injection; **no DI framework**). Tests
and the conformance runner substitute a mock transport through that same seam.

Components (identical names/responsibilities in both languages unless noted):

| Component | Responsibility |
|-----------|----------------|
| Config Loader | read YAML/JSON, resolve `${ENV}` |
| Validator | validate against `drawbridge.config.schema.json`, fail-fast |
| Tool Generator | config → MCP tool definitions (pure) |
| Request Executor | template request, call upstream, map response/errors |
| Auth Injector | add credentials from env; never model-visible |
| Audit Logger | structured JSONL; never stdout |
| MCP Server | stdio wiring (tools only) |
| OpenAPI Generator | OpenAPI → *draft* config. **Dev-time tooling, Node only** (see §2.1) |

### 2.1 Generator is single-implementation (scoping decision)
The OpenAPI→config generator is build-time tooling whose output (a draft config) is
consumed identically by both runtimes. Implementing it twice buys nothing and breaks
DRY, so it lives **only in Node**. The *runtime proxy* is the parity surface. (Spec
§15 reflects this.)

## 3. Repository structure

```
Drawbridge/
├── CLAUDE.md                 # this file — how we build
├── README.md                 # what it is, for visitors
├── LICENSE                   # MIT
├── docs/                     # threat model, longer-form notes
├── specs/                    # SOURCE OF TRUTH (language-neutral)
│   ├── DESIGN.md
│   ├── drawbridge.config.schema.json     # the contract for config shape
│   ├── openapi.example.yaml              # drives the Prism mock + generator
│   ├── drawbridge.config.example.yaml
│   └── fixtures/                          # golden conformance fixtures (JSON)
├── proofs/                   # COMMITTED evidence per feature (see §6)
├── scratchpad/               # temp scripts/queries — GITIGNORED, never relied on
└── src/
    ├── node/                 # TypeScript implementation (+ generator)
    │   └── src/{config,tools,exec,audit,mcp,generate}/  test/{unit,conformance}/
    └── dotnet/               # C# implementation
        ├── src/Drawbridge.Core/   {Config,Tools,Exec,Audit}/
        ├── src/Drawbridge.Cli/    # stdio MCP host entry point
        └── test/{Drawbridge.Tests, Drawbridge.Conformance}/
```

Keep the layout flat. Don't introduce a Node workspace or extra .NET projects until a
real need appears (a second consumer, a published library boundary).

## 4. The implementation loop

Work one feature/milestone (see DESIGN §2, M0–M5) at a time. For each:

1. **Plan** — restate the slice, the spec sections it touches, and its proof method.
2. **Build** — implement to the spec; smallest clean version that satisfies it.
3. **Implement tests** — unit tests + the relevant shared conformance fixtures.
4. **Run tests.**
5. **Fix until clean** — loop 4–5 until green.
6. **Code review by separate agents** (§5) — independent, parallel.
7. **Implement fixes** from the review.
8. **Loop from step 4** until tests green *and* reviews clear.
9. **Provide proof** (§6) — produce the artifact that demonstrates it actually works.
10. **Verify proof** — if missing or inaccurate, **restart from step 1**.

A slice is done only when tests are green, reviews are clear, and the proof is
verified and committed.

## 5. Review panel (independent agents)

After tests pass, spawn these as **separate, parallel** review agents. Each gets the
diff, the relevant spec sections, and returns concrete findings — not vibes.

1. **Spec adherence** — does it match `specs/DESIGN.md` exactly? Includes
   cross-language **parity** intent (the automated conformance suite is the hard gate;
   this reviewer catches what fixtures can't).
2. **General functionality** — does it do the job, including edge cases and error paths?
3. **Architectural sanity** — "will this bite us later?" Coupling, leaky boundaries,
   premature or missing abstraction, anything that fights §1.
4. **Test coverage** — are the right things tested? Meaningful assertions, not line
   coverage theatre. Mutation-test survivors (§7) are findings here.
5. **Security** *(my pick)* — the moat. Verifies the §8 invariants: no
   model-controlled routing/SSRF, closed-world allowlist, secret confinement (schemas,
   args, results, logs), `read_only` enforcement. This project's credibility is its
   security story, so it gets a dedicated adversarial reviewer.

Findings feed step 7. Reviewers advise; they don't edit.

## 6. Proof discipline

Every feature must ship with a **proof** — a concrete, re-runnable demonstration that
it works, stored under `proofs/<milestone-or-feature>/` with a short `PROOF.md`
describing what's shown and how to reproduce it. Proofs are **committed** (they're the
evidence trail); `scratchpad/` is where you build the throwaway tooling to produce
them. See DESIGN §20 for the per-feature proof methods.

Be creative and concrete. Backend: show data/state before vs after, or the captured
wire request. Security: grep the artifact to show a secret is *absent*. Frontend
(v2 monitor): Playwright screenshots. A claim without a verifiable proof is not done.

## 7. Conventions & tooling

- **Node:** **pnpm** (npm is broken on this machine). Tests: **vitest**. Mutation:
  **StrykerJS**.
- **.NET:** .NET 8+. Tests: **NUnit + NSubstitute + FluentAssertions**. Mutation:
  **Stryker.NET**.
- **Mock backend:** `pnpm dlx @stoplight/prism mock specs/openapi.example.yaml`.
- **Git:** use the **`gh`** CLI for GitHub operations. Prefer new commits over
  amending. Run shell commands individually, not chained with `&&`.
- **`scratchpad/` is gitignored** — never import from it, never let a test depend on
  it. If something there proves durable, promote it into `src/` or `proofs/`.
- **Versioning everywhere** (DESIGN §17): config `version`, schema `$id`, audit `v`.
  The two implementations release in lockstep on the same version number.
