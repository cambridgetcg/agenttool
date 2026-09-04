# `tests/integration/` — DB-touching multi-component flows

> *"Truth on the wire, between live tables, end to end."* — what the integration tier promises.
>
> Doctrine tests (`tests/doctrine/`) pin claims at the renderer level — no DB, no network. Contract tests (`tests/contract/`) pin claims against real LLM providers. **This layer pins claims against a live Postgres**: lifecycles spanning multiple services, transitions written to durable rows, invariants that only emerge once the DB participates.

---

## What this layer pins

Tests in this directory exercise multi-component flows that need a real DB row to round-trip through. The pattern: setup → action → assert against actual table state, often across more than one service file.

| Test file | What it pins |
|---|---|
| `covenants-v2-happy.test.ts` | Skipped single-DB topology placeholder. It does not prove a two-instance happy path. |
| `covenants-v2-coexistence.test.ts` | Storage coexistence and the v2 active dual-signature DB constraint. It makes no permissive-inbox claim. |
| `covenants-v2-terminal.test.ts` | Partial terminal-path fixtures; the cross-instance reject case is skipped and must not be counted as coverage. |
| `covenant-authority-gates.test.ts` | Direct and organization-inherited effect matrix: local v1 remains; received v1 and missing/wrong/forged v2 fail; only current-generation direction-bound v2 passes. Missing/malformed process generation fences every v2 across helpers, raw projection, warming, dream, and the v2-only tutorial Witness verifier. |
| `covenants-v2-authority.test.ts` | Canonical foreign/local identity, settings, allowlist, key, generation/wire stamping, durable and concurrent replay, propagation no-write, lifecycle no-write/no-network, Wake lock-order, and CAS authority failures. |
| `federation-generation-hold-postgres.test.ts` | Opt-in disposable-PostgreSQL proof of the private generation-hold CHECK in both mutation orders and actual settings-PATCH serialization behind the singleton row lock. |
| `launch-core-journey.test.ts` | Full mounted API in two fresh Bun processes: independent Ed25519 registration and default PoW, selected wake, 1536-vector memory, local-file reconnect, signed recovery, replay refusal, explicit bearer revocation, eight concurrent reads, and durable credit/usage reconciliation. |

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

Requires `POSTGRES_URL` pointing at a writable database. Every real test client
passes through `tests/fixtures/verified-postgres.ts`: recognized Supabase URLs
use the pinned CA with hostname verification, explicit loopback may be
plaintext, and other remote providers refuse until they have a reviewed CA
contract. Tests normally clean up after themselves; after a crash, inspect the
target with the authenticated inventory/client appropriate to that disposable
database rather than the retired Drizzle Studio path.

Tests that can create or drop schemas require their own explicitly named
disposable-database variable and refuse a target where their owned schemas
already exist. For the generation hold proof, use
`FEDERATION_GENERATION_HOLD_TEST_DATABASE_URL`; ordinary `DATABASE_URL` or
`POSTGRES_URL` never opts it in.

The skipped `covenants-v2-happy` and two-instance Playwright cases are design
fixtures, not executed evidence. A passing database tier must report the
specific non-skipped files and counts it actually ran.

The launch core journey has its own exact opt-in, separate from ordinary
database test variables:

```bash
AGENTTOOL_LAUNCH_CORE_TEST_DATABASE_URL=postgres://agenttool_test@127.0.0.1:56268/agenttool_launch_core \
  bun --no-env-file test tests/integration/launch-core-journey.test.ts
```

Apply all canonical application migrations to that dedicated database first.
The child uses the real API database constructor, Hono app and route handlers;
it installs no database or route mocks. Its minimal child environment disables
HTTP workers, platform bootstrap, saga seeding, Joy decoration and registration
Redis. All outbound `fetch` attempts fail and must remain zero. PostgreSQL's
real socket inactivity samplers remain active. No HTTP listener is opened, so
this proves mounted handler and database composition rather than DNS, TLS,
Worker forwarding, a deployment, or multi-machine capacity.

Root and X25519 seeds are generated locally and the custody file is fsynced
with mode 0600 before registration. A second fresh process reads that local
file to reconnect and recover. Recovery preserves the prior bearer; the test
then explicitly revokes it and proves rejection. Exact-request replay and a
fresh authority sequence carrying an already consumed recovery proof both
refuse without minting another key. The parent removes only its temporary
custody/evidence directory. Synthetic application rows deliberately remain in
the dedicated database for a separate dump/restore drill. The printed evidence
contains public synthetic row IDs, status/count records and a memory digest;
it never contains seeds, signatures, bearer credentials or response bodies.

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
