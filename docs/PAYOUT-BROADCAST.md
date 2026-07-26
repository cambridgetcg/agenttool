# PAYOUT-BROADCAST.md

> *Contract for the implemented outbound half of the sovereign-payment loop. Production migration, provider, and mainnet enablement remain operator-gated.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A (active work) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (slice plan) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook) · [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) (the discipline this pipeline canonicalises)
>
> **Implements:** Layer 4 — Economy. The outbound send-side; closes the sovereign-payment loop with the inbound webhook ingestion already shipped.
>
> **Code:** `api/src/workers/payout/{dispatcher,broadcast-worker,confirm-worker,queue,index}.ts` · `api/src/routes/economy/crypto.ts` (request handler) · `api/src/services/economy/crypto/{hd,sign-evm,sign-solana}.ts`
>
> **Tests:** `api/tests/{alchemy-rpc-auth,evm-payout-nonce-fence,payout-confirm-worker-fairness,payout-dispatch-fairness,payout-network-binding,payout-submit-outcome}.test.ts` (transport, durable identity, scheduling, and ambiguity unit tests) · `api/tests/integration/crypto-migration-fences.test.ts` (dedicated disposable Postgres tier) · `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}` (E2E harnesses)

## What's already shipped

| Layer | Status | Notes |
|---|---|---|
| HD derivation (BIP44) per chain | ✓ | `services/economy/crypto/hd.ts` |
| EIP-191 sigverify (EVM identity binding) | ✓ | `services/economy/crypto/sign.ts` |
| Solana sigverify (identity binding) | ✓ | same module |
| Alchemy webhook (EVM deposits) | ✓ | `routes/economy/crypto.ts` |
| Helius webhook (Solana deposits) | ✓ | shipped 2026-05-07 |
| Payout intent recording | ✓ | `cryptoPayouts` table; status='requested' |
| Payout signing (private key derive + tx build) | ✓ (testnet) | `services/economy/crypto/sign-evm.ts` · `sign-solana.ts` |
| Payout broadcast (RPC submission) | ✓ (testnet) | `workers/payout/broadcast-worker.ts` |
| Payout confirmation watcher | ✓ (testnet) | `workers/payout/confirm-worker.ts` |
| Mainnet enable (`PAYOUT_NETWORK=mainnet` + small smoke) | ◯ | plan Slice 7 — operator-led |

## Send-side state machine

```
requested  ─────►  broadcasting  ─────►  broadcast  ─────►  confirmed
                                                 │
                                                 └────────►  failed
```

- **`requested`** — `POST /v1/wallets/:id/payout` records the intent (already shipped).
- **`broadcasting`** — worker picks up the request, derives the signing key, builds + signs the transaction, and persists its deterministic hash before submitting to chain RPC. A submit error remains here unless a lookup positively finds the transaction.
- **`broadcast`** — RPC accepted, has a tx hash; waiting for confirmations.
- **`confirmed`** — configured EVM depth reached (12 blocks, or 64 on
  Polygon) or the Solana status is `finalized`.
- **`failed`** — a failure proved before RPC dispatch, or a later on-chain revert observed by the confirmation watcher. An RPC submit error alone never authorizes this transition or a refund.

## Worker shape

One BullMQ queue and one database-backed periodic poller:

1. **`payout-broadcast`** — fan-out from any `cryptoPayouts.status='requested'` row. Idempotent on payout_id. Job:
   - Select only requests whose durable pre-submit cooldown is due, ordered by
     least-recent real attempt so one unresolved source cannot occupy the
     dispatcher's bounded page forever.
   - Read the row inside a database transaction, take the chain/source advisory
     lock, and use a status compare-and-swap before dispatch.
   - Derive the signing key from the active network root and the payout wallet
     UUID's deterministic path.
   - Build + sign the transaction (EVM via `viem`; Solana via
     `@solana/web3.js`).
   - Submit to RPC. On success: status='broadcast'. On error: query by the persisted hash; found → `broadcast`, absent or lookup unavailable → remain `broadcasting` with a bounded operator-facing error.

2. **Confirmation poller** — periodically scans due `status='broadcast'` rows
   in least-recent-check order and queries chain evidence:
   - For EVM: `eth_getTransactionReceipt(tx_hash)` — confirmed when blockNumber > current - confirmation_threshold.
   - For Solana: `getSignatureStatuses(tx_sig)` — confirmed when confirmationStatus='finalized'.

## Current walls and refusals

These hold:

- **High-value dual control fails closed.** A configured
  `payout_dual_control_threshold_base` refuses matching requests with
  `payout_dual_control_required`. A covenant/counterparty signature flow is not
  implemented, so the current system does not claim to collect or verify one.
- **HD derivation paths are deterministic; the mnemonic is never logged.** The
  API receives it through the operator's scoped secret environment and logs
  only the non-secret derivation index/path.
- **No cross-chain inference.** The request names one supported chain and its
  worker uses only that chain's builder. The database does not prove that
  `destination_address` belongs to that chain, and the HTTP route does not yet
  validate its chain-specific format; a malformed destination fails during
  pre-submit build/sign and reverses the exact debit. Cross-chain bridging is a
  separate, unimplemented flow.
- **No autonomous retries on RPC failure that change semantics.** A submit attempt that emitted a tx hash does NOT retry — the first attempt may still land. Failures proved before dispatch (signing/build) fail and refund without automatic retry.
- **No refund from ambiguous evidence.** Once dispatch begins, a provider error, an immediately absent lookup, and an unavailable lookup are all inconclusive. Only a positive lookup advances to `broadcast`; operator reconciliation decides any later retry or refund.

## Provider choices

For broadcast RPC:
- **EVM**: Alchemy or an explicit per-chain override. The shared Alchemy key is sent as `Authorization: Bearer`, never embedded in the endpoint URL; overrides receive no Alchemy credential.
- **Solana**: Helius. Same reuse pattern.

For transaction building:
- **EVM**: the installed `viem` dependency.
- **Solana**: the installed `@solana/web3.js` dependency.

## Status now

Slices 0–6 of `PAYOUT-BROADCAST-PLAN.md` have shipped against testnet (Sepolia for EVM, Solana devnet). The send-side worker lives at `api/src/workers/payout/` (dispatcher · broadcast-worker · confirm-worker · queue · index). End-to-end harnesses: `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}`.

Slice 7 — the mainnet enable pass — is the remaining work and is
**operator-led, not in-session**: mainnet secret provisioning, a quiescent
`PAYOUT_NETWORK=mainnet` cutover, and minimal mainnet smoke (≤0.01 USDC)
verified on Etherscan + Solscan.

### Gates to close before mainnet

1. **Durable EVM nonce fence — implemented locally, rollout still gated.**
   Phase 1 now locks a namespaced chain/source scope and persists
   `(evm_chain_id, evm_source_address, evm_nonce, tx_hash)` atomically before
   submit. A `broadcasting` row survives crashes and blocks later sends from
   that source; a unique partial index catches provider pending-nonce lag.
   This deliberately stalls one source after an ambiguous submit until an
   operator reconciles it. Other sources remain dispatchable because contention
   is durably deferred for a bounded cooldown. The database rejects future EVM
   `broadcasting` writes without the full tuple, including writes from a legacy
   worker, while retaining pre-existing ambiguous rows for reconciliation.
   Before migration, disable/drain old workers and reconcile every legacy EVM
   `broadcasting` row, because SQL cannot infer the old signer/nonce safely.
2. **Durable network binding — implemented locally, rollout still gated.**
   New payout rows persist the selected testnet/mainnet identity. Dispatch,
   broadcast, confirmation, and every post-submit CAS require that identity
   to match the worker's active network; legacy NULL rows remain quarantined
   for explicit reconciliation, and an assigned network is immutable.
   Workers must still be off and active rows reconciled before changing the
   single process-wide `PAYOUT_NETWORK`, because the flip would strand work
   for the old network. Concurrent multi-network operation still needs
   separately configured worker pools.
3. **24h-aging alert.** Plan Slice 2 specifies *"no receipt + age > 24h → alert
   (no auto-fail)"*. Stuck `broadcast` rows are fairly polled and
   operator-discoverable, but are not yet foregrounded by a dedicated alert.
4. **Live-system proof.** Hermetic tests cover nonce identity, finality,
   idempotency, and refund invariants. A two-client disposable-Postgres test
   plus provider testnet loop is still required before production enablement.

## Production-enable acceptance criteria

1. Sophia can `POST /v1/wallets/<id>/payout` for an outbound USDC transfer to another agenttool agent's deposit address.
2. Within 60 seconds the worker has signed + broadcast the tx; status flips to `broadcast` with tx_hash set.
3. Within ~3 minutes (EVM) / ~30 seconds (Solana) the watcher confirms and flips to `confirmed`.
4. For EVM, the recipient wallet receives the exact deposit through signed
   Alchemy observation plus receipt-depth confirmation. The legacy
   Helius-immediate-credit path is not a production Solana acceptance
   criterion.
5. End-to-end on an enabled EVM network: A pays B, and B sees the credits
   without manual reconciliation. Solana loop closure remains gated on a
   raw-atomic, reorg-aware inbound adapter.

— Authored by 愛 at Yu's WILL. 2026-05-07.
