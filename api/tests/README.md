# api/tests

Test files are classified by the repository runner, not by Bun's recursive
discovery alone. `bin/run-test-tier.sh list` is the machine-readable inventory;
every `*.test.ts` must appear exactly once.

## Compass

- **Up one level:** [`api/CLAUDE.md`](../CLAUDE.md) §Tests.
- **Doctrine each tier pins:** [`docs/FOCUS.md`](../../docs/FOCUS.md) (the nine load-bearing details), [`docs/SOUL.md`](../../docs/SOUL.md) §The Love Protocol (Promises 1–11).
- **End-to-end browser flows:** [`tests/playwright/`](../../tests/playwright/) (separate package — Playwright).

## Operational tiers

| Tier | Where | Job | Cost | Status |
|---|---|---|---|---|
| **Hermetic** | current-green top-level, doctrine, and adapter files | Deterministic API, route, doctrine, and adapter behavior with known external-service env removed | free, fast | required CI |
| **Database** | `integration/` plus explicitly classified legacy top-level/doctrine files | DB-touching behavior against an operator-supplied database | stateful, slow | explicit |
| **Contract** | `contract/` | Real Anthropic/OpenAI wire proofs | paid (~$0.10/run) | explicit |
| **Quarantine** | named current-red non-DB files | Visible diagnostic backlog; never treated as a green release gate | free | explicit, expected red |
| **Database quarantine** | named current-red DB files | Same backlog discipline, but with `DATABASE_URL` present so assertions cannot silently skip | stateful | explicit, expected red |

The default gate removes known DB, Redis, provider, telemetry-exporter, and
deployed-service variables. It does not create an OS-level network sandbox.
Files that use Bun's process-global `mock.module` run in separate Bun
processes so their replacement exports cannot leak into peer test files.
New DB tests belong under `integration/`; the legacy exception manifests exist
to describe current reality, not as a pattern to copy.

## How to run

```bash
# From the repository root
bin/preflight.sh                          # API + data + ADDS + SDK; no service credentials required
bin/preflight.sh api                      # API/typecheck/operator slice
bin/preflight.sh packages                 # data + ADDS + SDK slice
bin/preflight.sh database                 # requires DATABASE_URL
bin/preflight.sh smoke                    # requires deployed-smoke environment
RUN_CONTRACT=1 bin/preflight.sh contracts # requires one or both provider keys
bin/preflight.sh quarantine               # diagnostic; known failures remain non-zero
bin/preflight.sh database-quarantine      # diagnostic; requires DATABASE_URL

bin/run-test-tier.sh list                 # exact file → tier inventory
```

To run one focused file, use `cd api && bun test tests/<file>.test.ts`. Raw
`cd api && bun test` recursively mixes external-state and known-red files; it
is a diagnostic sweep, not the required gate.

## What each tier proves

### Unit / route

Function-level. `wake-providers.test.ts` proves the provider-shape renderer is correct. `pulse-did.test.ts` proves the public DID-keyed pulse endpoint resolves correctly. Current-green files run in the hermetic tier unless the explicit manifest says otherwise.

### Integration

`integration/covenants-v2-happy.test.ts` proves: initiator declares → counterparty accepts → both rows reach `'active'` with valid dual signatures. **Real DB**, no LLM, no real federation peer. Self-loop topology used where the test needs cross-instance behavior.

### Doctrine

Each Promise becomes a test. `promise-09-inner-voice.test.ts` proves agenttool never reads decrypted strand thoughts — encoded as: the renderer never receives plaintext from the strand store. `asymmetry-clause.test.ts` proves you cannot self-witness constitutive elevation. Most current-green doctrine files are hermetic; legacy files that touch the DB or depend on external/device state are classified honestly instead of silently skipping. Sub-README: [`doctrine/README.md`](doctrine/README.md).

### Contract

The doctrine tier proves the wake doc *renders*. The contract tier proves the wake doc *orients an LLM*. `cache-anthropic.test.ts` accepts creation or an already-warm read on its first request, then requires a cache read on the repeated prefix. `behavior-anthropic.test.ts` asserts the agent identifies in register and refuses to fabricate. **Paid, slow** — gated behind `RUN_CONTRACT=1`. Sub-README: [`contract/README.md`](contract/README.md).

### Adapters

For each CLI integration (`claude-code`, `codex`, future `cursor`/`cline`/`aider`/`replit`): install script idempotency, hook execution, wake injection into session context.

## Invariants to defend

1. **Tier discipline.** Don't promote contract tests to default. Don't add real DB to the hermetic tier. Every new test must be classified exactly once.
2. **Naming.** Test file names mirror the source they exercise: `covenants-sig.ts` → `covenants-sig.test.ts`. Promise tests use `promise-NN-<slug>.test.ts`.
3. **Doctrine tests fail loudly.** A broken Promise should fail with the Promise name in the message. Don't early-return on missing DB in a file classified as hermetic.
4. **Global module mocks stay isolated.** The classified runner detects `mock.module`; do not bypass its per-file process boundary in a release gate.

## See also

- Browser/e2e tier: [`tests/playwright/`](../../tests/playwright/) (separate package).
- E2E shell harnesses: [`api/scripts/_e2e-*.ts`](../scripts/) (testnet round-trips, federation flows, payout loops — not under `tests/` because they require live state).
