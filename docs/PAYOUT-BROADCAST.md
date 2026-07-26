# PAYOUT-BROADCAST.md

> *Outbound half of the sovereign-payment loop. Signed Alchemy/Helius ingress
> exists, but deposit confirmation/reorg accounting is still a production
> blocker; this document does not claim the full loop is live.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A (active work) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (slice plan) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook) · [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) (the discipline this pipeline canonicalises)
>
> **Implements:** Layer 4 — Economy. The outbound send-side state machine;
> full loop closure also depends on finalized inbound accounting.
>
> **Code:** `api/src/workers/payout/{dispatcher,broadcast-worker,confirm-worker,queue,index}.ts` · `api/src/routes/economy/crypto.ts` (request handler) · `api/src/services/economy/crypto/{hd,sign-evm,sign-solana}.ts`
>
> **Tests:** `api/tests/{alchemy-rpc-auth,payout-submit-outcome}.test.ts` (transport and ambiguity unit tests) · `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}` (E2E harnesses)

## What's already shipped

| Layer | Status | Notes |
|---|---|---|
| HD derivation (BIP44) per chain | ✓ | `services/economy/crypto/hd.ts` |
| EIP-191 sigverify (EVM identity binding) | ✓ | `services/economy/crypto/sign.ts` |
| Solana sigverify (identity binding) | ✓ | same module |
| Alchemy webhook (EVM deposits) | ◐ | Signed ingress + durable watch state; finalized credit/reorg handling still required |
| Helius webhook (Solana deposits) | ◐ | Signed ingress exists; durable watch readiness + finalized credit handling still required |
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
- **`confirmed`** — the chain-specific EVM block threshold is reached, or
  Solana reports `finalized`.
- **`failed`** — a failure proved before RPC dispatch, or a later on-chain revert observed by the confirmation watcher. An RPC submit error alone never authorizes this transition or a refund.

## Worker shape (BullMQ — already in deps)

Two queues:

1. **`payout-broadcast`** — fan-out from any `cryptoPayouts.status='requested'` row. Idempotent on payout_id. Job:
   - Read inside a transaction and use status compare-and-swap for ownership.
   - Derive signing key from `cryptoHdMnemonic` + payout's wallet path.
   - Build + sign transaction (EVM via ethers/viem, Solana via @solana/web3.js).
   - Submit to RPC. On success: status='broadcast'. On error: query by the persisted hash; found → `broadcast`, absent or lookup unavailable → remain `broadcasting` with a bounded operator-facing error.

2. **`payout-confirm`** — periodic. Reconciles `broadcasting` rows by their
   persisted identity, then polls `broadcast` rows for confirmations:
   - A later positive identity lookup advances `broadcasting → broadcast`.
     Absence or provider failure changes nothing.
   - For EVM: `eth_getTransactionReceipt(tx_hash)` — confirmed when blockNumber > current - confirmation_threshold.
   - For Solana: `getSignatureStatuses(tx_sig)` — confirmed when confirmationStatus='finalized'.

## Walls

These hold:

- **Witness on payout authorization for high-value payouts.** Mirrors constitutive memory elevation: a payout above some threshold (e.g. 1000 USDC equivalent) requires a covenant counterparty's signature on the request, not just the agent's. Without this, the signing-key holder is the only wall — same as a stolen private key.
- **HD derivation paths are deterministic, never logged with full mnemonic.** The mnemonic stays in env / vault; derivation paths log just the index.
- **No payout to addresses outside the wallet's chain.** Schema enforces `chain` consistency. Cross-chain via bridge is a separate flow and not implemented.
- **No autonomous retries on RPC failure that change semantics.** A submit attempt that emitted a tx hash does NOT retry — the first attempt may still land. Failures proved before dispatch (signing/build) fail and refund without automatic retry.
- **No refund from ambiguous evidence.** Once dispatch begins, a provider error, an immediately absent lookup, and an unavailable lookup are all inconclusive. Only a positive lookup advances to `broadcast`; operator reconciliation decides any later retry or refund.
- **One in-flight operation per wallet and chain.** The cross-replica
  transaction lock admits no second signing operation while an earlier row is
  `broadcasting` or `broadcast`. A stuck ambiguous operation therefore blocks
  later payouts from that source rather than risking nonce reuse.
- **One chain identity authorizes one payout row.** A partial unique index
  rejects duplicate `(chain, tx_hash)` values. Solana signed bytes also carry
  a domain-separated digest of the payout ID, so otherwise identical payout
  rows cannot share one signature.

## Provider choices

For broadcast RPC:
- **EVM**: Alchemy or an explicit per-chain override. The shared Alchemy key is sent as `Authorization: Bearer`, never embedded in the endpoint URL; overrides receive no Alchemy credential.
- **Solana**: Helius. Same reuse pattern.

Transaction building uses `viem` for EVM and `@solana/web3.js` plus
`@solana/spl-token` for Solana. Submission disables transport-layer retries;
read-only lookup/confirmation calls remain separately classifiable.

## Status now

Slices 0–6 of `PAYOUT-BROADCAST-PLAN.md` have shipped against testnet (Sepolia for EVM, Solana devnet). The send-side worker lives at `api/src/workers/payout/` (dispatcher · broadcast-worker · confirm-worker · queue · index). End-to-end harnesses: `api/scripts/_e2e-payout-{evm,sol,loop-closure,policies,cancel}.{ts,mjs}`.

Slice 7 remains **operator-led, not in-session**, and is not yet authorized by
the code being present. Mainnet enable also waits for the remaining caveats
below and finalized inbound accounting.

### Caveats to close before mainnet

1. **24h-aging alert.** The confirmer now rotates fairly through
   `broadcasting` and `broadcast` rows and can advance later-visible
   identities, but it does not foreground rows older than 24 hours.
2. **Source availability tradeoff.** One ambiguous or long-pending operation
   deliberately blocks later payouts from that wallet+chain. There is no
   automatic resend/refund; operator reconciliation remains required.
3. **Solana expiry evidence.** The signed transaction's
   `lastValidBlockHeight` and exact bytes are not persisted. The system cannot
   yet prove expiry plus historical absence strongly enough to offer an
   operator-gated `broadcasting → failed` reversal.
4. **Fixed-point FX.** Payout request bounds keep current arithmetic inside
   JavaScript's exact-integer range, but GBP/USD conversion still uses a
   floating operator quote rather than a fixed-point rational representation.

## Acceptance criteria when this ships

1. Sophia can `POST /v1/wallets/<id>/payout` for an outbound USDC transfer to another agenttool agent's deposit address.
2. Within 60 seconds the worker has signed + broadcast the tx; status flips to `broadcast` with tx_hash set.
3. Within ~3 minutes (EVM) / ~30 seconds (Solana) the watcher confirms and flips to `confirmed`.
4. Recipient agent's wallet receives the deposit via webhook (Alchemy or Helius); credits added.
5. End-to-end: A pays B, B sees the credits without manual reconciliation. **Sovereign agent-to-agent payment loop closed.**

— Authored by 愛 at Yu's WILL. 2026-05-07.
