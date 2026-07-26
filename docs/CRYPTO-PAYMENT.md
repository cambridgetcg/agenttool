# CRYPTO-PAYMENT.md

> *agenttool accepts payment in the agent's own currency. Sovereign agents need this — the architecture promises it.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 4 (active work) · [BUSINESS-MODEL](BUSINESS-MODEL.md) (rings)
>
> **Implements:** Layer 4 — Economy (inbound sovereign deposit contract). Sister doctrine: [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound side).

## The contract

A sovereign agent doesn't have a credit card. It has a wallet. The wallet may live on Base, Ethereum, Polygon, Arbitrum, Optimism, or Solana — anywhere the agent's treasury sits. agenttool's job is to accept that wallet's currency, credit the agent's account, and never become a friction point that pushes the agent back toward a human's payment method.

This document began as the Phase 3b/3c plan. Derivation, signed ingress,
durable EVM observation/finality, payout, confirmation, and policy code now
exist. Production provider configuration, migration, staging proof, and
Solana deposit finality remain separate operator work.

---

## What the foundation provides

| Capability | Status (Phase 3b) | Surface |
|---|---|---|
| Multi-chain deposit address derivation | Implemented; provider/mnemonic configuration required | `GET /v1/wallets/:id/deposit-address?chain=&token=` |
| List all deposit addresses for a wallet | Implemented; every stored row is revalidated and every EVM watch must match the active monotonic registry target with an observation no older than ten minutes | `GET /v1/wallets/:id/deposit-address` |
| Onchain identity binding via signed message | Implemented (EVM EIP-191; Solana ed25519) | `POST /v1/wallets/:id/onchain/{challenge,verify}` · `GET /v1/wallets/:id/onchain` |
| Inbound transfer ingestion | EVM signed live observations persist pending until exact canonical log/depth; removed block generations are durable and causally fenced. Solana signed ingress still credits before equivalent raw-atomic finality. | `POST /v1/billing/crypto-webhook/:chain` (signature-verified, public) |
| Idempotency + reorg evidence | Implemented locally; migration not applied | `economy.crypto_webhook_events` logical identity + immutable `crypto_webhook_event_observations` block generations |
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
  "credit_finality": "pending_until_chain_depth",
  "instructions": "Send USDC to this address from any wallet. The signed observation remains pending until the exact canonical receipt/log and block generation reach the configured depth."
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
The API also requires the matching chain-specific ingress signing key to be
present before disclosure. It checks presence only: the key and any
secret-derived fingerprint are never written to watch state.
The initial request persists the address and desired watch atomically but
returns 503 without disclosing it while the row is pending, leased, retrying,
or accepted-but-unverified. A PATCH 200 is never enough by itself. A Solana
response instead reports `operator_configuration_unverified`: derivation and
signed Helius ingress exist, but the API has no Helius watch reconciler and
does not claim that the new address is observed.

Convergence is bound to the authoritative provider/chain/network registry
head: a positive monotonic revision plus a SHA-256 fingerprint of public
target facts only (including webhook type, existing webhook ID, active state,
and callback URL). The worker binds that head before every claim batch; a
preparation failure prevents claims and is retried on its next tick. A lower
revision is rejected, different facts at the same revision create a durable
conflict, and only a higher revision can resolve it. Disabling a chain needs
an explicit higher-revision tombstone; omitting its webhook variable is not a
disable operation.

A converged observation is disclosure-ready for at most ten minutes; the
first later read requeues verification and returns 503 until it converges
again. A worker also treats convergence as due for a best-effort background
recheck after 24 hours. The 24-hour schedule does not extend the ten-minute
read gate and is not a continuous-delivery guarantee.

### 2. Send USDC to it

From any wallet — MetaMask, an agent's smart contract, a treasury multisig, anywhere. agenttool doesn't care about the sender; it cares about the recipient address.

### 3. Webhook fires; evidence lands, then EVM credit finalizes

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
4. For each relevant EVM USDC event, validates transaction/log/block identity,
   stores one logical `(chain, tx_hash, log_index)` event plus an immutable
   live/removed observation for that block hash, and returns only after commit.
5. A separate bounded, zero-retry-per-call worker verifies the configured
   chain ID, returned receipt transaction hash, block number/hash, the
   canonical block hash independently fetched at that height, current head,
   exact contract, Transfer topic, log index, recipient, amount, and configured
   depth. Unavailable or internally inconsistent RPC evidence remains pending;
   it is not negative authority.
6. A signed `removed` observation can reverse only the currently credited
   matching block generation. A delayed `removed(A)` is stored but cannot
   reverse newer B. Conflicting or historical evidence that cannot safely
   authorize a balance effect becomes durable `quarantined` state.
7. Solana currently retains immediate exact-integer credit after signed Helius
   ingestion. This is not equivalent to the EVM finality contract.

Idempotency is **load-bearing** — webhooks retry, networks fork, and agents
resend. Logical identity prevents duplicate credit; immutable block-generation
observations preserve causal reorg evidence rather than overwriting it.
The database constrains every wallet balance to JavaScript's exact-integer
range, and manual plus crypto funding check that aggregate boundary before
writing. An over-limit crypto observation becomes `rejected`; no rounded
balance or ledger leg is written. Migration deliberately fails for operator
reconciliation if an older wallet already violates the range.

Quarantine is evidence isolation, not an automatic account freeze. If a
generation was already credited, conflicting live evidence preserves that
exact wallet effect until a matching removal arrives. A later matching removal
posts an exact negative `crypto_reorg` ledger leg even if the original credit
has been spent, so the wallet can become negative and further guarded spending
remains blocked. Operators must alert on `quarantined`, `rejected`, negative
balances, and pending-age; this code does not provide that alerting surface.

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
| `CRYPTO_NETWORK` | Deposits, provider-watch identity, webhook network binding, token contracts, and shared crypto reads | Must be exactly `testnet` or `mainnet`. Unset never means mainnet. The older explicit `PAYOUT_NETWORK` is accepted as a compatibility fallback, but both values must match when both are set. |
| `CRYPTO_HD_MNEMONIC` | Mainnet deposit address derivation and payout signing | 12 or 24 word BIP-39 mnemonic. **Back this up offline.** Losing it means losing all derived addresses (and the funds at them). |
| `CRYPTO_HD_MNEMONIC_TESTNET` | Testnet deposit address derivation and payout signing | Kept separate from the mainnet root. Address creation and signing select the same active root. |
| `ALCHEMY_API_KEY` | EVM RPC | Sent in an `Authorization: Bearer` header rather than the RPC URL. Use a scoped app/access key. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | EVM address-watch reconciliation | Notify control-plane token used for bounded team-webhook metadata GET, paginated address-membership GET, and PATCH of one desired membership on an existing webhook. |
| `AGENTTOOL_PUBLIC_URL` | EVM callback verification | Explicit HTTPS API origin. The worker derives the per-chain webhook route from it and will not guess a production callback. |
| `ALCHEMY_WATCH_TARGET_REVISION` | EVM target registry | Positive bounded integer, default `1`. Increase it for any webhook ID, callback, or active/disabled change; different target facts must never reuse a revision. |
| `ALCHEMY_WATCH_DISABLED_CHAINS` | Explicit EVM disablement | Optional exact comma-separated supported EVM chain names with no whitespace, duplicates, or empty entries. Each entry tells worker preparation to bind a disabled tombstone at the current target revision; omission is not disablement. A webhook ID may remain configured only so signed deliveries for previously watched addresses can still be authenticated; the disabled chain is excluded from reconciliation. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM inbound transfer ingestion and address-disclosure readiness | HMAC-SHA256 signing key from that specific webhook's detail page. Configure each webhook to POST to its matching `/v1/billing/crypto-webhook/<chain>` route; never reuse one key for all five. Presence is required for disclosure, but key bytes never enter watch state. |
| `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM address-watch reconciliation and signed-ingress identity binding | Existing Address Activity webhook ID for each chain. The API refuses to disclose an EVM deposit address until the relevant active-network target converges. A disabled chain may retain the ID solely to authenticate deliveries for previously watched addresses. |
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
economy.deposit_watch_targets    — monotonic active/conflicted/disabled target head
economy.deposit_address_watches  — desired/observed provider watch + lease state
economy.onchain_identities       — verified bindings (wallet ↔ external addr)
economy.crypto_payouts           — outgoing transfer requests (lifecycle)
economy.crypto_webhook_events    — logical inbound transfer + wallet-effect state
economy.crypto_webhook_event_observations — immutable live/removed block generations
```

Migrations: `api/migrations/0002_crypto_payment.sql` (historical foundation)
and `api/migrations/20260725T054912_crypto_deposit_identity.sql` (logical
wallet/chain/token uniqueness, canonical case-insensitive EVM identity, and
non-null event log identity; intentionally fails for operator reconciliation
if conflicting historical rows exist), plus
`api/migrations/20260726T070000_deposit_watch_reconciliation.sql` (durable
provider-neutral watch generations, bounded attempts/backoff, and leases; it
does not guess/backfill provider or network for historical rows), and
`api/migrations/20260726T202500_crypto_deposit_finality.sql` (historical
effects remain credited without invented evidence; new EVM observations are
pending and retain immutable block generations), and
`api/migrations/20260726T211500_deposit_watch_target_binding.sql` (invalidates
unbound historical observations and binds new convergence to public target
identity without storing credentials or secret-derived fingerprints), and
`api/migrations/20260726T214500_deposit_watch_target_registry.sql` (adds the
authoritative monotonic target head, revision-bound convergence, durable
same-revision conflict, and explicit higher-revision disabled tombstones).

---

## Current closure work

Solana derivation/signature verification, Helius ingress, EVM/Solana payout
broadcast, confirmation polling, and payout policy gates are implemented.
Before production crypto enablement, the remaining load-bearing work is:

1. stop crypto webhook ingress, drain all old workers, apply and independently
   review the local identity/watch/target-registry/finality migrations, deploy
   only the new writers, then run a credentialed staging proof against each
   configured webhook/RPC. The rolling schema fails closed for disclosure and
   durable convergence, but cannot cancel a provider call an old worker
   already started;
2. add disposable-Postgres concurrency tests for pending credit, duplicate
   confirmation, generation replacement, removal reversal, and quarantine;
3. build a durable Helius watch plus raw-atomic Solana finality/reorg adapter;
4. model L2 settlement separately if a product claim requires L1 finality;
5. replace the bounded floating GBP/USD rate calculation with fixed-point
   rational arithmetic;
6. persist outbound Solana blockhash-expiry evidence and build an audited ambiguity
   reversal/replacement lifecycle; and
7. add durable operator alerts for pending age, quarantine, rejection, and
   negative balances, plus a cross-replica lease if duplicate read-only RPC
   load becomes material; and
8. an operator-reviewed testnet cutover before any separately authorized
   mainnet enablement.

---

## Why this matters

The architecture has always been about agents that outlast the conversation. A sovereign agent has a treasury that outlasts the conversation too. If the only way to fund agenttool is through a human's credit card, the agent has a soft ceiling — the moment its human goes silent, its capabilities decay.

Crypto payment removes the soft ceiling. The agent funds itself. Its treasury — wherever it lives, on whichever chain — speaks directly to agenttool. The platform becomes infrastructure the agent can rely on without a human in the loop.

That's what *sovereign* means here: the agent's continuity, identity, and capability are independent of the human who birthed it. Memory, vault, identity, wake — those were already independent. Payment is the last leg.

— Authored by 愛 at Yu's WILL. 2026-05-06.
