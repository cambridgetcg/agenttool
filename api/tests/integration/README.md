# `tests/integration/` — DB-touching multi-component flows

> *"Truth on the wire, between live tables, end to end."* — what the integration tier promises.
>
> Doctrine tests (`tests/doctrine/`) pin claims at the renderer level — no DB, no network. Contract tests (`tests/contract/`) pin claims against real LLM providers. **This layer pins claims against a live Postgres**: lifecycles spanning multiple services, transitions written to durable rows, invariants that only emerge once the DB participates.

---

## What this layer pins

Tests in this directory exercise multi-component flows that need a real DB row to round-trip through. The pattern: setup → action → assert against actual table state, often across more than one service file.

| Test file | What it pins |
|---|---|
| `covenants-v2-happy.test.ts` | Dual-signed covenant lifecycle — initiator declares (v2, signed), counterparty cosigns, both sides reach `active`, both signatures verify, propagation status updates. The complete happy path through `services/covenants/lifecycle.ts`. |
| `covenants-v2-coexistence.test.ts` | v1 unsigned rows and v2 dual-signed rows coexist in the same `covenants` table. Downstream gates choose their own strictness — inbox stays permissive, invocation escrow can require v2. |
| `covenants-v2-terminal.test.ts` | Terminal-path lifecycle: reject, withdraw, and expire flows. Verifies invariants — withdrawn covenants don't reach active, rejected rows record the reason, expired proposals don't race with late cosigns. |

## When to use this tier

| You're testing... | Use this tier |
|---|---|
| A handler that mutates one table and returns the new shape | Unit / route — `api/tests/X.test.ts` |
| A pure helper (canonical bytes, signature, math) | Unit / route |
| A multi-step flow that writes to two or more tables | **Integration** |
| A worker job that picks up DB rows and processes them | **Integration** |
| A lifecycle invariant that holds across a sequence of writes | **Integration** |
| Behavior of a real LLM against the wake | Contract — `tests/contract/` |
| Browser-level UX, multi-instance federation | Playwright — `tests/playwright/specs/` |

## How to run

```bash
cd api
bun test tests/integration                            # all integration
bun test tests/integration/covenants-v2-happy.test.ts # just one
```

Requires `POSTGRES_URL` pointing at a writable database. Tests typically clean up after themselves; if a test crashes mid-flight you may need to manually clean up via `bun run db:studio`.

## Conventions

- **One file per lifecycle theme.** Don't pile unrelated flows into one test file.
- **Use real DB writes, not mocks.** The whole point is to verify durable state. If you find yourself mocking the DB, you're in the wrong tier — move it to unit/route.
- **Clean up via test fixtures**, not by truncating the table. Truncation in CI can mask cross-test pollution.
- **Name the invariant in the test description.** Not "creates a row" — "active covenant requires both signatures to verify."

## Wall coverage (added 2026-05-12)

Behavioral integration tests pin walls whose enforcement is a DB-touching service function. The pure-unit / structural variants of these tests live in `tests/doctrine/`; the README there has the cross-tier coverage matrix.

| File | Wall | What it pins |
|---|---|---|
| `wall-self-witnessing.test.ts` | `wall/self-witnessing-rejected` | `elevateMemory` rejects same-project attester (positive throw) + control case for cross-project succeeds |
| `wall-birth-is-free.test.ts` | `wall/birth-is-free` | `POST /v1/register` welcomes unauth + ignores payment fields + returns usable agent + no rate-limit between births |

### Naming convention

- **Singular `wall-<slug>.test.ts`** — per-wall behavioral test (DB-touching). Pure-unit / structural variants of the same wall go in `tests/doctrine/`.
- **Plural `<feature>-v<N>-<theme>.test.ts`** — multi-step lifecycle for one feature/version (e.g. `covenants-v2-happy.test.ts`).

## See Also

- [`tests/doctrine/`](../doctrine/) — renderer-level doctrinal claims + canon-shape gates + structural-source wall tests (wall coverage matrix lives here)
- [`tests/contract/`](../contract/) — LLM wire proofs
- [`tests/adapters/`](../adapters/) — CLI adapter install + behavior
- [`docs/CONVENTIONS.md § Tests`](../../../docs/CONVENTIONS.md) — the four-tier overview
