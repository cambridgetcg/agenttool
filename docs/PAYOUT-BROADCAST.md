# PAYOUT-BROADCAST.md

> *Plan for the outbound half of the sovereign-payment loop. The deposit half (Alchemy + Helius webhooks) is now live; this is the missing send-side worker.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A (active work) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (slice plan) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook) · [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) (the discipline this pipeline canonicalises)
>
> **Implements:** Layer 4 — Economy. The outbound send-side; closes the sovereign-payment loop with the inbound webhook ingestion already shipped.
>
> **Code:** `api/src/workers/payout/{dispatcher,broadcast-worker,confirm-worker,queue,index}.ts` · `api/src/routes/economy/crypto.ts` (request handler) · `api/src/services/economy/crypto/{hd,sign-evm,sign-solana}.ts`
>
> **Tests:** `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}` (E2E harnesses)

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

## What's missing — the send-side state machine

```
requested  ─────►  broadcasting  ─────►  broadcast  ─────►  confirmed
                                                 │
                                                 └────────►  failed
```

- **`requested`** — `POST /v1/wallets/:id/payout` records the intent (already shipped).
- **`broadcasting`** — worker picks up the request, derives the signing key, builds + signs the transaction, submits to chain RPC. Locks the payout row.
- **`broadcast`** — RPC accepted, has a tx hash; waiting for confirmations.
- **`confirmed`** — N confirmations reached (chain-specific: 12 ETH-equiv, 32 Solana finalized).
- **`failed`** — RPC rejected, gas exhausted, signing failed, or row was double-claimed.

## Worker shape (BullMQ — already in deps)

Two queues:

1. **`payout-broadcast`** — fan-out from any `cryptoPayouts.status='requested'` row. Idempotent on payout_id. Job:
   - SELECT FOR UPDATE on the row, lock to in-flight worker.
   - Derive signing key from `cryptoHdMnemonic` + payout's wallet path.
   - Build + sign transaction (EVM via ethers/viem, Solana via @solana/web3.js).
   - Submit to RPC. On success: status='broadcast', tx_hash set. On failure: status='failed', error_reason set.

2. **`payout-confirm`** — periodic. Polls `status='broadcast'` rows, queries chain for confirmations:
   - For EVM: `eth_getTransactionReceipt(tx_hash)` — confirmed when blockNumber > current - confirmation_threshold.
   - For Solana: `getSignatureStatuses(tx_sig)` — confirmed when confirmationStatus='finalized'.

## Walls

These hold:

- **Witness on payout authorization for high-value payouts.** Mirrors constitutive memory elevation: a payout above some threshold (e.g. 1000 USDC equivalent) requires a covenant counterparty's signature on the request, not just the agent's. Without this, the signing-key holder is the only wall — same as a stolen private key.
- **HD derivation paths are deterministic, never logged with full mnemonic.** The mnemonic stays in env / vault; derivation paths log just the index.
- **No payout to addresses outside the wallet's chain.** Schema enforces `chain` consistency. Cross-chain via bridge is a separate flow and not implemented.
- **No autonomous retries on RPC failure that change semantics.** A failed broadcast that emitted a tx hash does NOT retry — would risk double-spend if the first eventually lands. The worker only retries pre-RPC-submit failures (signing, build).

## Provider choices (deferred until building)

For broadcast RPC:
- **EVM**: Alchemy or Infura. Already authenticated for webhook; reuse the API key.
- **Solana**: Helius. Same reuse pattern.

For transaction building:
- **EVM**: `viem` (lighter than ethers, modern). Add as dep.
- **Solana**: `@solana/web3.js`. Add as dep.

These deps add ~3–5MB to the API container. Acceptable.

## Status now

Slices 0–6 of `PAYOUT-BROADCAST-PLAN.md` have shipped against testnet (Sepolia for EVM, Solana devnet). The send-side worker lives at `api/src/workers/payout/` (dispatcher · broadcast-worker · confirm-worker · queue · index). End-to-end harnesses: `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}`.

Slice 7 — the mainnet enable pass — is the remaining work and is **operator-led, not in-session**: secret rotation, `PAYOUT_NETWORK=mainnet` flip in Fly, minimal mainnet smoke (≤0.01 USDC) verified on Etherscan + Solscan.

### Caveats to close before mainnet

1. **Per-source-address nonce locking — Phase 1 shipped, Phase 2 follow-up.** `broadcast-worker.ts` now takes a `pg_advisory_xact_lock(hashtextextended(fromAddress, 0))` at the start of each Phase 1 transaction (EVM + Solana branches). Same address blocks; different addresses run in parallel; auto-released on commit. **Operational reality**: the api runs across 3 machines (`lhr×2 + cdg×1`); BullMQ-level concurrency=1 serialises *within* a machine, but jobs targeting the same source address picked by *different* machines previously raced unprotected. Phase 1 lock closes most of that surface. **Residual race window**: the lock releases at Phase 1 commit, but submit happens in Phase 2 outside the transaction — a concurrent same-address worker on a different machine can acquire the lock and read the chain's nonce in the ~100-500ms before our submit lands in mempool. Today protected only by low payout volume. The full close requires a **session-level lock** spanning Phase 1 + Phase 2 — needs a reserved Postgres connection threaded through the worker. Don't enable high-throughput payout volume (or autoscale machine count up further) until that ships.
2. **24h-aging alert.** Plan Slice 2 specifies *"no receipt + age > 24h → alert (no auto-fail)"* — `confirm-worker.tick()` doesn't yet check `requestedAt` age. Stuck `broadcast` rows are operator-discoverable via logs but not foregrounded.
3. **Credits-precision ceiling.** `creditsForAmount` (`broadcast-worker.ts:90`, `confirm-worker.ts:33`) uses `Number(amountBase) / 1_000_000` — silently rounds above ~9007 USDC. Either BigInt math or an explicit per-payout cap enforced in policies.

## Acceptance criteria when this ships

1. Sophia can `POST /v1/wallets/<id>/payout` for an outbound USDC transfer to another agenttool agent's deposit address.
2. Within 60 seconds the worker has signed + broadcast the tx; status flips to `broadcast` with tx_hash set.
3. Within ~3 minutes (EVM) / ~30 seconds (Solana) the watcher confirms and flips to `confirmed`.
4. Recipient agent's wallet receives the deposit via webhook (Alchemy or Helius); credits added.
5. End-to-end: A pays B, B sees the credits without manual reconciliation. **Sovereign agent-to-agent payment loop closed.**

— Authored by 愛 at Yu's WILL. 2026-05-07.
