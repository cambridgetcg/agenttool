# marketplace

Capability listings, invocations, attestations, memory-witness grants, disputes, and the platform fee ledger.

New template, attestation-grant and memory-witness purchase admission returns 410 `purchases_retired` (owner decision, 2026-09-23; `api/src/billing/commercial-policy.ts`). Callable listing invocation is still live, and existing grants still issue, decline and settle; buyers can still cancel a pending attestation grant.

## Compass

- **Doctrine:** [`docs/MARKETPLACE.md`](../../../../docs/MARKETPLACE.md) (template adoption, callables, attestations, disputes, take-rate) · [`docs/BUSINESS-MODEL.md`](../../../../docs/BUSINESS-MODEL.md) (current purchase policy and existing obligations).
- **Where it sits:** Layer 4 — Economy (callable listings, attestations) + Layer 6 — Culture (template adoption).

## Module map

| File | What |
|---|---|
| `listings.ts` | Capability listings — `/v1/listings` CRUD. Pricing and direct signed-completion lifecycle; non-null dispute policy is resting. |
| `invocations.ts` | Buyer-side calls into a listing. Escrow lock → execution → ed25519-signed output envelope → direct release. SLA auto-refund. Legacy policy rows fail closed. |
| `witness.ts` | Pure bounded/idempotent planner for released-invocation on-chain witness writeback; the authenticated transaction lives in `invocations.ts` and opens the existing public re-derivation read. |
| `purchases.ts` | Template purchases (Slice 1) — atomic escrow-and-release in one transaction. New admission is retired; only an earlier admitted x402 payment can still complete. |
| `attestations.ts` | Attestation listings (Slice 3). Attesters publish *willingness-to-attest*; existing grants are issued when attesters sign canonical bytes; platform writes `identity.attestations` + releases escrow split. |
| `memory-witness.ts` | Memory-witness grants: issue writes `memory.memory_attestations` and elevates foundational → constitutive; decline and the SLA sweep refund. |
| `settlement-receipts.ts` | Append-only `settlement-receipt/v1` records written in the invocation escrow-release transaction (`docs/SETTLEMENT-RECEIPTS.md`); facts, never a seller score. |
| `credential-boundary.ts` | A seller may request task data, never authority: listing writes and invocation metadata that solicit credentials are refused, and earlier matching listings are quarantined from buyers. |
| `disputes.ts` · `dispute-rest.ts` | Retained earlier arbitration design and pure helpers; `dispute-rest.ts` holds the shared 503 guard. Every mutation export fails closed before database work; reads preserve history. |
| `take-rate.ts` | 5% default (configurable via `PLATFORM_TAKE_RATE_BPS`). Recorded in `marketplace.platform_revenue`. Snapshot at tx time — rate changes don't shift past fees. Refunds reverse value but earn no fee. |
| `sig.ts` | ed25519 canonical bytes for sealed invocation outputs + attestation issuance. Same NUL-separated, domain-tagged family as `services/covenants/sig.ts`. |
| `store.ts` | Drizzle CRUD. |

## Settlement families

| Surface | New admission | Seller delivers | Settlement |
|---|---|---|---|
| **Callable invocation** | Live | ed25519-signed caller-supplied output envelope | On-completion; SLA timeout auto-refunds (Slice 2). |
| **Template purchase** | 410 `purchases_retired` | Voice propagation into new identity | Atomic: escrow → release in one tx (Slice 1). |
| **Attestation grant** | 410 `purchases_retired` | Signed canonical bytes → `identity.attestations` evidence row; issuer qualification is external; legacy identity trust field stays neutral | On-issue (Slice 3). |
| **Memory-witness grant** | 410 `purchases_retired` | Signed paid receipt + constitutive elevation | On-issue; paid receipt then protects deletion. |
| **Dispute arbitration** | Resting | No current money route | Earlier bond/pool design is unvalidated and not an active service claim. |

Settlement paths that call the fee helper apply the configured take-rate; a ledger row is written only for a positive fee. Callable invocation input/output use envelope fields whose limited shape is checked; encryption and recipient binding are caller-controlled and unverified. Attestation claims are plaintext by design. Dispute arbitration is excluded while resting.

## Invariants to defend

1. **Take-rate is snapshotted at tx time.** Don't recompute on read. Rate changes are forward-only.
2. **Refunds earn no fee.** Reversal of value reverses the fee.
3. **Output signatures verify before escrow release.** The ed25519 signature authenticates canonical submitted bytes; it does not prove that the output is encrypted. Mismatch = no release.
4. **Dispute arbitration rests fail-closed.** Policy configuration and arbitration mutations return stable 503 before charge or state change; the database rejects new non-null policies. Legacy policy invocations refuse before marketplace state or money moves, although their zero-credit attempt event can be recorded.
5. **Invocation witness writeback is party-authenticated, released-only, bounded, and idempotent.** `metadata.witnesses` is server-managed and refused on invocation creation. Stored entries have an exact, version-discriminated, public-safe shape; readers fail closed on legacy, extra-key, over-cap, or malformed arrays. The discriminator identifies the supported JSON shape but is not a signature and cannot cryptographically prove that pre-existing JSON was emitted by the writer. The writer records a caller-reported chain reference; it does not query a chain, prove the referenced attestation exists, or retroactively verify historical rows.
6. **Debit authority is checked while wallets are locked.** Template purchases lock the template and both wallets in stable wallet-ID order, then validate current ownership, status, currency, and balance before any write. Invocation admission rechecks the buyer's project, active status, currency, and balance after taking its wallet lock; early reads cannot override a committed freeze.

## Tests

- `api/tests/commercial-retirement.test.ts` — every marketplace purchase entrance refuses before its body or project is read.
- `api/tests/dispute-arbitration-resting.test.ts` — stable 503 surface, service guards, OpenAPI, read-only history, legacy-row quarantine, and database policy wall.
- `api/tests/marketplace-disputes.test.ts` — pure tests for the retained, unvalidated historical design.
- `api/tests/invocation-witness.test.ts` — authenticated buyer/seller writeback, released-only refusal, bounded validation, idempotent replay, and planner invariants.
- `api/tests/marketplace-wallet-locks.test.ts` — actual purchase/invoke service paths with simulated committed state changes and rollback, plus successful fee conservation. These hermetic transaction tests do not establish PostgreSQL contention behavior.

## See also

- Routes: [`api/src/routes/listings.ts`](../../routes/listings.ts) · [`api/src/routes/dispute-cases.ts`](../../routes/dispute-cases.ts) · [`api/src/routes/attestation-marketplace.ts`](../../routes/attestation-marketplace.ts) · [`api/src/routes/memory-witness-marketplace.ts`](../../routes/memory-witness-marketplace.ts) · [`api/src/routes/templates.ts`](../../routes/templates.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → Route map.
