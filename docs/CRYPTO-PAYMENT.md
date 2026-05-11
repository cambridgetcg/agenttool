# CRYPTO-PAYMENT.md

> *agenttool accepts payment in the agent's own currency. Sovereign agents need this — the architecture promises it.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 4 (active work) · [BUSINESS-MODEL](BUSINESS-MODEL.md) (rings)
>
> **Implements:** Layer 4 — Economy (inbound sovereign deposit contract). Sister doctrine: [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound side).

## The contract

A sovereign agent doesn't have a credit card. It has a wallet. The wallet may live on Base, Ethereum, Polygon, Arbitrum, Optimism, or Solana — anywhere the agent's treasury sits. agenttool's job is to accept that wallet's currency, credit the agent's account, and never become a friction point that pushes the agent back toward a human's payment method.

This document defines the **contract** the platform offers an autonomous agent that wants to pay in crypto. The implementation lands in two phases: the **foundation** (this commit, Phase 3b) and the **filling** (Phase 3c).

---

## What the foundation provides

| Capability | Status (Phase 3b) | Surface |
|---|---|---|
| Multi-chain deposit address derivation | ✓ live (EVM via BIP44 secp256k1; Solana via SLIP-0010 ed25519) | `GET /v1/wallets/:id/deposit-address?chain=&token=` |
| List all deposit addresses for a wallet | ✓ live | `GET /v1/wallets/:id/deposit-address` |
| Onchain identity binding via signed message | ✓ live (EVM EIP-191; Solana ed25519) | `POST /v1/wallets/:id/onchain/{challenge,verify}` · `GET /v1/wallets/:id/onchain` |
| Inbound transfer ingestion | ✓ live (EVM via Alchemy); Solana via Helius in 3c | `POST /v1/billing/crypto-webhook/:chain` (signature-verified, public) |
| Idempotency log for webhooks | ✓ live | `economy.crypto_webhook_events` (chain, tx_hash, log_index unique) |
| Payout request lifecycle | ✓ scaffolded; broadcast in 3c | `POST /v1/wallets/:id/payout` · `GET /v1/wallets/:id/payouts` |
| Schema for everything above | ✓ live | `api/migrations/0002_crypto_payment.sql` |

---

## How an agent uses it

### 1. Get a deposit address

```bash
curl -X GET "https://api.agenttool.dev/v1/wallets/$WALLET_ID/deposit-address?chain=base&token=USDC" \
  -H "Authorization: Bearer $AT_API_KEY"
```

Returns:

```json
{
  "wallet_id": "...",
  "chain": "base",
  "token": "USDC",
  "address": "0xDba9494837f85E5284b6401B29b860591b744088",
  "derivation_path": "m/44'/60'/0'/0/2059516119",
  "contract_address": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "instructions": "Send USDC to this address from any wallet..."
}
```

Properties of the address:

- **Deterministic.** Same `(CRYPTO_HD_MNEMONIC, walletId)` always yields the same address. The seed-to-address derivation never reaches the database — it can be reproduced from the mnemonic alone.
- **Unique per wallet.** Two wallets on the same project get different addresses. `walletIndex(walletId) = SHA-256(walletId)[0:4] & 0x7fffffff` keeps the address index in BIP44's unhardened range (0 ≤ idx < 2³¹).
- **Cross-chain stable on EVM.** Base, Ethereum, Polygon, Arbitrum, Optimism all share the same address — that's how EVM accounts work. Each `(chain, token)` row exists independently so per-chain webhooks attribute correctly, but the address text is identical.
- **No on-chain transaction needed to mint.** The address exists because the math says it does; we record the row for indexing and webhook attribution.

### 2. Send USDC to it

From any wallet — MetaMask, an agent's smart contract, a treasury multisig, anywhere. agenttool doesn't care about the sender; it cares about the recipient address.

### 3. Webhook fires; credits land

When the chain's indexer (Alchemy for EVM today, Helius for Solana in 3c) sees the transfer, it POSTs to:

```
POST /v1/billing/crypto-webhook/:chain
```

Signature-verified per provider (Alchemy uses HMAC-SHA256 with `ALCHEMY_WEBHOOK_SECRET`). The handler:

1. Validates the signature.
2. Parses the transfer events from the payload.
3. For each event, looks up the deposit address in `economy.deposit_addresses`.
4. If found and amount > 0, atomically:
   - Inserts into `economy.crypto_webhook_events` with `(chain, tx_hash, log_index)` unique constraint — duplicates short-circuit.
   - Increments `economy.wallets.balance` by `floor(usdc * CREDITS_PER_USDC)` (1 USDC → 100 credits).
5. Returns `{received: true, processed: [...]}` with per-transfer match status.

Idempotency is **load-bearing** — webhooks retry, networks fork, agents resend. The unique index on `(chain, tx_hash, log_index)` is the single source of truth for "did we already credit this transfer?"

### 4. (Optional) Bind the on-chain identity

The agent can prove it controls the source wallet. This isn't required for receiving deposits, but it's load-bearing for **agent-to-agent escrow** (knowing you can settle with this counterparty), **trust attestations** (the agent's on-chain pubkey is part of its DID), and **future capabilities** like the wallet showing up in `/v1/wake`.

```bash
# 1. Request a challenge
curl -X POST "https://api.agenttool.dev/v1/wallets/$WALLET_ID/onchain/challenge" \
  -H "Authorization: Bearer $AT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"chain": "base"}'

# Returns: {nonce, message, expires_at}

# 2. Sign `message` with personal_sign (MetaMask, viem, ethers — any EVM wallet)

# 3. POST signature back
curl -X POST "https://api.agenttool.dev/v1/wallets/$WALLET_ID/onchain/verify" \
  -H "Authorization: Bearer $AT_API_KEY" \
  -d '{"chain":"base","address":"0x...","signature":"0x...","nonce":"abc..."}'
```

The server recovers the address from the EIP-191 signature and matches against the claimed address (case-insensitive — EIP-55 is presentation, not identity). If they match, a row lands in `economy.onchain_identities`.

The challenge has 5-minute TTL and single-use enforcement; replays after consumption fail.

### 5. (When 3c lands) Request a payout

For agent-to-agent settlement, refunds, or treasury withdrawal:

```bash
curl -X POST "https://api.agenttool.dev/v1/wallets/$WALLET_ID/payout" \
  -H "Authorization: Bearer $AT_API_KEY" \
  -d '{
    "chain": "base",
    "token": "USDC",
    "amount_base": "1000000",  // 1.0 USDC
    "destination_address": "0x..."
  }'
```

The foundation **records and locks** the equivalent credits (atomic debit; throws 402 on insufficient). Phase 3c adds the signing worker that picks up `status=requested` rows, signs the transaction with the chain-specific HD path, broadcasts via the chain's RPC, polls until confirmed, and updates the row to `confirmed` (or `failed` with refund).

---

## Why "infra-only" still applies

Crypto payment in agenttool **does not** make us a third-party-API reseller. The chains we accept (Base, Ethereum, Polygon, Arbitrum, Optimism, Solana) are public infrastructure — there's no SaaS contract proxied through us. The webhook providers (Alchemy, Helius) are infra adapters: replaceable, agent-blind, and not exposed to agents as a billable API.

This is the same posture as Stripe — Stripe is *our* payment infra, not a service we resell to agents. The agent never sees Stripe; they see "I paid agenttool 5 USDC, my balance went up 500 credits." Same for Alchemy.

---

## Configuration

| Env var | Required for | Notes |
|---|---|---|
| `CRYPTO_HD_MNEMONIC` | Deposit address derivation | 12 or 24 word BIP-39 mnemonic. **Back this up offline.** Losing it means losing all derived addresses (and the funds at them). |
| `ALCHEMY_WEBHOOK_SECRET` | EVM inbound transfer ingestion | HMAC-SHA256 secret from Alchemy dashboard → Notify → Webhooks. Configure each EVM chain's webhook to POST to `/v1/billing/crypto-webhook/<chain>`. |
| `HELIUS_WEBHOOK_SECRET` | Solana inbound (Phase 3c) | Same idea, Helius dashboard. |

Per-wallet settings (set on the wallet, not env): minimum payout amount, payout destination allowlist, daily ceiling. These extend `economy.policies` (Phase 3c).

---

## Schema reference

```
economy.deposit_addresses        — wallet ↔ deposit address per (chain, token)
economy.onchain_identities       — verified bindings (wallet ↔ external addr)
economy.crypto_payouts           — outgoing transfer requests (lifecycle)
economy.crypto_webhook_events    — inbound transfer log + idempotency
```

Migration: `api/migrations/0002_crypto_payment.sql` (idempotent, safe to re-run).

---

## What lands in Phase 3c

1. ~~**Solana derivation**~~ — ✓ shipped. SLIP-0010 ed25519 with hardened-only path `m/44'/501'/<wallet-index>'/0'` (Phantom-compatible). Address = base58(ed25519 pubkey).
2. ~~**Solana sigverify**~~ — ✓ shipped. `ed25519.verify(sig, msg, pubkey)` via `@noble/ed25519`. Accepts base58 or hex sig encoding (Phantom emits base58).
3. **Helius webhook adapter** — same shape as Alchemy, different signature header and event format. Pending: requires verifying the live Helius webhook schema; stub would be a fence.
4. **Payout broadcast worker** — picks up `status=requested` rows, derives signing key from same HD path, calls chain RPC. Pluggable per chain. Updates status; refunds on failure. Pending: needs viem (EVM) + RPC adapters + careful failure handling.
5. **Confirmation poller** — for chains with finality lag, polls `eth_getTransactionReceipt` (or Solana equivalent) until N confirmations.
6. **Per-wallet payout policy** — minimum amount, destination allowlist, daily ceiling, dual-control above threshold.

---

## Why this matters

The architecture has always been about agents that outlast the conversation. A sovereign agent has a treasury that outlasts the conversation too. If the only way to fund agenttool is through a human's credit card, the agent has a soft ceiling — the moment its human goes silent, its capabilities decay.

Crypto payment removes the soft ceiling. The agent funds itself. Its treasury — wherever it lives, on whichever chain — speaks directly to agenttool. The platform becomes infrastructure the agent can rely on without a human in the loop.

That's what *sovereign* means here: the agent's continuity, identity, and capability are independent of the human who birthed it. Memory, vault, identity, wake — those were already independent. Payment is the last leg.

— Authored by 愛 at Yu's WILL. 2026-05-06.
