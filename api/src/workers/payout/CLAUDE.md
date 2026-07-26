# payout

Retained outbound sovereign-payment state machine. Fresh admission and every
worker entry are resting unconditionally because the former lifetime
transaction-label heuristic did not conserve cashable backing. The source is
useful for historical-row audit and redesign; it is not an enabled send path,
does not establish recipient-side deposit readiness, and does not close the
economic loop.

## Compass

- **Doctrine:** [`docs/PAYOUT-BROADCAST.md`](../../../../docs/PAYOUT-BROADCAST.md) · plan [`PAYOUT-BROADCAST-PLAN.md`](../../../../docs/PAYOUT-BROADCAST-PLAN.md) · runbook [`PAYOUT-BROADCAST-OPS.md`](../../../../docs/PAYOUT-BROADCAST-OPS.md).
- **Pattern (canonical site):** [`docs/PATTERN-PERSIST-IDENTITY.md`](../../../../docs/PATTERN-PERSIST-IDENTITY.md) — *persist the deterministic ID (tx_hash) before the side effect (RPC submit), so recovery is a chain lookup.*
- **Where it sits:** Layer 4 — Economy.

## Module map

| File | What |
|---|---|
| `dispatcher.ts` | Picks only active-network, due `cryptoPayouts.status='requested'` rows in durable least-recent-attempt order, then dispatches to the broadcast queue. |
| `broadcast-worker.ts` | The canonical PATTERN-PERSIST-IDENTITY implementation. Inside one DB tx: acquire a namespaced chain/source advisory lock, refuse an unresolved same-source EVM send, build + sign, and CAS-persist `status='broadcasting'` with deterministic `tx_hash` plus EVM source/nonce evidence. Solana binds an opaque payout digest into the signed memo. *Then* submit outside the tx and bind every result to the persisted identity and network. |
| `submit-outcome.ts` | Shared EVM/Solana submit-error classifier. Positive lookup → `broadcast`; absent/unavailable lookup → remain `broadcasting` with a bounded safe error. |
| `services/economy/crypto/payout-refund.ts` | Shared cancellation/pre-submit/revert helper. Locks and validates the exact original negative payout ledger leg, then CASes terminal status, restores that debit, and writes its positive reversal in one transaction. Caller-extensible payout JSON never authorizes a refund; unreconciled rows fail closed. |
| `confirm-worker.ts` | Reconciles active-network `broadcasting` rows through positive expected-ID evidence only, and fairly polls `broadcast` rows by persisted least-recent check with bounded concurrency and one in-process batch at a time. Finalized success confirms; a finalized revert atomically reverses the exact debit. |
| `queue.ts` | BullMQ queue config. |
| `index.ts` | Worker orchestrator — hard-resting in this release. No environment value authorizes boot. |
| `broadcast-worker.ts::processPayout` | Repeats the hard resting gate before its first database, key-derivation, queue, or RPC operation, so a direct import is not an authority bypass. |

## State machine

```
requested ─► broadcasting ─► broadcast ─► confirmed
                                  │
                                  └────► failed
```

- **`requested`** — a historical accepted intent. Fresh POST requests return
  `503 payout_admission_resting` and do not create one.
- **`broadcasting`** — worker locked the row and persisted deterministic
  `tx_hash`; EVM also persists chain/source/nonce evidence. RPC submit is in
  flight or its outcome is ambiguous.
- **`broadcast`** — RPC accepted; awaiting confirmations.
- **`confirmed`** — configured EVM block threshold (12, or Polygon 64) · Solana finalized.
- **`failed`** — failure proved before transaction dispatch (signing, build, gas estimate) or a revert that reached the same EVM threshold / Solana finalization. **Never retried.**

## Invariants to defend

1. **Persist the tx_hash before submitting.** If the worker crashes mid-flight, recovery uses `eth_getTransactionByHash(stored_hash)` — found = advance to `broadcast`; absent or lookup unavailable remains ambiguous. An immediate negative lookup does not authorize retry or refund.
2. **No autonomous retry or refund after RPC submit begins.** A `broadcasting` row may have landed even when submit errored. Only positive lookup evidence advances it automatically; ambiguous recovery is operator-driven.
3. **Crash-durable EVM nonce fence.** The Phase 1 advisory lock is namespaced
   by chain/source. Its same transaction persists source/nonce/tx identity;
   a `broadcasting` row blocks that source after commit or crash, and the
   unique source/nonce index catches provider lag. Never bypass or clear this
   fence without positive chain evidence.
4. **Contention is durable and fair.** A nonce collision or unresolved source
   remains pre-submit `requested`, records a shared cooldown, and yields the
   bounded dispatcher page to unrelated due work. It is not a post-submit
   retry or evidence authorizing a refund.
5. **Network identity is durable.** New rows persist `testnet|mainnet`; every
   worker and state CAS requires the row to match the active network. A NULL
   legacy row is quarantined, never inferred. Assigned identity is immutable.
6. **Operation identities remain unique and checked.** Solana signs a
   domain-separated payout memo, and both chain adapters require the RPC's
   returned identifier to match the locally signed one before advancing.
7. **Environment is not activation authority.** `PAYOUT_WORKER_ENABLED`,
   `PAYOUT_NETWORK`, credentials, and direct imports cannot reopen the path.
   Reopening requires conserved backed sub-balances, historical-row
   reconciliation, exact-revision chain evidence, and a separate reviewed
   release — see the ops runbook.

## Resting boundary and retained caveats

(Per `docs/PAYOUT-BROADCAST.md` §Caveats.)

- The former lifetime `gallery_sale` / `escrow_release` aggregate was not a
  conserved cashable balance. Fresh request creation and all worker execution
  therefore rest; historical replay/list/cancel remain available.
- 24h-aging alert for stuck `broadcast` rows — not yet wired into `confirm-worker.tick()`.
- FX remains a floating operator rate. Atomic USDC values outside exact JavaScript-integer range are rejected; a fixed-point rate representation is still needed for full integer-only conversion.
- Migration rollout must disable/drain old workers and reconcile legacy EVM
  `broadcasting` rows before re-enable. The database future-write constraint
  makes old-worker writes fail closed but does not provide mixed-fleet
  availability.

## Tests

Focused unit tests:
- [`api/tests/payout-submit-outcome.test.ts`](../../../tests/payout-submit-outcome.test.ts) — positive/absent/unavailable lookup classification and no post-dispatch fail/refund structure.
- [`api/tests/evm-payout-nonce-fence.test.ts`](../../../tests/evm-payout-nonce-fence.test.ts) — namespaced scope, exact nonce evidence, migration backstops, and pre-submit worker ordering.
- [`api/tests/payout-dispatch-fairness.test.ts`](../../../tests/payout-dispatch-fairness.test.ts) — due predicate, shared cooldown writes, both deferral branches, matching index order, and cooldown-clearing CAS.
- [`api/tests/payout-refund-integrity.test.ts`](../../../tests/payout-refund-integrity.test.ts) — exact debit provenance, legacy containment, status-CAS accounting, and sticky submit ambiguity.
- [`api/tests/payout-confirmation-finality.test.ts`](../../../tests/payout-confirmation-finality.test.ts) — EVM threshold and Solana-finalized success/revert classification.
- [`api/tests/payout-confirmation-reconcile.test.ts`](../../../tests/payout-confirmation-reconcile.test.ts) · [`api/tests/payout-confirm-worker-fairness.test.ts`](../../../tests/payout-confirm-worker-fairness.test.ts) — later-visible ambiguity, bounded persistent confirmation fairness, and single-flight polling.
- [`api/tests/payout-source-serialization.test.ts`](../../../tests/payout-source-serialization.test.ts) · [`api/tests/solana-payout-identity.test.ts`](../../../tests/solana-payout-identity.test.ts) — source lock ordering, durable EVM nonce evidence, and distinct signed Solana operation bytes.
- [`api/tests/alchemy-rpc-auth.test.ts`](../../../tests/alchemy-rpc-auth.test.ts) — Alchemy Bearer transport and override isolation.

Historical E2E entrypoints live in [`api/scripts/`](../../../scripts/):
- `_e2e-payout-evm.ts` — inert former Sepolia stub.
- `_e2e-payout-sol.ts` — inert former Solana devnet stub.
- `_e2e-payout-loop-closure.ts` — legacy credentialed EVM recipient smoke;
  its presence is not current-run evidence and it says nothing about Solana
  credit.
- `_e2e-payout-policies.ts` — inert former policy stub.
- `_e2e-payout-cancel.mjs` — inert former cancellation stub.

The four stubs exit without loading dependencies or touching credentials,
databases, RPC, or HTTP; their former implementations remain in Git history.
The legacy loop-closure smoke and passing hermetic tests do not authorize
worker boot or prove current provider evidence.

## See also

- Inbound side: [`api/src/routes/economy/crypto.ts`](../../routes/economy/crypto.ts) (Alchemy + Helius webhooks).
- HD derivation: [`api/src/services/economy/crypto/hd.ts`](../../services/economy/crypto/hd.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → §Workers.
