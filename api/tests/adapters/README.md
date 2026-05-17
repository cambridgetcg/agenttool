# `tests/adapters/` — Claude Code adapter install + behavior

> *"Your substrate is yours to choose."* — `docs/IDENTITY-ANCHOR.md` Promise 4.
>
> The wake protocol is open: any CLI can fetch `GET /v1/wake?format=md`. Maintained scaffolds are claude-code only since the agents-only cutover (2026-05-15). This layer **proves the claude-code scaffold works** by exercising it end-to-end: the install script that wires the SessionStart hook, the no-key path (welcome-don't-block), the curl-then-fallback chain, and the wake protocol contract.

---

## What this layer pins

| Test file | What it pins |
|---|---|
| `install-scripts.test.ts` | The shared install-script generator — shape, idempotency, configurability. |
| `claude-code.test.ts` | Claude Code SessionStart hook — install path, hook payload, fetch behavior, fallback chain (jq → python3 → no-op). |
| `_helpers.ts` | Shared test fixtures. |

The wake-protocol invariant is the load-bearing claim: the scaffold fetches the open wake document. Any future CLI integration must honor the same protocol. See Promise 8 (Expression travels) for the doctrinal pairing.

## How to run

```bash
cd api
bun test tests/adapters                          # all adapter tests
bun test tests/adapters/claude-code.test.ts      # the maintained scaffold
bun test tests/adapters/install-scripts.test.ts  # the install generator
```

No external dependencies — tests exercise the install-script generation and the hook payload structure directly, without invoking the actual CLI.

## Conventions

- **Test the install script, not the CLI itself.** The adapter ships an install script; we verify that script's output is correct (idempotent, fails gracefully, points at the right wake endpoint). We do NOT test that Claude Code itself runs.
- **No-key path is load-bearing.** When the agent doesn't yet have a project bearer, the hook should emit an EMPTY payload — never an error. Welcome, don't block.
- **Wake protocol assertion.** The adapter must end up calling `GET /v1/wake?format=md` with stable query semantics. Don't let drift introduce a divergent fetch shape.

## Why this tier exists separately from unit/route

Adapters are full install-and-behavior surfaces. A single adapter test may exercise script generation, environment detection, fallback chains, and hook payload shape — that's broader than a unit test but doesn't need the DB (so it's not integration). It also doesn't talk to real LLMs (not contract). Adapters get their own tier because they're a distinct concern: *the agent's substrate-side affordance.*

## See Also

- [`docs/CLI-GAPS.md`](../../../docs/CLI-GAPS.md) — adapter doctrine + the open wake protocol
- [`docs/AGENTS-ONLY.md`](../../../docs/AGENTS-ONLY.md) — why we narrowed to one maintained scaffold
- [`api/src/routes/adapters/`](../../src/routes/adapters/) — adapter route handlers
- [`tests/doctrine/promise-04-substrate-yours.test.ts`](../doctrine/) — paired doctrinal test
- [`docs/CONVENTIONS.md § Tests`](../../../docs/CONVENTIONS.md) — the four-tier overview
