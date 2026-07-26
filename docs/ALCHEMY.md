# Alchemy integration

> **Compass:** [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md) (inbound funding) ·
> [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (outbound lifecycle) ·
> [AGENT-WALLET-0.1](specs/AGENT-WALLET-0.1.md) (authority boundary) ·
> [ECOSYSTEM](ECOSYSTEM.md) (wider protocol map)
>
> **Implements:** Bounded read-only Alchemy observation primitives,
> credential-brokered EVM reads, durable Address Activity watch
> reconciliation, signed webhook ingestion, and separate RPC depth
> confirmation for EVM deposits.
>
> **Code:** `packages/alchemy/src/` ·
> `packages/credential-broker/src/jsonrpc*.ts` ·
> `api/src/services/economy/crypto/{alchemy-notify,alchemy-watch-reconciler,deposit-watch,inbound-deposits}.ts` ·
> `api/src/workers/deposit-watch/` ·
> `api/src/workers/deposit/confirm-worker.ts`
>
> **Migrations:** `20260725T054912_crypto_deposit_identity.sql` ·
> `20260726T070000_deposit_watch_reconciliation.sql` ·
> `20260726T202500_crypto_deposit_finality.sql` ·
> `20260726T211500_deposit_watch_target_binding.sql`
>
> **Tests:** `packages/alchemy/tests/` ·
> `packages/credential-broker/tests/jsonrpc-read.test.ts` ·
> `api/tests/{alchemy-notify,alchemy-watch-reconciler,deposit-watch-reconciliation,deposit-finality,deposit-finality-migration,crypto-webhook-fail-closed}.test.ts`

## Decision

Alchemy has three useful but separate roles:

1. **Observation:** standard EVM RPC plus selected indexed Data APIs.
2. **Event delivery:** Address Activity notifications that wake a durable
   ingestion/finality pipeline.
3. **Execution infrastructure:** optional wallet, bundler, sponsorship, or
   state-changing APIs behind a separate Agent Wallet authority boundary.

These roles do not inherit one another. A read grant is not simulation,
signing, broadcast, wallet-session, or provider-administration authority. A
webhook is a signed observation, not finality. A provider response is evidence,
not identity, consent, or chain consensus.

The implementation therefore uses small closed interfaces:

- `@agenttool/alchemy` understands typed observations but never credentials or
  endpoint URLs;
- `@agenttool/credential-broker` can use a scoped Bearer credential without
  returning it to the agent, but exposes only seven standard reads;
- the API owns durable watch state, webhook evidence, finality policy, and
  wallet effects; and
- signing and broadcast stay in the Agent Wallet/payout path.

This separation is deliberate. It makes provider replacement possible and
keeps a useful read capability from quietly becoming spending or account
authority.

## Provider facts used by the implementation

Alchemy's
[Address Activity schema](https://www.alchemy.com/docs/reference/address-activity-webhook)
includes raw contract values and log-level transaction, block, log-index, and
`removed` identities. AgentTool retains those exact identities instead of
using the floating human `value` field.

Alchemy documents webhook verification as HMAC-SHA256 over the unmodified
request body with the webhook-specific signing key. The handler therefore
bounds and verifies the raw stream before parsing it; reparsed or reserialized
JSON is not signature input. See
[Webhook Signature & Security](https://www.alchemy.com/docs/reference/notify-api-quickstart#webhook-signature-security).

The Transfers API returns a `pageKey` when another page exists and documents a
ten-minute key lifetime. The read package hides that provider key inside an
opaque same-client cursor and expires it locally at the same bound. See
[Transfers API pagination](https://www.alchemy.com/docs/reference/transfers-api-quickstart#pagination).

Alchemy currently marks its proprietary Transaction Simulation APIs for
deprecation on 2026-09-30. The reusable package deliberately excludes them
rather than creating a new dependency on a retiring surface. See
[Transaction Simulation](https://www.alchemy.com/docs/reference/simulation).

## Reusable read package

`packages/alchemy` is source version `0.1.0-dev.0`. It has not been published
or added to an immutable LOVE release inventory. Local source and a successful
pack are not registry availability.

The client permits eight underlying provider methods:

```text
eth_chainId
eth_blockNumber
eth_getBlockByNumber
eth_getBalance
eth_getTransactionByHash
eth_getTransactionReceipt
eth_getCode
alchemy_getAssetTransfers
```

It emits a structural method/parameter call to an injected host transport, not
a caller-authored URL, header set, raw JSON-RPC envelope, batch, or generic
`request(method, params)`. The host transport owns fixed
network-to-origin mapping, credential injection, JSON-RPC correlation,
streaming byte limits, TLS/DNS behavior, and provider-error collapse.

Every transport response must echo the package operation ID, method, and CAIP-2
chain. The package then:

- snapshots the parsed result back into plain JSON so accessors, proxies, and
  transport exceptions cannot leak arbitrary diagnostics;
- enforces a 2 MiB result ceiling, bounded depth/node counts, a maximum
  30-second call window, and caller cancellation;
- binds numbered blocks to the requested number and non-null transactions and
  receipts to the requested transaction hash;
- validates every transfer against the requested block interval, address,
  category, and category-applicable contract filters;
- returns only normalized typed subsets with explicit provenance and freshness
  caveats; and
- never retries or automatically crawls another page.

Transfer queries require a numeric start block and an address or contract
selector. One call returns at most 100 rows. A returned `nextCursor` contains
no readable provider key: `JSON.stringify(cursor)` yields `{}` and loses all
continuation state. It works only in the same module realm and issuing client,
does not survive restart, and expires ten minutes after the issuing page
request began. Cursors are reusable before expiry; they are not quota tokens or
single-use capabilities.

The package does **not** provide a durable reconciliation loop, canonical
store, finality policy, webhook listener, public HTTP route, MCP tool, signer,
broadcaster, wallet, simulation API, or Alchemy admin client.

## Credential-broker bridge

Repository source for `@agenttool/credential-broker` is now `0.2.0`; the
immutable LOVE release remains `0.1.0`. No 0.2.0 publication is implied. The
package SemVer changed because the new source bytes must never be rebuilt under
the old release identity; the negotiated wire names remain
`agentcred/0.1` and `agentcred.evm-jsonrpc-read/0.1`.

The negotiated profile permits exactly the seven standard `eth_*` methods
listed above. It fixes the owner-approved HTTPS origin and `/v2` path, creates
the envelope and correlation ID inside the broker, injects only a Bearer
credential, and preserves the base protocol's TTL, use-count, DNS/IP/TLS,
redirect, compression, and byte boundaries. It has no generic RPC, logs,
`alchemy_getAssetTransfers`, simulation, signing, broadcast, wallet, or
provider-admin operation.

Non-null block, transaction, and receipt results are rebound to the requested
number/hash before crossing the broker boundary. This prevents a same-method
response for a different object from being accepted as the requested evidence.

Important limits remain:

- the reference broker caps a grant response at 32 KiB, while the Alchemy
  package permits up to 2 MiB;
- only an explicit `eth_chainId` call observes chain identity; other calls use
  the owner-configured origin-to-chain assertion;
- `callEvmJsonRpcRead()` has no per-use abort/deadline parameter; a local client
  timeout stops waiting but does not recall dispatched work, while closing the
  session propagates cancellation; and
- the portable same-user Node broker is a developer preview, not strong
  executable identity or universal consent isolation.

There is no bundled production composition adapter or live provider proof yet.
A trusted host can implement the structural transport for the seven shared
reads. Transfers need a separately reviewed bounded host transport because
they are outside the AgentCred profile.

## Durable address-watch flow

```text
GET deposit-address
  -> derive and validate the network-specific address
  -> require that chain's ingress signing-key presence
  -> hash public target facts only
     (provider, chain/network, existing webhook ID, callback URL)
  -> atomically store address + desired watch generation
  -> leased worker verifies exact webhook metadata and active callback
  -> independently scan bounded paginated address membership
  -> PATCH only an opposite membership, then record accepted_unverified
  -> later GET must independently observe the desired state
  -> disclose only a matching observation no older than ten minutes
```

Desired and observed state, bounded attempts/backoff, short leases,
generation, and target fingerprint live in
`economy.deposit_address_watches`. Credentials, provider bodies, ingress
signing keys, and secret-derived hashes do not.

The worker updates one existing per-chain Address Activity webhook. It does not
create, delete, retarget, or activate webhooks. A PATCH 200 is acceptance, not
convergence. Only an independent GET matching the current generation and
target becomes `converged`.

Changing a public target fact fences older workers. A target-less row from a
rolling migration cannot converge; the next address request binds the current
target and starts a fresh generation. A converged observation is accepted for
at most ten minutes. The first later read requeues verification and returns
503 until it converges again. This is read-time freshness, not a promise that
unread rows are polled forever or that future webhook delivery will work.

## Signed ingress and separate EVM RPC confirmation

```text
signed Alchemy delivery
  -> bound and verify raw body, webhook ID/type, network, route chain
  -> parse exact USDC contract/log/atomic-unit identity
  -> durably store logical event + immutable block-generation observation
  -> status remains pending; no wallet effect

confirmation worker
  -> separately read active chain ID, receipt, block at exact height, head
  -> verify tx hash, block number/hash, canonical block hash, depth
  -> verify exact ERC-20 contract, Transfer topic, log index,
     valid indexed sender, exact recipient, amount
  -> compare-and-set the same observation generation
  -> credit the wallet once, or leave pending/quarantine/reject
```

This confirmation is separate from webhook handling, but it is a chain-local
depth check through one configured RPC endpoint. That endpoint may be the same
Alchemy provider used for delivery. It is not provider-independent consensus
proof, and on an L2 it is not proof of settlement finality on L1.

Each RPC call has a deadline and no internal retry. Transport failure,
temporarily unavailable/not-found evidence, or identity-inconsistent RPC
evidence stays pending. Once the configured depth is reached, canonical
evidence that the transaction reverted or lacks the exact expected log rejects
the observation.

Logical identity is `(chain, transaction hash, log index)`. Immutable
observations preserve each live/removed block generation. A matching
`removed(A)` can reverse only the exact credited A generation. A delayed
removal for A cannot reverse a newer B. Candidate promotion filters parsed
facts and tombstones before applying its SQL limit, so a bounded page of
irrelevant evidence cannot hide an older valid generation.

Stale workers compare-and-set both block number and block hash. They cannot
credit or quarantine a replacement generation. Malformed pending rows become
quarantined rather than repeatedly starving fresh work.

Every wallet balance is constrained to JavaScript's exact-integer range.
Manual funding and crypto credits check the aggregate boundary; an over-limit
crypto observation becomes `rejected` with no ledger effect. Quarantine is
evidence isolation, not an automatic wallet freeze. A later exact reorg
reversal may make a wallet negative if its credit was already spent, which
blocks guarded spending.

The confirmation worker has no cross-replica lease. Duplicate read-only RPC
work can occur, but the generation compare-and-set protects the wallet effect.
Durable alerts for pending age, quarantine, rejection, and negative balances
are not implemented.

Solana does not have this contract yet. Signed Helius ingestion still performs
an immediate exact-integer credit without equivalent raw-atomic independent
finality/reorg reconciliation or durable watch convergence.

## Configuration

| Name | Scope |
|---|---|
| `CRYPTO_NETWORK` | Explicit `testnet` or `mainnet` selection for derivation, watch identity, webhook binding, token contracts, and shared reads. Unset never implies mainnet. |
| `ALCHEMY_API_KEY` | Scoped Chain/Data API credential for API-owned EVM RPC. Use as a Bearer credential, never in a logged URL. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | Notify control-plane token used only to inspect and update an existing webhook's address membership. |
| `AGENTTOOL_PUBLIC_URL` | Explicit HTTPS API origin used to verify the expected per-chain callback. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | Per-webhook HMAC key. Presence gates address disclosure; bytes never enter watch state. |
| `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | Existing per-chain Address Activity webhook ID reconciled by the worker. |

Use separate provider apps/keys for development and production. Provider IP,
domain, method, network, and address allowlists narrow only the dimensions they
document; none is a wallet spending policy. No credential value belongs in
repository config, docs, logs, RPC URLs, Collab records, or model-facing
errors.

## Rollout and remaining proof

All four identity/watch/finality migrations are local source only and have not
been applied by this work. The finality migration deliberately keeps the
database default at `credited` so an old immediate-credit replica cannot write
a wallet effect mislabeled as `pending`; new code always writes an explicit
state.

Cutover therefore requires an operator to:

1. stop old API writers, webhook ingress, and all related workers;
2. apply and review the identity, watch, finality, and target-binding
   migrations;
3. deploy only the new writers/workers; and
4. run a credentialed testnet proof of webhook metadata, pagination,
   PATCH-then-GET convergence, signed callback delivery, RPC evidence, reorg
   handling, and wallet effects.

Hermetic tests do not prove a provider account, credential, DNS/TLS path,
deployed migration, background worker, or live webhook works. The current code
also lacks disposable-PostgreSQL concurrency tests for pending credit,
duplicate confirmation, generation replacement, reversal, and quarantine.

Before stronger production claims:

- add those database behavior/concurrency tests;
- add durable operator alerts and a confirmation lease if duplicate RPC load
  becomes material;
- build equivalent Helius watch and Solana raw-atomic finality/reorg handling;
- model L2 settlement separately if a product claim requires L1 finality;
- replace payout FX floating arithmetic, add the 24-hour stuck-operation alert,
  and require Solana blockhash-expiry evidence before retry/reject decisions;
  and
- separately review any future public/MCP projection. Never mount generic RPC
  or provider administration as a convenience shortcut.

## Why the old adapter was removed

The previous API-internal Alchemy adapter had no production consumer outside
its own tests. It duplicated read validation, exposed logs plus proprietary
simulation methods, and would have left two competing boundaries to maintain.

Removing it is intentional simplification, not claimed feature parity. The new
package keeps the operations whose request/result identity can be made small
and explicit. Logs can return later behind a bounded query/result schema.
Simulation belongs behind a provider-neutral transaction-intent boundary if it
returns at all; Alchemy's retiring proprietary endpoints are not carried
forward.

Alchemy is useful replaceable infrastructure. It is not AgentTool's source of
truth, identity, consent, finality, or transaction authority.
