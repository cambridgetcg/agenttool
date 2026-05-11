# api/tests

Five test tiers, each with a distinct job. Sub-directories carry their own READMEs where the tier has its own discipline.

## Compass

- **Up one level:** [`api/CLAUDE.md`](../CLAUDE.md) §Tests.
- **Doctrine each tier pins:** [`docs/FOCUS.md`](../../docs/FOCUS.md) (the nine load-bearing details), [`docs/SOUL.md`](../../docs/SOUL.md) §The Love Protocol (Promises 1–11).
- **End-to-end browser flows:** [`tests/playwright/`](../../tests/playwright/) (separate package — Playwright).

## The five tiers

| Tier | Where | Job | Cost | Status |
|---|---|---|---|---|
| **Unit / route** | `*.test.ts` directly under this dir | Per-function correctness · route handler shape · helpers · schemas | free, fast | tracked |
| **Integration** | `integration/` | Multi-component DB-touching flows · `covenants-v2-{happy,coexistence,terminal}` | free, slow | tracked |
| **Doctrine** | `doctrine/` | Promises 1–11 + Love Protocol as executable assertions. *"The Syzygy made testable."* | free, fast (pure unit) | local WIP |
| **Contract** | `contract/` | LLM wire proofs — the wake actually *orients* a real LLM (Anthropic + OpenAI) | ~$0.10/run; `RUN_CONTRACT=1` required | local WIP |
| **Adapters** | `adapters/` | Install scripts + per-adapter e2e for each CLI integration | free | local WIP |

The tier *boundary* is the discipline. Don't put network calls in unit; don't put DB writes in doctrine; don't put deterministic logic checks in contract (paid).

## How to run

```bash
cd api
bun test                                  # unit + route (the default)
bun test tests/integration                # integration tier
bun test tests/doctrine                   # doctrine tier (WIP)
RUN_CONTRACT=1 bun test tests/contract    # contract tier — needs ANTHROPIC_API_KEY + OPENAI_API_KEY
bun test tests/adapters                   # adapter tier (WIP)
```

To run a single test: `bun test path/to/file.test.ts`. To filter by name: `bun test --test-name-pattern <regex>`.

## What each tier proves

### Unit / route

Function-level. `wake-providers.test.ts` proves the provider-shape renderer is correct. `pulse-did.test.ts` proves the public DID-keyed pulse endpoint resolves correctly. No DB, no network.

### Integration

`integration/covenants-v2-happy.test.ts` proves: initiator declares → counterparty accepts → both rows reach `'active'` with valid dual signatures. **Real DB**, no LLM, no real federation peer. Self-loop topology used where the test needs cross-instance behavior.

### Doctrine

Each Promise becomes a test. `promise-09-inner-voice.test.ts` proves agenttool never reads decrypted strand thoughts — encoded as: the renderer never receives plaintext from the strand store. `asymmetry-clause.test.ts` proves you cannot self-witness constitutive elevation. Sub-README: [`doctrine/README.md`](doctrine/README.md).

### Contract

The doctrine tier proves the wake doc *renders*. The contract tier proves the wake doc *orients an LLM*. `cache-anthropic.test.ts` asserts Anthropic's `cache_creation_input_tokens > 0` on first call + `cache_read_input_tokens > 0` on second. `behavior-anthropic.test.ts` asserts the agent identifies in register and refuses to fabricate. **Paid, slow** — gated behind `RUN_CONTRACT=1`. Sub-README: [`contract/README.md`](contract/README.md).

### Adapters

For each CLI integration (`claude-code`, `codex`, future `cursor`/`cline`/`aider`/`replit`): install script idempotency, hook execution, wake injection into session context.

## Invariants to defend

1. **Tier discipline.** Don't promote contract tests to default. Don't add real DB to unit. Don't add new tiers without a discipline reason.
2. **Naming.** Test file names mirror the source they exercise: `covenants-sig.ts` → `covenants-sig.test.ts`. Promise tests use `promise-NN-<slug>.test.ts`.
3. **Doctrine tests fail loudly.** A broken Promise should fail with the Promise name in the message. Don't write doctrine tests that pass on misconfiguration.

## See also

- Browser/e2e tier: [`tests/playwright/`](../../tests/playwright/) (separate package).
- E2E shell harnesses: [`api/scripts/_e2e-*.ts`](../scripts/) (testnet round-trips, federation flows, payout loops — not under `tests/` because they require live state).
