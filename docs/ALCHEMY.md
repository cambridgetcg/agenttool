# Alchemy integration

> **Compass:** [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) (inbound funding) · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound lifecycle) · [AGENT-WALLET-0.1](specs/AGENT-WALLET-0.1.md) (authority boundary) · [ECOSYSTEM](ECOSYSTEM.md) (wider protocol map)
>
> **Implements:** A bounded provider seam for EVM RPC, Address Activity watch registration, signed webhook ingress, pending deposit confirmation, removed-log reconciliation, and developer-preview named read primitives.
>
> **Code:** `api/src/services/economy/crypto/alchemy-notify.ts` · `api/src/services/economy/crypto/network.ts` · `api/src/services/economy/crypto/inbound-deposits.ts` · `api/src/workers/deposit/confirm-worker.ts` · `api/src/routes/economy/crypto.ts` · `api/migrations/20260725T054912_crypto_deposit_identity.sql` · `api/migrations/20260726T185835_crypto_deposit_finality.sql` · `packages/alchemy/src/` · `packages/credential-broker/src/jsonrpc.ts`
>
> **Tests:** `api/tests/alchemy-notify.test.ts` · `api/tests/alchemy-deposit-invariants.test.ts` · `api/tests/crypto-webhook-fail-closed.test.ts` · `api/tests/deposit-finality.test.ts` · `api/tests/deposit-finality-migration.test.ts` · `api/tests/alchemy-rpc-auth.test.ts` · `api/tests/payout-refund-integrity.test.ts` · `api/tests/payout-submit-outcome.test.ts` · `packages/alchemy/tests/` · `packages/credential-broker/tests/jsonrpc-read.test.ts`

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
| [Transaction Simulation](https://www.alchemy.com/docs/reference/simulation) | Asset-change and execution evidence before a proposal reaches a signer | A snapshot prediction is not authorization or a guarantee of later execution. |
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
  -> persist local address
  -> idempotently add address to the chain's Alchemy webhook
  -> return automatic-deposit instructions only after provider acceptance

Alchemy signed delivery
  -> independently count the actual stream up to 1 MiB
  -> webhook-specific HMAC-SHA256 over the exact raw bytes
  -> bind webhook ID + ADDRESS_ACTIVITY type + provider network to URL chain
  -> exact raw USDC base units
  -> (chain, tx hash, log index) idempotency
  -> durable pending observation; no EVM balance mutation
  -> delivery returns 200 only after pending/removed evidence is committed

EVM deposit reconciler
  -> separately fetch canonical receipt + current block through configured RPC
  -> wait for chain-specific confirmation depth
  -> require exact contract + Transfer topic + log index + recipient + amount
  -> status-CAS pending -> credited with wallet and ledger mutation atomically
  -> RPC absence leaves the observation pending

Alchemy removed-log delivery
  -> store a tombstone when removal arrives before the live observation
  -> pending/rejected -> removed without a balance effect
  -> credited -> removed plus exact prior-credit reversal in one transaction
  -> mismatched or unreconciled historical evidence returns 503 for operator
     reconciliation instead of guessing

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

Address registration is deliberately idempotent. The current narrow adapter
updates an existing per-chain Address Activity webhook and never creates,
deletes, or reconfigures an Alchemy app or webhook. If provider registration
fails, the local address remains recoverable and the same GET retries the
registration, but the API refuses to claim that detection is active. Successful
registrations are cached only within one process to avoid PATCHing on every
read; this is an availability optimization, not durable subscription state.

The receipt check is separate from webhook delivery, but by default both may
use Alchemy infrastructure. It is therefore confirmation-depth and
canonical-log reconciliation, not independent-provider consensus. Base,
Optimism, and Arbitrum depth is also not a claim of L1 settlement, a
safe/finalized L2 tag, or production finality. Solana does not yet have
equivalent raw-atomic finality or reorg reversal; its legacy immediate-credit
adapter is disabled by default behind a development-only opt-in.

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

The developer-preview `@agenttool/alchemy` package exposes a deliberately
smaller set of named observations, not arbitrary JSON-RPC:

```text
eth_chainId
eth_blockNumber
eth_getBlockByNumber
eth_getBalance
eth_getTransactionByHash
eth_getTransactionReceipt
eth_getCode
alchemy_getAssetTransfers (one bounded page)
```

It accepts an injected structural transport that receives a fixed network and
CAIP-2 identity, one closed method/parameter tuple, an `AbortSignal`, an
absolute deadline, and a response-byte limit. The package never accepts a URL,
API key, header, signer, wallet, generic request method, or provider-admin
token. The host transport maps the network to a trusted origin, injects
credentials outside the package, generates and validates the JSON-RPC
envelope/correlation ID, bounds the response while reading it, collapses
provider diagnostics, and returns only a parsed result rebound to the requested
method and chain.

On a developer machine, `@agenttool/credential-broker` implements the
negotiated `agentcred.evm-jsonrpc-read/0.1` profile for the seven core `eth_*`
reads. It fixes the owner-approved HTTPS origin and `/v2` path, constructs the
JSON-RPC envelope and ID inside the broker, validates method-specific params,
and injects the Alchemy key only as a Bearer header. The agent supplies no URL,
headers, raw body, batch, notification, or arbitrary method. The profile
intentionally excludes `alchemy_getAssetTransfers`; that eighth package
operation requires its own equally closed host transport. The portable broker
remains a same-user developer preview, not a universal process-isolation or
trusted-consent guarantee.

The package independently bounds and validates the parsed result, returns only
typed subsets, and sanitizes transport failures. Its provenance
distinguishes configured chain identity from observed data, live RPC from the
Alchemy transfer index, provider-head evidence from provider-asserted
safe/finalized tags, and numbered blocks whose finality remains unknown.
Transfer calls require an explicit start block and address/contract selector,
return at most 100 entries, and never auto-page or retry.

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
| `PAYOUT_NETWORK` | Explicit shared crypto network (`testnet` or `mainnet`). Despite the historical name, deposits and webhooks also require it; unset fails closed instead of implying mainnet. |
| `ALCHEMY_API_KEY` | Scoped Chain/Data API key used in a Bearer header for EVM RPC. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | Notify control-plane token used only to update existing webhook address sets. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | The signing key from that specific webhook's detail page; used only for raw-body HMAC verification on the matching route. |
| `CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS` | Development-only opt-in for the separate Helius human-unit immediate-credit adapter. Default off; unrelated to Alchemy EVM confirmation. |
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

- Persist desired/observed watch-subscription state in a provider-neutral
  outbox and reconcile it independently of a client retry.
- Deploy and operator-verify all local crypto migrations. Historical
  pre-finality rows are classified as credited but deliberately are not given
  invented amount/block evidence; a later removal pauses when exact reversal
  provenance is unavailable.
- Define an operator/user recovery policy for durable `rejected` deposit
  custody records such as sub-credit dust. They are now visible and do not
  mint balance, but this integration does not sweep or return the underlying
  token.
- Add a second-provider or direct-node evidence policy if operational claims
  require provider independence. The current worker is a separate read
  through the configured chain transport, not provider consensus.
- For L2s, define and implement the required safe/finalized or L1-settlement
  policy instead of treating a fixed sequencer-block depth as production
  finality.
- Give Solana the same raw-atomic confirmation and reorg/fork reconciliation
  boundary before describing its credits as production-final.
- Verify that configured webhooks are active Address Activity subscriptions
  targeting the intended route; Notify PATCH acceptance alone does not prove
  that operational state.
- Add bounded retries with `Retry-After`, jitter, and telemetry for read-only
  provider calls. Never automatically retry ambiguous broadcasts.
- Before enabling payouts, replace the bounded floating FX quote with
  fixed-point arithmetic and close the cross-replica nonce lock. Daily-ceiling
  admission is now evaluated after taking the wallet transaction lock, so
  concurrent requests for one wallet cannot independently spend the same
  remaining ceiling.
- Decide whether the developer-preview named read package needs a separately
  reviewed local MCP projection. The core package itself exposes no MCP,
  provider credential, generic RPC, simulation, signer, or broadcaster.
- Expand beyond the current eight read operations only with operation-specific
  parameter/result schemas and evidence semantics; do not add a generic RPC
  escape hatch.

Until those items land, Alchemy is a useful replaceable infrastructure
provider, not a source of truth, identity, consent, or transaction authority.
