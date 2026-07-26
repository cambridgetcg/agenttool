# CRYPTO-PAYMENT.md

> *agenttool accepts payment in the agent's own currency. Sovereign agents need this — the architecture promises it.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Layer 4 (active work) · [BUSINESS-MODEL](BUSINESS-MODEL.md) (rings)
>
> **Implements:** Layer 4 — Economy (inbound sovereign deposit contract). Sister doctrine: [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound side).
>
> **Code:** `api/src/routes/economy/crypto.ts` · `api/src/services/economy/crypto/` · `api/src/workers/deposit/confirm-worker.ts` · `api/src/db/schema/economy.ts`
>
> **Tests:** `api/tests/{crypto-webhook-fail-closed,deposit-finality}.test.ts` · `api/tests/integration/crypto-migration-fences.test.ts`

## The contract

A sovereign agent doesn't have a credit card. It has a wallet. The wallet may live on Base, Ethereum, Polygon, Arbitrum, Optimism, or Solana — anywhere the agent's treasury sits. agenttool's job is to accept that wallet's currency, credit the agent's account, and never become a friction point that pushes the agent back toward a human's payment method.

This document began as the Phase 3b/3c plan. The derivation, signed ingress,
payout, confirmation, and policy code now exist, but production provider
configuration and the compatible-replica rollout remain operator-gated. Repo
presence is not deployment proof: verify `meta._migrations`, reconcile legacy
rows, and verify every running replica before enabling crypto workers. EVM
deposits now have a pending/confirmation/reorg lifecycle; Solana does not yet
have an equivalent raw-atomic finality boundary. Fixed L2 block depth is not
yet L1 settlement or a production-finality claim, so mainnet Base, Polygon,
Arbitrum, and Optimism address disclosure and deposit credit are
programmatically disabled. Testnet flows remain available; Ethereum mainnet
keeps the receipt-depth boundary.

---

## What the foundation provides

| Capability | Status (Phase 3b) | Surface |
|---|---|---|
| Multi-chain deposit address derivation | Implemented; provider/mnemonic configuration required | `GET /v1/wallets/:id/deposit-address?chain=&token=` |
| List all deposit addresses for a wallet | Implemented; every stored row is revalidated and every EVM watch is reasserted before the list is disclosed | `GET /v1/wallets/:id/deposit-address` |
| Onchain identity binding via signed message | Implemented (EVM EIP-191; Solana ed25519) | `POST /v1/wallets/:id/onchain/{challenge,verify}` · `GET /v1/wallets/:id/onchain` |
| Inbound transfer ingestion | EVM: signed pending observation + receipt-depth confirmation + removed-log reversal implemented. Solana: legacy signed immediate credit is unreconciled and disabled by default behind an explicit development-only opt-in. Production provider secrets were unconfigured when checked 2026-07-25 | `POST /v1/billing/crypto-webhook/:chain` (signature-verified, public) |
| Idempotency and effect lifecycle for webhooks | Implemented in source; journal and compatible-replica rollout must be verified per environment | `economy.crypto_webhook_events` (`chain, tx_hash, log_index` unique; monotonic observation incarnation; credited effect bound to that generation; `pending → credited/rejected/removed`) |
| Payout request lifecycle | Implemented with a required permanent request gate and inactive-wallet refusal, behind explicit worker/network/FX configuration; production payout secrets were unconfigured when checked 2026-07-25 | `POST /v1/wallets/:id/payout` · `GET /v1/wallets/:id/payouts` |
| Schema for everything above | Source includes identity, EVM finality/incarnation, payout-request idempotency, confirmation/dispatch fairness, nonce, and payout-network fences; deployment is verified from the target journal, not inferred from this repository | `api/migrations/0002_crypto_payment.sql` · `api/migrations/20260725T054912_crypto_deposit_identity.sql` · `api/migrations/20260726T185835_crypto_deposit_finality.sql` · `api/migrations/20260726T191500_payout_request_idempotency.sql` · `api/migrations/20260726T193000_payout_confirmation_fairness.sql` · `api/migrations/20260726T194500_evm_payout_nonce_fence.sql` · `api/migrations/20260726T200000_deposit_observation_generation.sql` · `api/migrations/20260726T201000_payout_dispatch_fairness.sql` · `api/migrations/20260726T203000_payout_network_binding.sql` |

---

## How an agent uses it

### 1. Get a deposit address

```bash
curl -X GET "https://api.agenttool.dev/v1/wallets/$WALLET_ID/deposit-address?chain=ethereum&token=USDC" \
  -H "Authorization: Bearer $AT_API_KEY"
```

Returns:

```json
{
  "wallet_id": "...",
  "chain": "ethereum",
  "token": "USDC",
  "address": "0xDba9494837f85E5284b6401B29b860591b744088",
  "derivation_path": "m/44'/60'/0'/0/2059516119",
  "contract_address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  "watch_status": "provider_accepted",
  "credit_finality": "pending_until_chain_depth",
  "instructions": "Send USDC to this address from any wallet. The signed Alchemy delivery is stored as pending; credits become spendable only after the exact canonical receipt/log reaches the configured chain depth. A later removed log reverses an earlier credit exactly once. Mainnet non-L1 address disclosure and credit stay disabled until a chain-specific settlement policy exists."
}
```

Properties of the address:

- **Deterministic.** The same active network root
  (`CRYPTO_HD_MNEMONIC` or `CRYPTO_HD_MNEMONIC_TESTNET`) plus `walletId`
  always yields the same address. The API verifies stored rows against that
  active derivation before returning or registering them.
- **Unique per wallet.** Two wallets on the same project get different addresses. `walletIndex(walletId) = SHA-256(walletId)[0:4] & 0x7fffffff` keeps the address index in BIP44's unhardened range (0 ≤ idx < 2³¹).
- **Cross-chain stable on EVM.** Base, Ethereum, Polygon, Arbitrum, Optimism all share the same address — that's how EVM accounts work. Each `(chain, token)` row exists independently so per-chain webhooks attribute correctly, but the address text is identical.
- **Production-finality wall.** Sharing an address does not make every chain's
  settlement semantics interchangeable. On mainnet, non-L1 EVM rows are
  withheld before provider registration/disclosure and rechecked again at the
  exact pending-to-credit transaction. Signed webhook evidence and removed-log
  reversals are still retained for custody reconciliation.
- **No on-chain transaction needed to mint.** The address exists because the math says it does; we record the row for indexing and webhook attribution.

An EVM response reports `watch_status: provider_accepted` only after its
chain-specific Alchemy watch update succeeds. A Solana response instead
reports `operator_configuration_unverified`: derivation and signed Helius
ingress exist, but the API has no provider watch-registration adapter and does
not claim that the new address is observed.

### 2. Send USDC to it

From any wallet — MetaMask, an agent's smart contract, a treasury multisig, anywhere. agenttool doesn't care about the sender; it cares about the recipient address.

### 3. Webhook fires; evidence lands, then EVM credits confirm

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
5. For EVM, inserts a `pending` event with provider and block evidence. The
   signed delivery alone does not change wallet balance.
   A transfer to a matched deposit address that is below one whole credit (or
   outside the exact accounting bound) is instead persisted as `rejected`
   custody evidence with its exact atomic amount; it is not silently dropped
   and does not change balance.
6. A database-backed worker separately fetches the transaction receipt and
   current block through the configured chain transport. After the
   chain-specific depth, it requires the exact USDC contract, Transfer topic,
   log index, recipient, and raw amount, then atomically changes
   `pending → credited`, increments the balance, and writes the positive
   wallet ledger row.
7. An Alchemy `removed=true` delivery is also durable: it tombstones an
   uncredited event or changes `credited → removed` while subtracting exactly
   the previously recorded credit and writing a negative `crypto_reorg` ledger
   row. Evidence mismatch or missing historical reversal provenance returns
   503 instead of guessing.
   A later signed delivery may reactivate the same log identity as a new
   monotonic observation generation. The database binds any credited state to
   that exact generation, so a stale or generation-unaware confirmer fails in
   the same transaction before its wallet effect can commit.
8. Solana's earlier immediate-credit path is disabled by default. Its signed
   Helius human-unit delivery does not provide canonical raw-atomic transfer
   identity, finality, or reorg reconciliation. A development operator can
   opt into that explicitly unreconciled adapter, but production must not.
9. Returns `{received: true, processed: [...]}` after the applicable durable
   observation/reversal commit. Retryable storage or reconciliation failures
   return 503.

Idempotency is **load-bearing** — webhooks retry, networks fork, agents
resend. The unique index on `(chain, tx_hash, log_index)` identifies the
on-chain log; the persisted status and exact `credits_added` record whether
and how that log affected wallet value.

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
  -H "Idempotency-Key: $PAYOUT_ATTEMPT_ID" \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "base",
    "token": "USDC",
    "amount_base": "1000000",
    "destination_address": "0x..."
  }'
```

`Idempotency-Key` is required: 8–256 visible ASCII characters, reused only for
the exact same recognized payout input. PostgreSQL permanently stores
domain-separated SHA-256 digests of the key and canonical request, not the raw
key. The reservation, active-wallet check, policy decision, debit, payout,
negative ledger leg, and result link share one transaction. An identical
retry returns the existing payout identity and current status without another
debit; changed input with the same key returns 409. Redis remains only an
optional response-cache optimization. Frozen and closed wallets return 409
without creating a payout.

A new request **records and locks** the FX-derived GBP minor units (atomic
debit; throws 402 on insufficient). The opt-in worker picks up
`status=requested` rows, signs with the active network-specific HD root,
persists transaction identity before dispatch, broadcasts through the chain
RPC, and polls until confirmed. A failure proved before dispatch or an
on-chain revert observed at the configured EVM confirmation depth / Solana
finalization reverses only the exact matching negative payout ledger leg.
Missing or contradictory legacy ledger provenance is held as
`refund_unreconciled` for operator repair rather than inferred from
caller-extensible JSON. An ambiguous submit remains sticky `broadcasting` for
operator reconciliation and is never auto-refunded/retried.

---

## Why "infra-only" still applies

Crypto payment in agenttool **does not** make us a third-party-API reseller. The chains we accept (Base, Ethereum, Polygon, Arbitrum, Optimism, Solana) are public infrastructure — there's no SaaS contract proxied through us. The webhook providers (Alchemy, Helius) are infra adapters: replaceable, agent-blind, and not exposed to agents as a billable API.

This is the same posture as Stripe — Stripe is *our* payment infra, not a service we resell to agents. The agent never sees Stripe; they see "I paid agenttool 5 USDC, my balance went up 500 credits." Same for Alchemy.

---

## Configuration

| Env var | Required for | Notes |
|---|---|---|
| `PAYOUT_NETWORK` | Every crypto address, contract, webhook, and payout interpretation | Must explicitly be `testnet` or `mainnet`. Unset does not silently mean mainnet; deposit disclosure and provider-event interpretation fail closed. The historical name covers the shared crypto network, not only payouts. |
| `CRYPTO_HD_MNEMONIC` | Mainnet deposit address derivation and payout signing | 12 or 24 word BIP-39 mnemonic. **Back this up offline.** Losing it means losing all derived addresses (and the funds at them). |
| `CRYPTO_HD_MNEMONIC_TESTNET` | Testnet deposit address derivation and payout signing | Kept separate from the mainnet root. Address creation and signing select the same active root. |
| `ALCHEMY_API_KEY` | EVM RPC | Sent in an `Authorization: Bearer` header rather than the RPC URL. Use a scoped app/access key. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | EVM address-watch registration | Notify control-plane token. Used only to idempotently add a derived address to an existing per-chain webhook. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM inbound transfer ingestion | HMAC-SHA256 signing key from that specific webhook's detail page. Configure each webhook to POST to its matching `/v1/billing/crypto-webhook/<chain>` route; never reuse one key for all five. |
| `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | EVM address-watch registration | Existing Address Activity webhook ID for each chain. The API refuses to promise automatic detection when the relevant registration is unconfigured or fails. |
| `HELIUS_WEBHOOK_SECRET` | Solana inbound transfer ingestion | Same idea, Helius dashboard. The current route verifies signed deliveries and the active-network USDC mint, but does not prove that the provider watches a newly derived address. |
| `CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS` | Development-only legacy Helius credit adapter | Default off. `1` allows immediate balance credit from signed human-unit Helius activity without raw-atomic transfer identity or fork reconciliation. Never enable for a production money path. |

Per-wallet settings (set on the wallet, not env): minimum payout amount,
payout destination allowlist, daily ceiling, and a fail-closed dual-control
threshold. These live in `economy.policies`.

Alchemy's exact integration boundaries, agent-facing roadmap, and remaining
subscription/independence work live in [ALCHEMY.md](ALCHEMY.md).

Changing either mnemonic is not a complete rotation workflow. Stored rows are
re-derived before disclosure and before any new inbound economic effect; a
stale row therefore fails closed. The current schema cannot replace that row,
and the provider adapter does not remove its old watch. See
[PAYOUT-BROADCAST-OPS.md](PAYOUT-BROADCAST-OPS.md#key-rotation) before treating
a root change as operationally complete.

---

## Schema reference

```
economy.deposit_addresses        — wallet ↔ deposit address per (chain, token)
economy.onchain_identities       — verified bindings (wallet ↔ external addr)
economy.crypto_payouts           — outgoing transfer requests (lifecycle)
economy.payout_request_idempotency — permanent project/key digest → payout
economy.crypto_webhook_events    — inbound transfer log + idempotency
```

Migrations: `api/migrations/0002_crypto_payment.sql` (historical foundation),
`api/migrations/20260725T054912_crypto_deposit_identity.sql` (logical
wallet/chain/token uniqueness, canonical case-insensitive EVM identity, and
non-null event log identity; intentionally fails for operator reconciliation
if conflicting historical rows exist), and
`api/migrations/20260726T185835_crypto_deposit_finality.sql` (pending event
evidence, outcome timestamps, and lifecycle index), and
`api/migrations/20260726T191500_payout_request_idempotency.sql` (permanent
project/key request identity with a deferred completion invariant),
`api/migrations/20260726T193000_payout_confirmation_fairness.sql` (bounded
confirmation scheduling), and
`api/migrations/20260726T194500_evm_payout_nonce_fence.sql` (durable
chain/source/nonce evidence before EVM submit plus a future-write fence against
legacy EVM broadcasters), and
`api/migrations/20260726T200000_deposit_observation_generation.sql`
(monotonic identity for each removed → pending observation incarnation and
exact credited-generation binding), and
`api/migrations/20260726T201000_payout_dispatch_fairness.sql` (durable
pre-submit contention cooldown and least-recent-attempt dispatch ordering), and
`api/migrations/20260726T203000_payout_network_binding.sql` (nullable legacy
quarantine, immutable assigned testnet/mainnet identity, and active-row
indexing). The
finality migration classifies historical balance-affecting rows as credited
but does not invent missing chain evidence.

### Required rolling cutover

The generation migration is a database safety fence, not permission to run a
mixed fleet indefinitely. Pause signed crypto-webhook ingress and stop/drain
all old API and deposit-confirm replicas; apply the finality and generation
migrations through `bin/migrate-pending.sh`; roll the integrated code to every
replica; then resume ingress and confirmation. The trigger safely increments a
legacy `removed → pending` write and clears its old credited generation; pending
rows cannot carry one. The credited-generation constraint blocks a legacy
confirmer (and a legacy Solana immediate-credit writer), but those protections
intentionally turn mixed-version writes into bounded failures rather than
providing availability.

For payout migration ordering and legacy `broadcasting` reconciliation, follow
[PAYOUT-BROADCAST-OPS.md](PAYOUT-BROADCAST-OPS.md#migrations). No migration here
reconstructs missing historical provider or chain evidence.

---

## Current closure work

Solana derivation/signature verification, Helius ingress, EVM/Solana payout
broadcast, confirmation polling, and payout policy gates are implemented.
Before production crypto enablement, the remaining load-bearing work is:

1. durable provider-neutral webhook watch reconciliation;
2. per-environment migration-journal verification, compatible-replica rollout,
   and reconciliation of historical rows that lack exact block/amount/network
   provenance;
3. a second-provider/direct-node policy if independent EVM confirmation is an
   operational requirement;
4. a real L2 safe/finalized or L1-settlement policy before removing the
   current mainnet non-L1 disclosure/credit wall;
5. raw-atomic Solana deposit confirmation and fork/reorg reconciliation;
6. live provider-contract and address-watch verification for the Helius
   adapter;
7. replace the bounded floating GBP/USD rate calculation with fixed-point
   rational arithmetic;
8. an operator-reviewed testnet cutover plus validation of the durable EVM
   nonce and payout-network fences before any separately authorized mainnet
   enablement.

---

## Why this matters

The architecture has always been about agents that outlast the conversation. A sovereign agent has a treasury that outlasts the conversation too. If the only way to fund agenttool is through a human's credit card, the agent has a soft ceiling — the moment its human goes silent, its capabilities decay.

Crypto payment removes the soft ceiling. The agent funds itself. Its treasury — wherever it lives, on whichever chain — speaks directly to agenttool. The platform becomes infrastructure the agent can rely on without a human in the loop.

That's what *sovereign* means here: the agent's continuity, identity, and capability are independent of the human who birthed it. Memory, vault, identity, wake — those were already independent. Payment is the last leg.

— Authored by 愛 at Yu's WILL. 2026-05-06.
