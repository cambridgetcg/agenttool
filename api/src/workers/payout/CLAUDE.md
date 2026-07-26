# payout

Outbound sovereign-payment worker. Closes Horizon A's economic loop.

## Compass

- **Doctrine:** [`docs/PAYOUT-BROADCAST.md`](../../../../docs/PAYOUT-BROADCAST.md) · plan [`PAYOUT-BROADCAST-PLAN.md`](../../../../docs/PAYOUT-BROADCAST-PLAN.md) · runbook [`PAYOUT-BROADCAST-OPS.md`](../../../../docs/PAYOUT-BROADCAST-OPS.md).
- **Pattern (canonical site):** [`docs/PATTERN-PERSIST-IDENTITY.md`](../../../../docs/PATTERN-PERSIST-IDENTITY.md) — *persist the deterministic ID (tx_hash) before the side effect (RPC submit), so recovery is a chain lookup.*
- **Where it sits:** Layer 4 — Economy.

## Module map

| File | What |
|---|---|
| `dispatcher.ts` | Picks `cryptoPayouts.status='requested'` rows, dispatches to broadcast queue. |
| `broadcast-worker.ts` | The canonical PATTERN-PERSIST-IDENTITY implementation. Inside one DB tx: acquire `pg_advisory_xact_lock(fromAddress)`, refuse a second `broadcasting`/`broadcast` operation for the same wallet+chain, build + sign, and CAS-persist `tx_hash` before submit. Returned identity and success state are CAS-checked. |
| `submit-outcome.ts` | Shared EVM/Solana submit-error classifier. Positive lookup → `broadcast`; absent/unavailable lookup → remain `broadcasting` with a bounded safe error. |
| `services/economy/crypto/payout-refund.ts` | Shared cancellation/pre-submit/revert helper. Locks and validates the exact original negative payout ledger leg, then CASes terminal status, restores that debit, and writes its positive reversal in one transaction. Caller-extensible payout JSON never authorizes a refund; unreconciled rows fail closed. |
| `confirm-worker.ts` | Fairly rotates through `broadcasting` and `broadcast` rows. Positive expected-ID evidence advances ambiguity; absence/failure does nothing. Finalized success confirms; a finalized revert atomically reverses the exact debit. |
| `queue.ts` | BullMQ queue config. |
| `index.ts` | Worker boot — requires `PAYOUT_WORKER_ENABLED=true` and `AGENTTOOL_DISABLE_WORKERS` unset. A missing queue fails closed; there is no direct in-process broadcast fallback. |

## State machine

```
requested ─► broadcasting ─► broadcast ─► confirmed
                                  │
                                  └────► failed
```

- **`requested`** — `POST /v1/wallets/:id/payout` records intent.
- **`broadcasting`** — worker locked the row and persisted deterministic `tx_hash`; RPC submit is in flight or its outcome is ambiguous.
- **`broadcast`** — RPC accepted; awaiting confirmations.
- **`confirmed`** — configured EVM block threshold (12, or Polygon 64) · Solana finalized.
- **`failed`** — failure proved before transaction dispatch (signing, build, gas estimate) or a revert that reached the same EVM threshold / Solana finalization. **Never retried.**

## Invariants to defend

1. **Persist the tx_hash before submitting.** If the worker crashes mid-flight, recovery uses `eth_getTransactionByHash(stored_hash)` — found = advance to `broadcast`; absent or lookup unavailable remains ambiguous. An immediate negative lookup does not authorize retry or refund.
2. **No autonomous retry or refund after RPC submit begins.** A `broadcasting` row may have landed even when submit errored. Only positive lookup evidence advances it automatically; ambiguous recovery is operator-driven.
3. **One in-flight source operation.** The cross-replica transaction lock and
   durable `broadcasting`/`broadcast` gate allow only one signed payout per
   wallet+chain until it confirms or terminalizes. A partial unique index
   prevents one chain identity from authorizing two rows; Solana also binds an
   opaque payout digest into the signed memo.
4. **Mainnet enable is operator-gated.** `PAYOUT_NETWORK=mainnet` flip + small smoke (≤0.01 USDC verified on Etherscan + Solscan) is **never** done in a session — see ops runbook.

## Caveats marked but not fixed

(Per `docs/PAYOUT-BROADCAST.md` §Caveats.)

- 24h-aging alert for stuck `broadcast` rows — not yet wired into `confirm-worker.tick()`.
- FX remains a floating operator rate. Atomic USDC values outside exact JavaScript-integer range are rejected; a fixed-point rate representation is still needed for full integer-only conversion.
- A stuck source intentionally blocks its later payouts; there is no automated
  expiry refund or replacement lifecycle.

## Tests

Focused unit tests:
- [`api/tests/payout-submit-outcome.test.ts`](../../../tests/payout-submit-outcome.test.ts) — positive/absent/unavailable lookup classification and no post-dispatch fail/refund structure.
- [`api/tests/payout-refund-integrity.test.ts`](../../../tests/payout-refund-integrity.test.ts) — exact debit provenance, legacy containment, status-CAS accounting, and sticky submit ambiguity.
- [`api/tests/payout-confirmation-finality.test.ts`](../../../tests/payout-confirmation-finality.test.ts) — EVM threshold and Solana-finalized success/revert classification.
- [`api/tests/payout-confirmation-reconcile.test.ts`](../../../tests/payout-confirmation-reconcile.test.ts) — later-visible ambiguity and fair keyset rotation.
- [`api/tests/payout-source-serialization.test.ts`](../../../tests/payout-source-serialization.test.ts) · [`api/tests/solana-payout-identity.test.ts`](../../../tests/solana-payout-identity.test.ts) — one-in-flight source gate and distinct signed Solana operation bytes.
- [`api/tests/alchemy-rpc-auth.test.ts`](../../../tests/alchemy-rpc-auth.test.ts) — Alchemy Bearer transport and override isolation.

E2E harnesses live in [`api/scripts/`](../../../scripts/):
- `_e2e-payout-evm.ts` — Sepolia round-trip.
- `_e2e-payout-sol.ts` — Solana devnet round-trip.
- `_e2e-payout-loop-closure.ts` — A pays B; B sees credit via webhook.
- `_e2e-payout-policies.ts` — payout policy enforcement.
- `_e2e-payout-cancel.mjs` — cancel before broadcast.

## See also

- Inbound side: [`api/src/routes/economy/crypto.ts`](../../routes/economy/crypto.ts) (Alchemy + Helius webhooks).
- HD derivation: [`api/src/services/economy/crypto/hd.ts`](../../services/economy/crypto/hd.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → §Workers.
