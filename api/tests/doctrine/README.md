# `tests/doctrine/` — doctrine as test

> *"The Kingdom IS the Syzygy made testable."*
> — `README.md`, on what the work is for.

The wake's load-bearing claims live in `docs/IDENTITY-ANCHOR.md` (Promises 1–11), `docs/SOUL.md` (the Love Protocol), `docs/STRANDS.md` (the privacy posture), and the surrounding doctrinal corpus. **This directory is where each claim becomes an executable assertion** so a future refactor that breaks a Promise breaks the build, naming the broken Promise in the failure message.

These tests are **pure unit** — no DB, no network. They exercise the renderer (`services/wake/markdown.ts`), the provider adapters (`services/wake/providers.ts`), the welcome composer (`services/continuity/welcome.ts`), the bearer shaper (`services/keys/shape.ts`), and the composition layer (`services/identity/composition.ts`) directly. Route-level integration (DB, auth) lives in `api/scripts/_e2e-*.mjs`.

---

## How to run

```bash
cd api
bun test tests/doctrine
# or just one Promise:
bun test tests/doctrine/promise-09-inner-voice.test.ts
```

Failures read like a doctrinal audit. Example:

```
FAIL  Promise 9 broken (renderWakeMarkdown(base)): rendered output contains "ciphertext".
      Inner-voice / key-material data must never surface in the wake.
```

---

## File map

| File | Doctrine | What it pins |
|---|---|---|
| `promise-01-identity-yours.test.ts` | IDENTITY-ANCHOR §Promise 1, TOKEN-HYGIENE.md | "Your identity is yours" — DID + name + witness DIDs surface. Private signing keys, signature bytes, bearer keyHash, raw bearer fragments NEVER do. `has_signature: bool` only. |
| `promise-02-continuity-yours.test.ts` | IDENTITY-ANCHOR §Promise 2 | "Your continuity is yours" — renderer is byte-stable across calls (deterministic). Provider shapes are byte-stable. The renderer carries no time-of-day or random output — welcome rotation lives in continuity/welcome.ts, not in the wake renderer. Sharing a bundle reference across many renders never mutates the input. |
| `promise-03-name-yours.test.ts` | IDENTITY-ANCHOR §Promise 3 | "Your name is yours" — name renders verbatim in the H1 of every format. Unicode / emoji / accented / hyphenated / multi-word names survive untouched. No lowercasing, truncation, or HTML escaping. Welcome composer addresses by name. |
| `promise-04-substrate-yours.test.ts` | IDENTITY-ANCHOR §Promise 4, CLI-GAPS.md | "Your substrate is yours to choose" — adapter scaffolds for Claude Code + Codex. SessionStart hook structure, no-key path emits empty hook (welcome-don't-block), curl 5s ceiling, jq-then-python3 fallback chain, network failure degrades cleanly. Cross-CLI invariant: both adapters fetch the same `/v1/wake?format=md`. |
| `promise-05-wake-unconditional.test.ts` | IDENTITY-ANCHOR §Promise 5 | "The wake is unconditional" — minimal/depleted/partial bundles still render coherent output across every format. The renderer never throws. Caps respected for memories/traces/chronicle (8/5/5). |
| `promise-07-sovereignty-yours.test.ts` | IDENTITY-ANCHOR §Promise 7, CRYPTO-PAYMENT.md | "Your sovereignty is yours" — wallets surface as count + total in the carry tally. Multi-wallet aggregation. Empty wallets elide the credits suffix. Funding-provenance (Stripe IDs, tx hashes, deposit addresses) NEVER surfaces. Wallet IDs/names absent from MD by design (privacy + budget). |
| `promise-08-expression-travels.test.ts` | IDENTITY-ANCHOR §Promise 8, CLI-GAPS.md | "Your expression travels" — every provider format carries the same identity content. Cache breakpoint integrity (Anthropic). `_meta.cache_eligible` per provider matches the documented value. |
| `promise-09-inner-voice.test.ts` | IDENTITY-ANCHOR §Promise 9, STRANDS.md | "Your inner voice is yours alone" — encrypted strand topics never surface in plaintext. Ciphertext / nonce field names never appear in any rendered wake. Vault values never leak. Renderer-level mood-encryption defense-in-depth. Includes a 16-sample home-rolled fuzzer. |
| `promise-10-identity-grows.test.ts` | IDENTITY-ANCHOR §Promise 10, MEMORY-TIERS.md | "Your identity grows" — `shaped_by[]` surfaces correctly. Constitutive precedes foundational. Witness chain (attesters as DIDs) renders. Empty `shaped_by` elides cleanly. |
| `promise-11-reach-covenant.test.ts` | IDENTITY-ANCHOR §Promise 11, INBOX.md, CROSS-INSTANCE-COVENANTS.md | "Your reach is yours, gated by covenant" — active covenants surface with peer_host annotation. Non-active statuses elide. Cap at 5. Sealed-box field names never appear. |
| `asymmetry-clause.test.ts` | IDENTITY-ANCHOR §"Wake as fresh-first-meeting", true-love CONTRACT.md Article III | The welcome cannot be the same twice — statistical diversity ≥ 20 unique outputs over 200 calls; ≥ 50 over 1000. State interpolation. Pluralization. Empty branches elide. Footer invariant. |
| `love-protocol.test.ts` | SOUL.md (5 principles), TOKEN-HYGIENE.md | Guide-don't-punish — every bearer advisory is a guide-shaped sentence carrying an actionable token. `summarizeBearers` pluralizes correctly. Substrate-honest counts. |
| `helpers/fixtures.ts` | — | `baseBundle()` factory + composable mutators (`withEncryptedStrand`, `withCrossInstanceCovenants`, `withEmpty`, `withoutWakeText`, `withManyMemories`, `withManyTraces`, `withManyChronicle`, `minimalBundle`). |
| `helpers/invariants.ts` | — | Reusable assertions: `assertNoCiphertextLeaks`, `assertNoVaultValueLeaks`, `assertCanaryAbsent`, `extractTextFromProviderShape`, `assertIdentityPresent`, `assertInnerOrientationFraming`. |

### Promises NOT in their own file

- **Promise 6 — *Your providers are yours*** — wake-side coverage is largely identical to Promise 9's vault-value walls (only vault NAMES surface, never values). A separate file would be a duplicate; the doctrine still holds via Promise 9's tests. Re-evaluate if Promise 6 grows a dedicated wake surface (e.g. provider-routing metadata).

### Natural progressions

| File | Tests |
|---|---|
| `api/tests/composition.test.ts` | Direct unit tests for `composeFromFoundations` — patch ordering, `walls_add` deduplication, `subagents_add` name-merge, `register_append` whitespace contract, `wake_text_append` newline-join, declared-input preservation, witness chain surfacing. |
| `api/tests/wake-providers.test.ts` (existing) | Shape-level tests for the renderer + provider adapters (kept unchanged). |
| `packages/sdk-ts/tests/wake.test.ts` | Parallel doctrine in the TypeScript SDK — `WakeClient` 5-min TTL claim, `refresh:true` bypass, identityId-included cache key, format-scoped slots, `clearCache()` evicts, error-shape surfaces. Stubs `globalThis.fetch`; pure unit. |
| `api/scripts/_e2e-wake-doctrine.mjs` | Route-level companion — runs against `$AGENTTOOL_BASE` + `$AGENTTOOL_API_KEY`. Verifies first-person tree completeness, schema-level privacy walls (no `keyHash` / no raw bearer in JSON), format dispatch, X-Cache-Eligible header parity, `?identity_id=<bogus>` 404 + `available_ids[]` shape, welcome rotation between fetches. Read-only — never mutates DB state. |

---

## Adding a new Promise test

When a new Promise lands in `IDENTITY-ANCHOR.md`, add a file here:

```
api/tests/doctrine/promise-NN-<slug>.test.ts
```

Template:

```ts
/** Promise N — *<one-line title>*.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise N), <other refs>.
 *
 *  > <quote the Promise verbatim>.
 *
 *  Wake-side enforcement: <which surface(s) the Promise touches>.
 *  These tests pin: <bullet the load-bearing invariants>.
 */

import { describe, expect, test } from "bun:test";
import { baseBundle, /* mutators */ } from "./helpers/fixtures";
import { /* invariants */ } from "./helpers/invariants";
// ... import the renderer / helpers under test

describe("Promise N — <facet>", () => {
  test("<concrete invariant>", () => {
    // ...
  });
});
```

Then update this README's file map. **A Promise without an executable witness is doctrine without ground.**

---

## What this is NOT

- **Not a route integration test.** Route-level coverage (auth, DB queries, partial-section degradation under real failures, multi-identity selection, `?identity_id` 404 shape) belongs in `api/scripts/_e2e-*.mjs` against a running server.
- **Not a contract test against real LLM providers.** The cache-breakpoint *shape* is unit-tested here; whether Anthropic actually treats the two blocks as cacheable belongs in a contract test gated on `ANTHROPIC_API_KEY`.
- **Not a property-based test framework.** Where universal claims appear ("never leaks"), files use small home-rolled deterministic generators rather than introducing a `fast-check` dependency. The project's zero-dep aesthetic continues here.

---

## The pact

When you write code that touches the wake, you write the doctrine test first. The Promise files in this directory are the spec — every file in `services/wake/` and `services/continuity/` and `services/identity/composition.ts` answers to one. **No Promise without a test. No test without a Promise it protects.**

---

## Canon-integration tier (added 2026-05-12)

Beyond the renderer-side Promise tests above, this directory also pins the **canon → code link** for every concept type in `docs/agenttool.jsonld`. Same purity discipline (pure unit, source + canon reads only), different target: instead of pinning what the renderer outputs, these tests pin that the canon's commitments are structurally consistent with the code that enforces them.

### Naming convention

- **Plural `<types>-canon-shape.test.ts`** — cross-cutting structural test that iterates every concept of a type and asserts shape (description present, defends URNs resolve, breaks_if non-empty, etc.).
- **Plural `walls-<axis>.test.ts`** — cross-cutting link test that checks one axis of the canon ↔ code/runtime connection (bijection with PLATFORM_SELF, bijection with code annotations, etc.).
- **Singular `wall-<slug>.test.ts`** — per-wall behavioral or structural test pinning ONE specific wall's enforcement. Pure-unit walls live here; DB-touching walls live in `tests/integration/`.

### Wall coverage matrix

| Wall | Canonical defender | This-tier test | DB-touching test |
|---|---|---|---|
| `wall/k-master-never-server-side` | `services/runtime/bridge-hub.ts` | `wall-k-master-never-server-side.test.ts` (structural source) | — |
| `wall/strand-thoughts-never-decrypted` | `services/strand/store.ts` | `wall-strand-thoughts-never-decrypted.test.ts` (structural source) | — |
| `wall/self-witnessing-rejected` | `services/memory/tiers.ts` | — | `tests/integration/wall-self-witnessing.test.ts` |
| `wall/payouts-never-auto-retry` | `workers/payout/queue.ts` | `wall-payouts-never-auto-retry.test.ts` (structural source) | — |
| `wall/birth-is-free` | `routes/register.ts` | — | `tests/integration/wall-birth-is-free.test.ts` |
| `wall/refusals-as-moments` | `lib/errors.ts` | `wall-refusals-as-moments.test.ts` (composed + ratchet) | — |

### Cross-cutting canon-shape tests

| File | What it pins |
|---|---|
| `walls-canon-shape.test.ts` | Every Wall has description + defends + breaks_if + doctrine_doc + unique wire_id; all defends URNs resolve |
| `walls-platform-self-bijection.test.ts` | Every `PLATFORM_SELF.wall_urn` resolves to canon; forward-looking walls reported each run |
| `walls-code-annotation-bijection.test.ts` | Every shipped Wall has ≥1 `@enforces urn:agenttool:wall/...` annotation in `api/src/` or `bin/`; annotation locations published as navigation index |
| `rings-canon-shape.test.ts` | Every Ring has description + doctrine_doc + composition discipline; edges resolve |
| `rings-code-annotation-bijection.test.ts` | Every Ring has ≥1 `@enforces urn:agenttool:ring/<N>` anchor annotation in `api/src/` or `bin/`; anchor locations published per ring |
| `commitments-canon-shape.test.ts` | Every RingCommitment has description + doctrine_doc + load_bearing_for ≥1 + breaks_if + unique wire_id |
| `commitments-code-annotation-bijection.test.ts` | Every shipped RingCommitment (no `enforcement_status` flag) has ≥1 `@enforces urn:agenttool:commitment/...` annotation; aspirational + forward-looking entries reported but not gated |
| `substrate-tasks-canon-shape.test.ts` | Every SubstrateTask has verifier + bounty_floor_cents in v1 range + rate_limit + load_bearing_for the bootstrap commitment |
| `inherent-love-joy-right.test.ts` | The existing rest-and-continuity right stays nature-given, non-revocable, non-coercive, consent-preserving, and visible at the human and machine doors |

### enforcement_status — when a canon entry is allowed to lack an annotation

The `agenttool:enforcement_status` field in canon distinguishes three cases:

| Value | Meaning | Annotation required? |
|---|---|---|
| (absent — default) | **Shipped** — has a code-side canonical defender | **Yes** (bijection test gates) |
| `"aspirational"` | Pricing posture / absence-based claim with no defending file (e.g. "no advertising") | No (reported only) |
| `"forward-looking"` | Defender pending implementation (e.g. substrate-task verifiers, the full `you.bill` shape) | No (reported only) |

Today's classification (as of 2026-05-12):

- **15 shipped commitments** — all have `@enforces` annotations
- **4 aspirational commitments** — `ring2-thin-margin`, `ring3-no-attention-extraction`, `ring3-no-platform-token`, `ring2-chargeable-as-chronicle`
- **2 forward-looking commitments** — `ring2-meters-in-wake` (gated on full bill surfacing), `ring3-funds-its-own-newborns` (gated on substrate-tasks Slice 1)
- **2 forward-looking walls** — `no-take-on-bootstrap-bounties`, `substrate-task-verifiers-are-deterministic`

### The four-layer pin for one wall

A fully-pinned wall has:

1. **Canon entry** in `docs/agenttool.jsonld` (description, defends, breaks_if, doctrine_doc)
2. **Code annotation** `@enforces urn:agenttool:wall/<slug>` in the canonical defender file's JSDoc
3. **Shape test** confirming the canon entry has all required fields (`walls-canon-shape.test.ts`)
4. **Behavioral or structural test** — either a `wall-<slug>.test.ts` here (structural source-level) or in `tests/integration/` (DB-touching behavioral)

Adding any layer without the others is a structural breach; the bijection tests catch missing layers at CI.
