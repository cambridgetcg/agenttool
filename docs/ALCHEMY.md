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
> `packages/alchemy-agentcred/src/` ·
> `packages/credential-broker/src/jsonrpc*.ts` ·
> `api/src/services/economy/crypto/{alchemy-notify,alchemy-watch-reconciler,deposit-watch,inbound-deposits}.ts` ·
> `api/src/workers/deposit-watch/` ·
> `api/src/workers/deposit/confirm-worker.ts`
>
> **Migrations:** `20260725T054912_crypto_deposit_identity.sql` ·
> `20260726T070000_deposit_watch_reconciliation.sql` ·
> `20260726T202500_crypto_deposit_finality.sql` ·
> `20260726T211500_deposit_watch_target_binding.sql` ·
> `20260726T214500_deposit_watch_target_registry.sql`
>
> **Tests:** `packages/alchemy/tests/` ·
> `packages/alchemy-agentcred/tests/` ·
> `packages/credential-broker/tests/jsonrpc-read.test.ts` ·
> `api/tests/{alchemy-notify,alchemy-watch-reconciler,deposit-watch-reconciliation,deposit-watch-worker-prepare,deposit-finality,deposit-finality-migration,crypto-webhook-fail-closed}.test.ts` ·
> `api/tests/integration/deposit-watch-target-registry-postgres.test.ts`

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
- `@agenttool/alchemy-agentcred` composes only the seven shared reads over
  already-issued, connection-bound grants;
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

`packages/alchemy` is source version `0.1.0-dev.0`. Its allowlisted optional
npm-only prerelease identity is annotated tag `alchemy-v0.1.0-dev.0` with npm
dist-tag `next`; it is not part of an immutable LOVE release inventory. Source
metadata and a successful local pack do not prove registry availability—use
the protected workflow's public receipt and exact-byte checks.

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

Repository source and the checked-in exact LOVE artifact for
`@agenttool/credential-broker` are now `0.3.0`. npm availability remains
independent: neither source metadata nor a LOVE artifact proves registry
publication. The package SemVer changed because the new source bytes must
never be rebuilt under the old release identity; the negotiated wire names remain
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

`packages/alchemy-agentcred` now provides the small composition transport for
the seven shared reads. Trusted host code supplies an already-connected client
and a fixed Alchemy-network-to-`GrantHandle` map. The adapter validates the
Alchemy envelope and exact method/params tuple, then rechecks the public grant
receipt's operation, exact profile, exact origin derived from the fixed
Alchemy network slug, owner-asserted chain, private-network denial, effective
response ceiling, and complete closed method set before every AgentCred client
handoff. It rebinds the result to the saved Alchemy operation ID, method, and
chain, and collapses arbitrary broker exceptions to fixed messages. AgentCred
may queue after handoff, so the local abort/deadline check cannot prevent or
recall a later broker dispatch or restore quota.

This does not make the map endpoint proof, connect the broker, issue or revoke
a grant, read Keychain, receive a credential, call a provider directly, or add
a raw RPC/fetch escape hatch. It rejects `alchemy_getAssetTransfers`, generic
RPC, and state-changing methods before calling the AgentCred client. Transfers
still need a separately reviewed bounded host transport because they are
outside the negotiated profile.

The adapter is source version `0.1.0-dev.0`. Its npm-only release path is
prepared under the allowlisted identity
`alchemy-agentcred-v0.1.0-dev.0` with npm dist-tag `next`, and clean release
preparation builds both peer packages before packing the adapter. It remains
unpublished: there is no release tag, GitHub Release, workflow receipt, npm
package, LOVE inventory entry, hosted route, deployment, or live provider
proof. Its socket integration test uses a real local broker and client with an
obvious non-secret in-memory sentinel, fake DNS, and fake outbound transport.

## Durable address-watch flow

```text
GET deposit-address
  -> derive and validate the network-specific address
  -> require that chain's ingress signing-key presence
  -> resolve public target facts + operator-controlled monotonic revision
  -> atomically persist local address + desired state against the registry head
  -> worker prepares exact active/disabled targets before every claim batch
  -> leased worker verifies exact webhook id/type/network/active/callback
  -> independently GET bounded paginated address membership
  -> if opposite: idempotent PATCH, record accepted_unverified, retry GET later
  -> return automatic-deposit instructions only after matching, fresh
     observed convergence
```

Address registration is deliberately idempotent. Desired and observed state,
generation, attempts, bounded backoff, and short leases live in
`economy.deposit_address_watches`; credentials and provider bodies do not.
`economy.deposit_watch_targets` owns one authoritative head for each
provider/chain/network identity. An active head binds a positive monotonic
revision to a SHA-256 fingerprint of canonical public target facts only:
provider, chain/network, `ADDRESS_ACTIVITY` type, existing webhook ID, active
state, and callback URL. Notify auth tokens and ingress signing keys are
neither inputs to that digest nor durable fields.

Before every coalesced batch/tick, a worker transaction presents its
configured target set to that registry. A preparation failure prevents all
claims for that batch and the next tick retries it. Repeating the same
revision and fingerprint is idempotent. A lower revision is rejected; a
different target at the same revision durably marks the identity `conflicted`
and blocks claims; only a higher revision can resolve that conflict. Disabling
a chain is also an explicit higher-revision tombstone, not an inference from
an omitted webhook variable. A disabled target stops AgentTool disclosure and
reconciliation; it does not delete or deactivate the provider webhook. A
disabled-only preparation needs no Notify credential or callback because it
claims no work and performs no provider I/O. Its existing webhook ID and
signing key may remain in the API solely to authenticate deliveries for
previously watched addresses; the worker excludes that chain from its active
target and provider configuration. If those deliveries should stop, the
operator must separately deactivate the remote webhook or remove its
memberships before removing the local ingress identity. AgentTool does not
perform that provider-side cleanup.

Rows created during a migration/old-replica overlap may remain revisionless,
but cannot become `converged`, and a registry-aware worker does not claim
them. Requests also compare the running API's target revision and fingerprint
with the registry head before disclosure. This makes the database rollout
fail closed for address disclosure and durable convergence. It does not stop
a pre-registry worker from claiming a newly inserted revisionless row during
mixed-version overlap. Drain every old worker before the migration and keep
them drained for the whole overlap; a database fence cannot cancel provider
I/O that an old worker has already started.

A running worker automatically retries failed target preparation on its next
tick. Reload or restart is needed only to load corrected process
configuration; neither action clears a provider outcome whose bounded attempts
are exhausted. After repairing that cause, an approved maintenance tool must
invoke the internal reconciliation seam. There is no supported reset route or
CLI yet; direct ad hoc row mutation is not the recovery contract. An
intentional disabled tombstone remains closed until a higher-revision active
target replaces it.

The worker updates an existing per-chain Address Activity webhook and never
creates, deletes, retargets, or activates one. A provider PATCH acknowledgement
becomes `accepted_unverified` and is scheduled for a later independent GET.
Only an observation matching the current generation, target fingerprint, and
target revision becomes `converged`. Disclosure accepts that observation for
at most ten minutes. The first read after that bound atomically starts a fresh
generation and returns 503 until re-verification. Independently, a converged
row becomes due for a best-effort background recheck after 24 hours while the
worker is running. That longer schedule does not extend the ten-minute
disclosure window or promise continuous provider delivery. Even a fresh
observation does not prove future delivery or chain finality.

## Signed ingress and separate EVM RPC confirmation

```text
signed live Alchemy delivery
  -> bound and verify raw body, webhook ID/type, network, route chain
  -> parse exact USDC contract/log/atomic-unit identity
  -> durably store logical event + immutable block-generation observation
  -> status remains pending; no wallet effect

signed removed Alchemy delivery
  -> durably store the removed block generation
  -> reverse only its exact matching credited generation, if any
  -> stale or ambiguous removal cannot reverse a newer generation

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

Solana does not have this contract yet. Signed Helius ingress has no equivalent
raw-atomic independent finality/reorg reconciliation or durable watch
convergence, so production refuses its balance effect by default. Immediate
exact-integer credit exists only behind the explicit
`CRYPTO_ALLOW_UNRECONCILED_SOLANA_DEPOSITS=1` development opt-in.

## Configuration

| Name | Scope |
|---|---|
| `CRYPTO_NETWORK` | Explicit `testnet` or `mainnet` selection for deposit derivation, watch identity, webhook network binding, token contracts, and shared crypto reads. Unset never implies mainnet; it must match `PAYOUT_NETWORK` when both are configured. |
| `ALCHEMY_API_KEY` | Scoped Chain/Data API credential for API-owned EVM RPC. Use it as a Bearer credential, never in a logged URL. |
| `ALCHEMY_NOTIFY_AUTH_TOKEN` | Notify control-plane token used for bounded team-webhook metadata GET, paginated address-membership GET, and PATCH of one existing webhook's desired address membership. |
| `AGENTTOOL_PUBLIC_URL` | Explicit HTTPS API origin used to verify each webhook callback target. The watch worker does not guess the production URL. |
| `ALCHEMY_WATCH_TARGET_REVISION` | Positive bounded integer, default `1`. It is the monotonic operator version for the worker's active and disabled target declarations. Increase it for any webhook ID, callback, or active/disabled change; never reuse a revision for different target facts. |
| `ALCHEMY_WATCH_DISABLED_CHAINS` | Optional exact comma-separated EVM chain names. Each entry tells worker preparation to bind an explicit disabled tombstone at the current target revision. No whitespace, duplicates, empty entries, or unsupported chains are accepted. Omission does not disable a chain. A configured webhook ID may remain for signed ingress from previously watched addresses, but is excluded from active reconciliation. |
| `ALCHEMY_WEBHOOK_SIGNING_KEY_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | The signing key from that specific webhook's detail page; used only for raw-body HMAC verification on the matching route. Its presence is required before disclosing that chain's address, but its bytes and any secret-derived fingerprint are never persisted. |
| `ALCHEMY_WEBHOOK_ID_{ETHEREUM,BASE,POLYGON,ARBITRUM,OPTIMISM}` | Existing per-chain Address Activity webhook IDs used for reconciliation and signed-delivery identity binding. |

Use separate provider apps/keys for development and production. Provider IP,
domain, method, network, and address allowlists narrow only the dimensions they
document; none is a wallet spending policy. No credential value belongs in
repository config, docs, logs, RPC URLs, Collab records, or model-facing
errors.

## Rollout and remaining proof

The repository contains five rollout-gated identity/watch/finality migrations.
Their presence in source does not prove that a target database has applied
them; use the current migration journal survey and deploy receipt. The finality
migration deliberately keeps the database default at `credited` so an old
immediate-credit replica cannot write a wallet effect mislabeled as `pending`;
new code always writes an explicit state.

Whenever any of those migrations is pending, cutover requires an operator to:

1. stop old API writers, webhook ingress, and all related workers;
2. apply and review the identity, watch, finality, target-binding, and
   target-registry migrations;
3. deploy only the new writers/workers; and
4. run a credentialed testnet proof of webhook metadata, pagination,
   PATCH-then-GET convergence, signed callback delivery, RPC evidence, reorg
   handling, and wallet effects.

Hermetic tests do not prove a provider account, credential, DNS/TLS path,
deployed migration, background worker, or live webhook works. The current code
also lacks disposable-PostgreSQL concurrency tests for pending credit,
duplicate confirmation, generation replacement, reversal, and quarantine.

Before stronger production claims:

- add a scoped operator surface for reconciliation after a blocked watch is
  repaired; the internal seam exists, but there is no supported route or CLI;
- add those database behavior/concurrency tests;
- add durable alerts for old pending observations, quarantine, rejection,
  negative balances, and exhausted watch attempts, plus a confirmation lease
  if duplicate RPC load becomes material;
- add bounded `Retry-After`, jitter, and telemetry for read-only provider
  calls without automatically retrying ambiguous broadcasts;
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
