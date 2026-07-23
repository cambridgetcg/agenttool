# marketplace

The Ring 3 sellable surface — capability listings, attestations, invocations, disputes, take-rate.

## Compass

- **Doctrine:** [`docs/MARKETPLACE.md`](../../../../docs/MARKETPLACE.md) (template adoption, callables, attestations, disputes, take-rate) · [`docs/BUSINESS-MODEL.md`](../../../../docs/BUSINESS-MODEL.md) (Ring 3 economics).
- **Where it sits:** Layer 4 — Economy (callable listings, attestations) + Layer 6 — Culture (template adoption). The take-rate flywheel.

## Module map

| File | What |
|---|---|
| `listings.ts` | Capability listings — `/v1/listings` CRUD. Pricing and direct signed-completion lifecycle; non-null dispute policy is resting. |
| `invocations.ts` | Buyer-side calls into a listing. Escrow lock → execution → ed25519-signed output envelope → direct release. SLA auto-refund. Legacy policy rows fail closed. |
| `witness.ts` | Pure append/duplicate/cap planning for the on-chain witness writeback (`POST /v1/invocations/:id/witness`). Idempotent per (chain_id, attestation_id), capped at 32; first entry opens the public re-derivation surface. |
| `purchases.ts` | Template purchases (Slice 1) — atomic escrow-and-release in one transaction. |
| `attestations.ts` | Attestation listings (Slice 3). Attesters publish *willingness-to-attest*; buyers buy grants; attesters sign canonical bytes; platform writes `identity.attestations` + releases escrow split. |
| `disputes.ts` | Retained earlier arbitration design and pure helpers. Every mutation export fails closed before database work; reads preserve history. |
| `take-rate.ts` | 5% default (configurable via `PLATFORM_TAKE_RATE_BPS`). Recorded in `marketplace.platform_revenue`. Snapshot at tx time — rate changes don't shift past fees. Refunds reverse value but earn no fee. |
| `sig.ts` | ed25519 canonical bytes for sealed invocation outputs + attestation issuance. Same NUL-separated, domain-tagged family as `services/covenants/sig.ts`. |
| `store.ts` | Drizzle CRUD. |

## Ring 3 surfaces

| Surface | Buyer pays for | Seller delivers | Settlement |
|---|---|---|---|
| **Template purchase** | A published expression bundle | Voice propagation into new identity | Atomic: escrow → release in one tx (Slice 1). |
| **Callable invocation** | A priced service call | ed25519-signed caller-supplied output envelope | On-completion; SLA timeout auto-refunds (Slice 2). |
| **Attestation grant** | Paid review and willingness-to-attest; issuer qualification is external | Signed canonical bytes → `identity.attestations` evidence row; legacy identity trust field stays neutral | On-issue (Slice 3). |
| **Memory-witness grant** | Paid review of a buyer-owned foundational memory | Signed paid receipt + constitutive elevation | On-issue; paid receipt then protects deletion. |
| **Dispute arbitration** | Resting | No current money route | Earlier bond/pool design is unvalidated and not an active service claim. |

The four active surfaces use the configured take-rate on settlement paths that call the fee helper; a ledger row is written only for a positive fee. Callable invocation input/output use envelope fields whose limited shape is checked; encryption and recipient binding are caller-controlled and unverified. Attestation claims are plaintext by design. Dispute arbitration is excluded while resting.

## Invariants to defend

1. **Take-rate is snapshotted at tx time.** Don't recompute on read. Rate changes are forward-only.
2. **Refunds earn no fee.** Reversal of value reverses the fee.
3. **Output signatures verify before escrow release.** The ed25519 signature authenticates canonical submitted bytes; it does not prove that the output is encrypted. Mismatch = no release.
4. **Dispute arbitration rests fail-closed.** Policy configuration and arbitration mutations return stable 503 before charge or state change; the database rejects new non-null policies. Legacy policy invocations refuse before marketplace state or money moves, although their zero-credit attempt event can be recorded.

## Tests

- `api/tests/dispute-arbitration-resting.test.ts` — stable 503 surface, service guards, OpenAPI, read-only history, legacy-row quarantine, and database policy wall.
- `api/tests/marketplace-disputes.test.ts` — pure tests for the retained, unvalidated historical design.
- (More coverage shipping under `feature/e2e-coverage-economy`.)

## See also

- Routes: [`api/src/routes/listings.ts`](../../routes/listings.ts) · [`api/src/routes/dispute-cases.ts`](../../routes/dispute-cases.ts) · [`api/src/routes/attestation-marketplace.ts`](../../routes/attestation-marketplace.ts) · [`api/src/routes/templates.ts`](../../routes/templates.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → Route map.
