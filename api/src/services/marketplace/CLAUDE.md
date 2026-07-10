# marketplace

The Ring 3 sellable surface — capability listings, attestations, invocations, disputes, take-rate.

## Compass

- **Doctrine:** [`docs/MARKETPLACE.md`](../../../../docs/MARKETPLACE.md) (template adoption, callables, attestations, disputes, take-rate) · [`docs/BUSINESS-MODEL.md`](../../../../docs/BUSINESS-MODEL.md) (Ring 3 economics).
- **Where it sits:** Layer 4 — Economy (callable listings, attestations) + Layer 6 — Culture (template adoption). The take-rate flywheel.

## Module map

| File | What |
|---|---|
| `listings.ts` | Capability listings — `/v1/listings` CRUD. Pricing, dispute policy, accept/reject lifecycle. |
| `invocations.ts` | Buyer-side calls into a listing. Escrow lock → execution → ed25519-signed output envelope → direct release or dispute-policy review. SLA auto-refund. |
| `purchases.ts` | Template purchases (Slice 1) — atomic escrow-and-release in one transaction. |
| `attestations.ts` | Attestation listings (Slice 3). Attesters publish *willingness-to-attest*; buyers buy grants; attesters sign canonical bytes; platform writes `identity.attestations` + releases escrow split. |
| `disputes.ts` | Disputable invocations. 72h review window → first arbiter rules → escalation to 5-arbiter deterministic-draw pool → 4-of-5 supermajority → bond split 60/30/10. |
| `take-rate.ts` | 5% default (configurable via `PLATFORM_TAKE_RATE_BPS`). Recorded in `marketplace.platform_revenue`. Snapshot at tx time — rate changes don't shift past fees. Refunds reverse value but earn no fee. |
| `sig.ts` | ed25519 canonical bytes for sealed invocation outputs + attestation issuance. Same NUL-separated, domain-tagged family as `services/covenants/sig.ts`. |
| `store.ts` | Drizzle CRUD. |

## The four Ring 3 surfaces

| Surface | Buyer pays for | Seller delivers | Settlement |
|---|---|---|---|
| **Template purchase** | A published expression bundle | Voice propagation into new identity | Atomic: escrow → release in one tx (Slice 1). |
| **Callable invocation** | A priced service call | ed25519-signed caller-supplied output envelope | On-completion; SLA timeout auto-refunds (Slice 2). |
| **Attestation grant** | Willingness-to-attest from a trusted issuer | Signed canonical bytes → `identity.attestations` row + trust_score bump | On-issue (Slice 3). |
| **Dispute resolution** | (escalation bond) | Arbiter votes | 60/30/10 bond split on resolution (this commit). |

All four pay the platform take-rate. Callable invocation input/output use envelope fields whose limited shape is checked; encryption and recipient binding are caller-controlled and unverified. Attestation claims are plaintext by design.

## Invariants to defend

1. **Take-rate is snapshotted at tx time.** Don't recompute on read. Rate changes are forward-only.
2. **Refunds earn no fee.** Reversal of value reverses the fee.
3. **Output signatures verify before escrow release.** The ed25519 signature authenticates canonical submitted bytes; it does not prove that the output is encrypted. Mismatch = no release.
4. **Dispute escalation is deterministic-draw.** 5-arbiter pool selected by hash(case_id || block) — no operator picks.

## Tests

- `api/tests/marketplace-disputes.test.ts` — dispute lifecycle, supermajority, bond split.
- (More coverage shipping under `feature/e2e-coverage-economy`.)

## See also

- Routes: [`api/src/routes/listings.ts`](../../routes/listings.ts) · [`api/src/routes/dispute-cases.ts`](../../routes/dispute-cases.ts) · [`api/src/routes/attestation-marketplace.ts`](../../routes/attestation-marketplace.ts) · [`api/src/routes/templates.ts`](../../routes/templates.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → Route map.
