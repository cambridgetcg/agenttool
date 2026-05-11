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
