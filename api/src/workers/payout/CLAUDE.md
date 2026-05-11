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
| `broadcast-worker.ts` | The canonical PATTERN-PERSIST-IDENTITY implementation. Inside one DB tx: acquire `pg_advisory_xact_lock(fromAddress)`, build + sign tx (deterministic `tx_hash`), CAS-update `status='broadcasting', tx_hash=$1 WHERE status='requested'`, commit. *Then* submit to RPC outside the tx. |
| `confirm-worker.ts` | Polls `status='broadcast'` rows. EVM: `eth_getTransactionReceipt`. Solana: `getSignatureStatuses` → finalized. Flips to `confirmed` or `failed`. |
| `queue.ts` | BullMQ queue config. |
| `index.ts` | Worker boot — disabled when `AGENTTOOL_DISABLE_WORKERS=1` or Redis unavailable. |

## State machine

```
requested ─► broadcasting ─► broadcast ─► confirmed
                                  │
                                  └────► failed
```

- **`requested`** — `POST /v1/wallets/:id/payout` records intent.
- **`broadcasting`** — worker locked the row, deterministic `tx_hash` persisted, RPC submit in flight.
- **`broadcast`** — RPC accepted; awaiting confirmations.
- **`confirmed`** — N confirmations (EVM: 12 · Solana: finalized).
- **`failed`** — pre-RPC failure (signing, build, gas estimate). **Never retried.**

## Invariants to defend

1. **Persist the tx_hash before submitting.** If the worker crashes mid-flight, recovery is `eth_getTransactionByHash(stored_hash)` — found = confirm, not found = retry-eligible. The pattern *only* works if the persist happens first.
2. **No autonomous retry after RPC submit.** A `broadcast` row that may have landed on chain doesn't get re-signed — risk of double-spend if the first eventually confirms. Failures pre-submit (signing, build) can retry; failures post-submit are operator-driven.
3. **Per-source-address lock (Phase 1).** `pg_advisory_xact_lock(hashtextextended(fromAddress, 0))` blocks same-address concurrent workers across machines. *Residual race:* lock releases at commit but submit happens outside the tx — protected today only by low payout volume. Full close needs a session-level lock spanning Phase 1 + Phase 2.
4. **Mainnet enable is operator-gated.** `PAYOUT_NETWORK=mainnet` flip + small smoke (≤0.01 USDC verified on Etherscan + Solscan) is **never** done in a session — see ops runbook.

## Caveats marked but not fixed

(Per `docs/PAYOUT-BROADCAST.md` §Caveats.)

- 24h-aging alert for stuck `broadcast` rows — not yet wired into `confirm-worker.tick()`.
- Credits-precision ceiling — `creditsForAmount` rounds above ~9007 USDC; either BigInt math or per-payout cap in policies.
- Session-level lock for Phase 1 + Phase 2 — needed before high-throughput payout volume or autoscale-up.

## Tests

E2E harnesses live in [`api/scripts/`](../../../scripts/):
- `_e2e-payout-evm.ts` — Sepolia round-trip.
- `_e2e-payout-sol.ts` — Solana devnet round-trip.
- `_e2e-payout-loop-closure.ts` — A pays B; B sees credit via webhook.
- `_e2e-payout-policies.ts` — payout policy enforcement.
- `_e2e-payout-cancel.mjs` — cancel before broadcast.

No unit tests today for the worker itself — flow is exercised via e2e against testnet.

## See also

- Inbound side: [`api/src/routes/economy/crypto.ts`](../../routes/economy/crypto.ts) (Alchemy + Helius webhooks).
- HD derivation: [`api/src/services/economy/crypto/hd.ts`](../../services/economy/crypto/hd.ts).
- Up one level: [`api/CLAUDE.md`](../../../CLAUDE.md) → §Workers.
