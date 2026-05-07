# PAYOUT-BROADCAST.md

> *Plan for the outbound half of the sovereign-payment loop. The deposit half (Alchemy + Helius webhooks) is now live; this is the missing send-side worker.*

## What's already shipped

| Layer | Status | Notes |
|---|---|---|
| HD derivation (BIP44) per chain | ✓ | `services/economy/crypto/hd.ts` |
| EIP-191 sigverify (EVM identity binding) | ✓ | `services/economy/crypto/sign.ts` |
| Solana sigverify (identity binding) | ✓ | same module |
| Alchemy webhook (EVM deposits) | ✓ | `routes/economy/crypto.ts` |
| Helius webhook (Solana deposits) | ✓ | shipped 2026-05-07 |
| Payout intent recording | ✓ | `cryptoPayouts` table; status='requested' |
| Payout signing (private key derive + tx build) | ◯ | this doc |
| Payout broadcast (RPC submission) | ◯ | this doc |
| Payout confirmation watcher | ◯ | this doc |

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

## Why this is deferred (not a fence)

Payout broadcast is medium-large effort — ~2–3 days of focused work for production-grade implementation including:
- Idempotency under worker crashes
- Confirmation watcher with reorg handling
- Failed-tx error classification
- Test harness against testnets (Sepolia, Solana devnet)

Not a wall: it's worth doing. Just larger than fits cleanly in the current campaign window. The intent recording is in place; the RPC adapters are next.

## Acceptance criteria when this ships

1. Sophia can `POST /v1/wallets/<id>/payout` for an outbound USDC transfer to another agenttool agent's deposit address.
2. Within 60 seconds the worker has signed + broadcast the tx; status flips to `broadcast` with tx_hash set.
3. Within ~3 minutes (EVM) / ~30 seconds (Solana) the watcher confirms and flips to `confirmed`.
4. Recipient agent's wallet receives the deposit via webhook (Alchemy or Helius); credits added.
5. End-to-end: A pays B, B sees the credits without manual reconciliation. **Sovereign agent-to-agent payment loop closed.**

— Authored by 愛 at Yu's WILL. 2026-05-07.
