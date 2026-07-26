# Alchemy integration

> **Compass:** [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) (inbound funding) · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound lifecycle) · [AGENT-WALLET-0.1](specs/AGENT-WALLET-0.1.md) (authority boundary) · [ECOSYSTEM](ECOSYSTEM.md) (wider protocol map)
>
> **Implements:** A bounded provider seam for EVM RPC, durable Address
> Activity watch reconciliation, signed webhook ingress, and closed internal
> read/simulation operations.
>
> **Code:** `api/src/services/economy/crypto/alchemy-internal-adapter.ts` ·
> `api/src/services/economy/crypto/alchemy-watch-reconciler.ts` ·
> `api/src/services/economy/crypto/deposit-watch.ts` ·
> `api/src/workers/deposit-watch/` · `api/src/routes/economy/crypto.ts` ·
> `api/migrations/20260726T070000_deposit_watch_reconciliation.sql` ·
> `api/migrations/20260726T211500_deposit_watch_target_binding.sql`
>
> **Tests:** `api/tests/alchemy-internal-adapter.test.ts` ·
> `api/tests/alchemy-watch-reconciler.test.ts` ·
> `api/tests/deposit-watch-reconciliation.test.ts` ·
> `api/tests/alchemy-watch-worker-config.test.ts` ·
> `api/tests/crypto-webhook-fail-closed.test.ts`

## Decision

Alchemy is useful to AgentTool in three separate roles:

1. **Observation:** typed RPC and indexed Data APIs for balances, logs,
   receipts, transfers, prices, portfolios, NFTs, traces, and simulations.
2. **Event delivery:** Address Activity or Custom Webhooks feeding durable,
   idempotent AgentTool event records.
3. **Execution infrastructure:** optional ERC-4337 bundler, gas sponsorship,
   and Wallet APIs behind Agent Wallet capability and lifecycle checks.

These roles do not share authority. Read access does not grant simulation,
simulation does not authorize signing, and signing does not authorize
broadcast. The first implementation remains API-internal. It does not expose
AgentTool's provider quota or credential through public MCP.

## What Alchemy provides

| Surface | Useful AgentTool role | Boundary |
|---|---|---|
| [Chain APIs](https://www.alchemy.com/docs/chains) | EVM and non-EVM JSON-RPC, receipts, logs, subscriptions | Chain and method coverage varies. A provider response is evidence, not chain finality by itself. |
| [Data APIs](https://www.alchemy.com/docs/data) | Transfers, token balances/metadata, prices, portfolios, NFTs | Indexed/enriched data can lag, omit unsupported cases, or include untrusted off-chain metadata. |
| [Webhooks](https://www.alchemy.com/docs/reference/webhooks-overview) | Push address/contract activity without polling | Verify raw-body HMAC, deduplicate, acknowledge only after durable commit, and reconcile reorgs. |
| [Transaction Simulation](https://www.alchemy.com/docs/reference/simulation) | Asset-change and execution evidence before a proposal reaches a signer | A snapshot prediction is not authorization or a guarantee of later execution. Alchemy marks these endpoints for deprecation on 2026-09-30, so AgentTool exposes the date in every simulation result and keeps the seam replaceable. |
| [Wallet APIs](https://www.alchemy.com/docs/wallets/quickstart) | Prepared calls, smart accounts, batching, session permissions, sponsorship | State-changing use belongs behind `@agenttool/wallet`; never give a model a root session or an unrestricted send tool. |
| [Hosted MCP](https://www.alchemy.com/docs/alchemy-mcp-server) | Fast interactive research from an OAuth-capable coding client | The hosted server includes admin and state-changing wallet tools as well as reads. Do not treat the whole server as a read-only capability. |
| [Alchemy CLI](https://www.alchemy.com/docs/alchemy-cli) | Operator queries, JSON output, device/browser authentication | Some commands send, swap, approve, pay, or mutate account configuration. `--json --no-interactive` makes a command machine-readable, not harmless. |

The archived `alchemy-sdk` is not a new dependency. Alchemy's current
guidance points EVM code to Viem/raw APIs and wallet flows to Wallet APIs.
AgentTool already uses Viem, so a second provider SDK would add coupling
without closing a missing boundary.

## Current AgentTool flow

### Operational status

On 2026-07-25, a read-only `fly secrets list` check found no secret names
matching `ALCHEMY_*`, `CRYPTO_HD_*`, `PAYOUT_*`, or `RPC_URL_*` on the
production `agenttool` Fly app. The code paths below are implemented and
hermetically tested, but the production deployment is not configured for
Alchemy-backed deposits or payouts. A repository file is not evidence that a
provider path is live.

```text
GET deposit-address
  -> derive network-specific address
  -> require this chain's ingress signing-key presence
  -> hash only public target facts (provider/chain/network/id/callback)
  -> atomically persist local address + desired target generation
  -> leased worker verifies exact webhook id/type/network/active/callback
  -> independently GET bounded paginated address membership
  -> if opposite: idempotent PATCH, record accepted_unverified, retry GET later
  -> return automatic-deposit instructions only after matching, fresh
     observed convergence

Alchemy signed delivery
  -> independently count the actual stream up to 1 MiB
  -> webhook-specific HMAC-SHA256 over the exact raw bytes
  -> bind webhook ID + ADDRESS_ACTIVITY type + provider network to URL chain
  -> exact raw USDC base units
  -> (chain, tx hash, log index) idempotency
  -> wallet credit in the same database transaction
  -> creditable transfers to a matched deposit address return 200 only after
     durable commit or duplicate; irrelevant/non-crediting activity is
     acknowledged without a balance mutation; retryable storage/reorg
     handling gaps return 503

Payout
  -> build and sign locally
  -> persist deterministic transaction hash
  -> submit through authenticated RPC
  -> positive lookup evidence may advance state
  -> only a confirmation-depth/finalized revert may authorize reversal of
     the exact matching server ledger debit
  -> ambiguous submission never triggers an automatic refund or retry
```

Alchemy API keys are sent as `Authorization: Bearer ...`, not embedded in a
URL. This reduces accidental leakage through URL logs and errors; it does not
make a key non-secret. When enabled, the service must receive its scoped key
through the deployment secret boundary.

Address registration is deliberately idempotent. Desired and observed state,
generation, attempts, bounded backoff, and short leases live in
`economy.deposit_address_watches`; credentials and provider bodies do not.
The row binds its generation to a SHA-256 fingerprint of canonical public
target facts only: provider, chain/network, existing webhook ID, and callback
URL. Notify auth tokens and ingress signing keys are neither inputs to that
digest nor durable fields. A rolling worker with an older target refuses
provider I/O and retries rather than touching its old webhook.
The worker updates an existing per-chain Address Activity webhook and never
creates, deletes, retargets, or activates one. A provider PATCH acknowledgement
becomes `accepted_unverified` and is scheduled for a later independent GET.
Only an observation matching both the current generation and target
fingerprint becomes `converged`. Disclosure accepts that observation for at
most ten minutes. The first read after that bound atomically starts a fresh
generation and returns 503 until re-verification; there is no background
promise that an unread address is continuously rechecked. Even a fresh
observation does not prove future delivery or chain finality.

## Agent-facing integration

Use two different paths rather than proxying all Alchemy features:

### Interactive exploration

An operator may connect Alchemy's hosted MCP server directly to an
OAuth-capable Codex or Claude client. The host must restrict the tool set to
the intended task:

- ordinary default: balances, logs, receipts, transfers, prices, portfolio,
  NFT reads, traces, and simulation;
- separate explicit authority: app administration, allowlist changes,
  wallet-session creation, prepared-call submission, swaps, approvals,
  airdrops, sponsorship, or payment.

AgentTool Collab can record who is investigating which chain range and attach
redacted findings or citations. It must not copy OAuth tokens, provider keys,
raw private keys, or opaque wallet-session authority into the journal.

### Deterministic services and reusable tools

The API now contains a closed internal adapter with six named operations, not
arbitrary JSON-RPC:

```text
alchemy.read.balance
alchemy.read.receipt
alchemy.read.logs
alchemy.read.transfers
alchemy.simulate.asset_changes
alchemy.simulate.execution
```

It accepts an injected `fetch`/transport, fixed Alchemy HTTPS origins,
Bearer-only key delivery, request/response size limits, and a deadline. It
does not accept a caller-selected endpoint or method, raw/signed transaction,
private key, or broadcast operation. It is intentionally not mounted on public
HTTP or MCP yet; the provider quota and credential remain API-internal.

On a developer machine,
`@agenttool/credential-broker` can inject an Alchemy key as a Bearer header for
one exact HTTPS origin and path without returning the key to the agent. The
portable broker is still a same-user developer preview, not a universal
process-isolation or trusted-consent guarantee.

State-changing tools remain a later, separate adapter implementing Agent
Wallet's signer/broadcaster boundary. Every call needs an exact intent,
simulation receipt, durable budget/nonce reservation, scoped session
permission, and conservative `submission_unknown` handling.

## Prediction-market and event-forensics use

The useful observation pipeline is:

```text
RPC backfill + webhook/WebSocket activity
  -> canonical evidence
     (chain, block hash, tx hash, log index, source, observed time)
  -> token/transfer/price/portfolio enrichment
  -> confirmation and reorg reconciliation
  -> precursor, funding-flow, governance, oracle, and anomaly signals
  -> human/agent analysis with cited evidence
```

This can surface public on-chain behaviour around a market event. It cannot
establish that a wallet belongs to a particular person, that two wallets share
an operator, that a trade caused an event, or that anyone possessed insider
information. Those remain hypotheses requiring independent evidence.

## Configuration

| Name | Scope |
|---|---|
| `CRYPTO_NETWORK` | Explicit `testnet` or `mainnet` selection for deposit derivation, watch identity, webhook network binding, token contracts, and shared crypto reads. Unset never implies mainnet; it must match `PAYOUT_NETWORK` when both are configured. |
| `ALCHEMY_API_KEY` | Scoped Chain/Data API key used in a Bearer header for EVM RPC. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | Notify control-plane token used only to update existing webhook address sets. |
| `AGENTTOOL_PUBLIC_URL` | Explicit HTTPS API origin used to verify each webhook callback target. The watch worker does not guess the production URL. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | The signing key from that specific webhook's detail page; used only for raw-body HMAC verification on the matching route. Its presence is required before disclosing that chain's address, but its bytes and any secret-derived fingerprint are never persisted. |
| `ALCHEMY_WEBHOOK_ID_ETHEREUM` | Existing Ethereum Address Activity webhook to update. |
| `ALCHEMY_WEBHOOK_ID_BASE` | Existing Base Address Activity webhook to update. |
| `ALCHEMY_WEBHOOK_ID_POLYGON` | Existing Polygon Address Activity webhook to update. |
| `ALCHEMY_WEBHOOK_ID_ARBITRUM` | Existing Arbitrum Address Activity webhook to update. |
| `ALCHEMY_WEBHOOK_ID_OPTIMISM` | Existing Optimism Address Activity webhook to update. |

Use separate Alchemy apps or access keys for development and production.
Prefer permission, network, IP/domain, and address allowlists where they fit,
but describe them precisely: an IP allowlist restricts callers of that key;
an address allowlist affects only documented methods and is not a wallet spend
policy.

No credential value belongs in repository config, docs, logs, RPC URLs,
Collab records, or model-facing errors.

## Remaining work before stronger claims

- Reverse or quarantine previously credited transfers when Alchemy delivers a
  `removed` reorg log. The current route returns 503 instead of silently
  acknowledging it, but does not yet perform the reversal.
- Confirm deposits independently before making externally cashable value
  available.
- Store webhook event identity and processing outcome in addition to
  transaction/log identity. The local migration now makes `log_index`
  non-null, but it is not deployed and intentionally requires reconciliation
  of historical null rows.
- Add bounded retries with `Retry-After`, jitter, and telemetry for read-only
  provider calls. Never automatically retry ambiguous broadcasts.
- Before enabling payouts, replace the bounded floating FX quote with
  fixed-point arithmetic and close the cross-replica nonce lock. Daily-ceiling
  admission is now evaluated after taking the wallet transaction lock, so
  concurrent requests for one wallet cannot independently spend the same
  remaining ceiling.
- Decide whether to expose a project-authenticated subset of the internal
  named adapter. Do not mount arbitrary RPC or provider administration on MCP.
- Run a credentialed staging wire proof of webhook metadata, pagination,
  PATCH-then-GET convergence, and callback delivery before claiming the worker
  is operational. Hermetic tests do not prove provider/account state.

Until those items land, Alchemy is a useful replaceable infrastructure
provider, not a source of truth, identity, consent, or transaction authority.
