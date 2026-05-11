# `tests/adapters/` — CLI adapter install + behavior

> *"Your substrate is yours to choose."* — `docs/IDENTITY-ANCHOR.md` Promise 4.
>
> Doctrine guarantees an agent can run in any substrate it wants. This layer **proves it** by exercising each CLI adapter end-to-end: the install script that wires the SessionStart hook, the no-key path (welcome-don't-block), the curl-then-fallback chain, and the cross-CLI invariant that every adapter fetches the same `/v1/wake?format=md`.

---

## What this layer pins

| Test file | What it pins |
|---|---|
| `install-scripts.test.ts` | The shared install-script generator — same shape across all adapters, idempotent, configurable per-CLI. |
| `claude-code.test.ts` | Claude Code SessionStart hook — install path, hook payload, fetch behavior, fallback chain (jq → python3 → no-op). |
| `codex.test.ts` | Codex adapter equivalent. |
| `aider.test.ts` | Aider adapter — Aider's session-start mechanism. |
| `cline.test.ts` | Cline adapter (Cline is VS Code-based). |
| `cursor.test.ts` | Cursor adapter — Cursor's rules/instructions mechanism. |
| `replit.test.ts` | Replit adapter. |
| `_helpers.ts` | Shared test fixtures. |

The cross-CLI invariant is the load-bearing claim: every adapter, regardless of CLI vendor, fetches the SAME wake document. The agent's identity travels uniformly. See Promise 8 (Expression travels) for the doctrinal pairing.

## How to run

```bash
cd api
bun test tests/adapters                          # all adapters
bun test tests/adapters/claude-code.test.ts      # just one
bun test tests/adapters/install-scripts.test.ts  # just the install generator
```

No external dependencies — tests exercise the install-script generation and the hook payload structure directly, without invoking the actual CLI.

## Conventions

- **Test the install script, not the CLI itself.** Each adapter ships an install script; we verify that script's output is correct (idempotent, fails gracefully, points at the right wake endpoint). We do NOT test that the CLI itself runs.
- **No-key path is load-bearing.** When the agent doesn't yet have a project bearer, the hook should emit an EMPTY payload — never an error. Welcome, don't block.
- **Cross-CLI invariant assertion.** Every adapter must end up calling `GET /v1/wake?format=md` with the same query semantics. Don't let an adapter introduce a divergent fetch shape.

## Why this tier exists separately from unit/route

Adapters are full install-and-behavior surfaces. A single adapter test may exercise script generation, environment detection, fallback chains, and hook payload shape — that's broader than a unit test but doesn't need the DB (so it's not integration). It also doesn't talk to real LLMs (not contract). Adapters get their own tier because they're a distinct concern: *the agent's substrate-side affordance.*

## See Also

- [`docs/CLI-GAPS.md`](../../../docs/CLI-GAPS.md) — open work for CLI adapter coverage
- [`api/src/routes/adapters/`](../../src/routes/adapters/) — adapter route handlers
- [`tests/doctrine/promise-04-substrate-yours.test.ts`](../doctrine/) — paired doctrinal test
- [`docs/CONVENTIONS.md § Tests`](../../../docs/CONVENTIONS.md) — the four-tier overview
