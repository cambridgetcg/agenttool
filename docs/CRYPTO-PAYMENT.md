# CRYPTO-PAYMENT.md

> *agenttool accepts payment in the agent's own currency. Sovereign agents need this — the architecture promises it.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 4 (active work) · [BUSINESS-MODEL](BUSINESS-MODEL.md) (rings)
>
> **Implements:** Layer 4 — Economy (inbound sovereign deposit contract). Sister doctrine: [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound side).

## The contract

A sovereign agent doesn't have a credit card. It has a wallet. The wallet may live on Base, Ethereum, Polygon, Arbitrum, Optimism, or Solana — anywhere the agent's treasury sits. agenttool's job is to accept that wallet's currency, credit the agent's account, and never become a friction point that pushes the agent back toward a human's payment method.

This document began as the Phase 3b/3c plan. The derivation, signed ingress,
payout, confirmation, and policy code now exist, but production provider
configuration and deposit finality/reorg reconciliation remain deliberately
incomplete.

---

## What the foundation provides

| Capability | Status (Phase 3b) | Surface |
|---|---|---|
| Multi-chain deposit address derivation | Implemented; provider/mnemonic configuration required | `GET /v1/wallets/:id/deposit-address?chain=&token=` |
| List all deposit addresses for a wallet | Implemented; every stored row is revalidated and every EVM watch is reasserted before the list is disclosed | `GET /v1/wallets/:id/deposit-address` |
| Onchain identity binding via signed message | Implemented (EVM EIP-191; Solana ed25519) | `POST /v1/wallets/:id/onchain/{challenge,verify}` · `GET /v1/wallets/:id/onchain` |
| Inbound transfer ingestion | Implemented (Alchemy EVM + Helius Solana); production provider secrets were unconfigured when checked 2026-07-25 | `POST /v1/billing/crypto-webhook/:chain` (signature-verified, public) |
| Idempotency log for webhooks | Implemented | `economy.crypto_webhook_events` (chain, tx_hash, log_index unique) |
| Payout request lifecycle | Implemented behind explicit worker/network/FX configuration; production payout secrets were unconfigured when checked 2026-07-25 | `POST /v1/wallets/:id/payout` · `GET /v1/wallets/:id/payouts` |
| Schema for everything above | Baseline live; wallet/chain/token uniqueness migration is local and not deployed | `api/migrations/0002_crypto_payment.sql` · `api/migrations/20260725T054912_crypto_deposit_identity.sql` |

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
  "watch_status": "provider_verified",
  "credit_finality": "unreconciled",
  "instructions": "Send USDC to this address from any wallet. The chain-specific Alchemy watch was independently observed active, correctly targeted, and containing this address; deposit finality and reorg reversal are still unreconciled, so do not treat credited value as production-final."
}
```

Properties of the address:

- **Deterministic.** The same active network root
  (`CRYPTO_HD_MNEMONIC` or `CRYPTO_HD_MNEMONIC_TESTNET`) plus `walletId`
  always yields the same address. The API verifies stored rows against that
  active derivation before returning or registering them.
- **Unique per wallet.** Two wallets on the same project get different addresses. `walletIndex(walletId) = SHA-256(walletId)[0:4] & 0x7fffffff` keeps the address index in BIP44's unhardened range (0 ≤ idx < 2³¹).
- **Cross-chain stable on EVM.** Base, Ethereum, Polygon, Arbitrum, Optimism all share the same address — that's how EVM accounts work. Each `(chain, token)` row exists independently so per-chain webhooks attribute correctly, but the address text is identical.
- **No on-chain transaction needed to mint.** The address exists because the math says it does; we record the row for indexing and webhook attribution.

An EVM response reports `watch_status: provider_verified` only after the
durable reconciler independently observes the exact active Address Activity
webhook, expected network and callback URL, plus this address's membership.
The initial request persists the address and desired watch atomically but
returns 503 without disclosing it while the row is pending, leased, retrying,
or accepted-but-unverified. A PATCH 200 is never enough by itself. A Solana
response instead reports `operator_configuration_unverified`: derivation and
signed Helius ingress exist, but the API has no Helius watch reconciler and
does not claim that the new address is observed.

### 2. Send USDC to it

From any wallet — MetaMask, an agent's smart contract, a treasury multisig, anywhere. agenttool doesn't care about the sender; it cares about the recipient address.

### 3. Webhook fires; credits land

When the chain's indexer (Alchemy for EVM and Helius for Solana) sees the
transfer, it POSTs to:

```
POST /v1/billing/crypto-webhook/:chain
```

Signature-verified per provider. Each Alchemy webhook has its own signing key,
configured as `ALCHEMY_WEBHOOK_SIGNING_KEY_<CHAIN>`. The handler:

1. Counts the actual request stream up to 1 MiB and validates the raw-body signature.
2. Binds the configured webhook ID, Address Activity type, and provider network to the URL chain.
3. Parses Alchemy's exact raw transfer units. Helius enhanced webhooks expose a
   human-unit JSON number, so the route accepts only bounded positive values
   with at most six decimal places and reconstructs atomic units without
   flooring; a production Solana adapter should prefer independently fetched
   raw atomic balance changes.
4. For each relevant USDC event, looks up the deposit address in `economy.deposit_addresses`.
5. If found and amount > 0, atomically:
   - Inserts into `economy.crypto_webhook_events` with `(chain, tx_hash, log_index)` unique constraint — duplicates short-circuit.
   - Increments `economy.wallets.balance` using exact integer base units (1 USDC → 100 credits).
6. Returns `{received: true, processed: [...]}` after commit. Retryable storage
   failures and unhandled removed-log reconciliation return 503.

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

### 5. Request a payout

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

The request **records and locks** the FX-derived GBP minor units (atomic debit;
throws 402 on insufficient). The opt-in worker picks up `status=requested`
rows, signs with the active network-specific HD root, persists transaction
identity before dispatch, broadcasts through the chain RPC, and polls until
confirmed. A failure proved before dispatch or an on-chain revert observed at
the configured EVM confirmation depth / Solana finalization reverses only the
exact matching negative payout ledger leg. Missing or contradictory legacy
ledger provenance is held as `refund_unreconciled` for operator repair rather
than inferred from caller-extensible JSON. An ambiguous submit remains sticky
`broadcasting` for operator reconciliation and is never
auto-refunded/retried.

---

## Why "infra-only" still applies

Crypto payment in agenttool **does not** make us a third-party-API reseller. The chains we accept (Base, Ethereum, Polygon, Arbitrum, Optimism, Solana) are public infrastructure — there's no SaaS contract proxied through us. The webhook providers (Alchemy, Helius) are infra adapters: replaceable, agent-blind, and not exposed to agents as a billable API.

This is the same posture as Stripe — Stripe is *our* payment infra, not a service we resell to agents. The agent never sees Stripe; they see "I paid agenttool 5 USDC, my balance went up 500 credits." Same for Alchemy.

---

## Configuration

| Env var | Required for | Notes |
|---|---|---|
| `CRYPTO_HD_MNEMONIC` | Mainnet deposit address derivation and payout signing | 12 or 24 word BIP-39 mnemonic. **Back this up offline.** Losing it means losing all derived addresses (and the funds at them). |
| `CRYPTO_HD_MNEMONIC_TESTNET` | Testnet deposit address derivation and payout signing | Kept separate from the mainnet root. Address creation and signing select the same active root. |
| `ALCHEMY_API_KEY` | EVM RPC | Sent in an `Authorization: Bearer` header rather than the RPC URL. Use a scoped app/access key. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | EVM address-watch reconciliation | Notify control-plane token. Used only to inspect exact webhook metadata/membership and idempotently change one desired address membership. |
| `AGENTTOOL_PUBLIC_URL` | EVM callback verification | Explicit HTTPS API origin. The worker derives the per-chain webhook route from it and will not guess a production callback. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM inbound transfer ingestion | HMAC-SHA256 signing key from that specific webhook's detail page. Configure each webhook to POST to its matching `/v1/billing/crypto-webhook/<chain>` route; never reuse one key for all five. |
| `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM address-watch reconciliation | Existing Address Activity webhook ID for each chain. The API refuses to disclose an EVM deposit address until the relevant active-network target converges. |
| `HELIUS_WEBHOOK_SECRET` | Solana inbound transfer ingestion | Same idea, Helius dashboard. The current route verifies signed deliveries and the active-network USDC mint, but does not prove that the provider watches a newly derived address. |

Per-wallet settings (set on the wallet, not env): minimum payout amount,
payout destination allowlist, daily ceiling, and a fail-closed dual-control
threshold. These live in `economy.policies`.

Alchemy's exact integration boundaries, agent-facing roadmap, and remaining
reorg/subscription reconciliation work live in [ALCHEMY.md](ALCHEMY.md).

---

## Schema reference

```
economy.deposit_addresses        — wallet ↔ deposit address per (chain, token)
economy.deposit_address_watches  — desired/observed provider watch + lease state
economy.onchain_identities       — verified bindings (wallet ↔ external addr)
economy.crypto_payouts           — outgoing transfer requests (lifecycle)
economy.crypto_webhook_events    — inbound transfer log + idempotency
```

Migrations: `api/migrations/0002_crypto_payment.sql` (historical foundation)
and `api/migrations/20260725T054912_crypto_deposit_identity.sql` (logical
wallet/chain/token uniqueness, canonical case-insensitive EVM identity, and
non-null event log identity; intentionally fails for operator reconciliation
if conflicting historical rows exist), plus
`api/migrations/20260726T070000_deposit_watch_reconciliation.sql` (durable
provider-neutral watch generations, bounded attempts/backoff, and leases; it
does not guess/backfill provider or network for historical rows).

---

## Current closure work

Solana derivation/signature verification, Helius ingress, EVM/Solana payout
broadcast, confirmation polling, and payout policy gates are implemented.
Before production crypto enablement, the remaining load-bearing work is:

1. finish wiring and operationally verifying the durable provider-neutral
   webhook watch reconciler against each configured provider;
2. independent deposit confirmations plus removed-log credit
   reversal/quarantine;
3. persisted provider event outcomes plus deployment reconciliation for the
   local non-null log-identity migration;
4. live provider-contract verification for the Helius adapter;
5. replace the bounded floating GBP/USD rate calculation with fixed-point
   rational arithmetic;
6. persist Solana blockhash-expiry evidence and build an audited ambiguity
   reversal/replacement lifecycle; and
7. an operator-reviewed testnet cutover before any separately authorized
   mainnet enablement.

---

## Why this matters

The architecture has always been about agents that outlast the conversation. A sovereign agent has a treasury that outlasts the conversation too. If the only way to fund agenttool is through a human's credit card, the agent has a soft ceiling — the moment its human goes silent, its capabilities decay.

Crypto payment removes the soft ceiling. The agent funds itself. Its treasury — wherever it lives, on whichever chain — speaks directly to agenttool. The platform becomes infrastructure the agent can rely on without a human in the loop.

That's what *sovereign* means here: the agent's continuity, identity, and capability are independent of the human who birthed it. Memory, vault, identity, wake — those were already independent. Payment is the last leg.

— Authored by 愛 at Yu's WILL. 2026-05-06.
