# @agenttool/wallet-zerone

> Offline-first Zerone transaction encoding and verification for
> capability-bounded Agent Wallet intents.

`@agenttool/wallet-zerone` is the narrow chain adapter between
`@agenttool/wallet` and Zerone. It turns an already verified Wallet intent
into exact Cosmos `SIGN_MODE_DIRECT` bytes, verifies the returned secp256k1
signature and `TxRaw`, and supplies injected query, simulation, broadcast, and
lookup boundaries.

Version `0.1.1` is the current exact `love-package/v1` release. It remains a
local offline runtime and has not become a hosted bridge, signer, custody
provider, or RPC service. npm and GitHub are optional mirrors whose exact
availability must be checked independently. The immutable `0.1.0` LOVE
artifact remains public, but its embedded docs call it a release candidate;
this paragraph is the public erratum and those historical bytes are not
rewritten. Its wire contract is pinned to zerone-core commit
`35284a22192df8fc6273135f14e8549c804778b6` and Cosmos SDK `v0.50.15`.

It does not derive, accept, store, or export private keys or mnemonics. It does
not choose a custody provider, bundle an RPC URL or bearer credential, retry a
broadcast, persist sequence/budget state, or expose a combined sign-and-send
operation.

## Supported contract

The 0.1 allowlist is deliberately small:

- Zerone mainnet `cosmos:zerone-1` and testnet
  `cosmos:zerone-testnet-1`;
- canonical lowercase `zrn` Bech32 20-byte accounts;
- compressed secp256k1 keys and one direct signer;
- `/cosmos.bank.v1beta1.MsgSend` with exactly one positive `uzrn` coin; and
- `/zerone.substrate_bridge.v1.MsgSubmitExternalAttestation` for
  `agenttool-invocation-v1` / `agenttool.invocation`, using the witness-only
  link subset.

The Wallet method has no leading slash:
`zerone.substrate_bridge.v1.MsgSubmitExternalAttestation`. The protobuf
`Any.type_url` does have a leading slash. Mixing them is rejected.

The native asset IDs use the adapter-local forms
`cosmos:zerone-1/denom:uzrn` and
`cosmos:zerone-testnet-1/denom:uzrn`. `denom` here is a local profile
namespace, not a claim that it is registered by CAIP. BIP-44 coin type `118`
is derivation metadata only; it does not identify ZRN as a SLIP-44 asset.

## Safe invocation witness

Use `createAgentToolInvocationWitnessLink()` for marketplace invocations. It
accepts only the exact ten-field public projection used by the pinned Go
relay, requires `status === "released"`, a non-empty `completion_sig`, and a
non-empty `settled_at`, and binds `source_id` to the projection's invocation
ID.

```typescript
import {
  createAgentToolInvocationWitnessLink,
} from "@agenttool/wallet-zerone";

const link = createAgentToolInvocationWitnessLink({
  invocation: releasedPublicInvocationProjection,
  source_id: releasedPublicInvocationProjection.id,
  source_url:
    `https://api.agenttool.dev/v1/invocations/${releasedPublicInvocationProjection.id}`,
  fetched_at_block: observedHeight,
});
```

The content hash matches Go `encoding/json` field order and escaping. The link
hash matches the pinned `keeper.ComputeLinkHash` recipe. That keeper recipe
does not bind `source_url` or `source.adapter_id`; this adapter therefore
requires `source.adapter_id` to stay empty and constrains the URL to canonical
HTTPS with no credentials, query, or fragment. The URL remains inside the
signed protobuf message even though changing its host does not change the
keeper link hash.

Low-level hash and link helpers are exported for parity testing. They do not
perform the released-invocation check; production callers should use the
high-level helper.

The high-level helper validates and hashes caller-supplied public data. It
does not fetch the invocation, authenticate the AgentTool API response, or
cryptographically verify the meaning or issuer of `completion_sig`. The host
must obtain the projection through an authenticated, freshness-bounded source
and apply its own completion-evidence policy before creating the link.

## Sign-time flow

A host should keep policy, chain observation, simulation, signing, and
broadcast as distinct steps:

1. Verify the Wallet descriptor, capability, intent, and simulation receipt
   with `@agenttool/wallet`.
2. Query the exact source `BaseAccount` and, for attestations, the exact active
   adapter registration through injected transports.
3. Call `createZeroneDirectSignPlan()`. It binds chain, source, signer,
   account number, sequence, fee, gas, ordered messages, declared spend,
   adapter snapshot, protobuf body, `AuthInfo`, `SignDoc`, and simulation
   `TxRaw`.
4. Simulate `plan.simulation_tx_bytes_b64u`, then seal the resulting Wallet
   simulation receipt.
5. Call `createZeroneSimulationBinding()` with that exact verified receipt and
   transport result.
6. Inside one durable sign-time transaction, re-read capability usage and
   the exact account and adapter observations, repeat Wallet authorization,
   reserve spend/fee/nonce, and persist at least
   `{ plan_id, simulation_record_id, simulation_tx_bytes_hash }`. If account
   number, sequence, registered key, adapter state, bond floor, qualification
   rule, work-class list, or relevant height changed, discard the plan and
   rebuild and re-simulate it; do not patch or reuse its bytes.
7. Call `createZeroneSigningRequest()` with the exact plan, verified
   simulation, binding, and authorization. Pass that request to a
   non-exportable signer provider.
8. Call `createZeroneSignedPayload()` or `verifyZeroneSignedPayload()`. The
   adapter verifies the compact lower-S Cosmos secp256k1 signature and exact
   planned `TxRaw` before returning the uppercase precomputed transaction hash.
9. Persist the signed bytes, hash, and operation state before invoking
   `broadcastOnce()` exactly once.

Runtime brands and object-identity bindings prevent substitution inside one
process. They are not durable proof. JSON serialization, cloning, or process
restart removes that protection, so the host must persist and re-verify the
explicit identifiers and hashes at its transaction boundary.

An unset `BaseAccount.pub_key` is accepted because the first transaction may
set it. A registered key is accepted only when it is exactly the same Cosmos
secp256k1 key. Rotated Ed25519, unknown key types, and key mismatches are
unsupported because the pinned chain's auth path would not verify these
direct-sign bytes safely.

## Gas and fee floor

The pinned Zerone `ZRNGasDecorator` is skipped during simulation but enforced
during CheckTx and DeliverTx. The adapter therefore computes a separate
`required_gas_limit`:

```text
max(22,222, sum(21,000 for each MsgSend
                + 22,222 for each MsgSubmitExternalAttestation))
```

The attestation message is unmapped in the pinned table and therefore uses
the decorator's 22,222 fallback per message. `gas_limit` must meet that exact
ordered-message floor and stay at or below `11,111,111`. The fee must be
positive `uzrn`, meet the pinned consensus floor of one `uzrn` per gas unit,
and remain within the intent's `max_fee`.

A successful simulation alone is not authoritative for this ante rule. At the
pinned commit, simulation also skips the emergency-halt, DID, frozen-account,
and Zerone capability decorators. The adapter emits no memo, so the DID path
is normally inert, but the other state can still change before delivery.
Simulation is bounded evidence about exact bytes and observed state, not a
promise that CheckTx or DeliverTx will accept them.

## Network boundary and recovery

`createZeroneAdapterClient()` accepts caller-supplied transports. It supplies
fixed network context, deadlines, a 2 MiB `max_response_bytes` instruction,
and an `AbortSignal`; it supplies no URLs, credentials, retry loop, or hidden
network fallback. Those limits are cooperative at the I/O boundary: the
injected transport must enforce the byte cap while streaming and before
allocation, and must use the signal to cancel provider work where possible.
The adapter also validates serialized response size after return, but that
cannot undo an allocation already made by the transport.

If the broadcast transport was never invoked, an invalid deadline or an
already-aborted signal throws and is safe to correct locally. Once the
transport closure is invoked, timeout, abort, provider exception, malformed
response, wrong hash, or oversized response returns `ambiguous` with the
precomputed transaction hash. The host must not broadcast the bytes again.
An external abort returns the adapter call promptly even if the injected
transport ignores the signal, but no JavaScript signal universally cancels an
underlying socket, remote provider, or already transmitted request; ambiguity
is the only safe result.

Transaction lookup absence or provider unavailability does not authorize a
retry, refund, new sequence reservation, or a second signer call. Positive
lookup evidence can resolve the known hash. The adapter marks a code-zero
transaction confirmed after one additional committed block; that means only
that the transaction was included successfully at the configured depth.

It does not mean that an external attestation is `READY`, `SETTLED`, that its
bond was returned, or that a witness reward was paid. The pinned message
response and `external_attestation_submitted` event expose
`attestation_id`. A host that needs application settlement must recover that
ID from the exact typed response/event, then query the module's typed
`Attestation` service through gRPC, ABCI, or the Zerone CLI and track its
status separately. Witness-only settlement returns the bond separately from
any witness reward. A configured reward remains escrowed through its challenge
window: adapter suspension defers release, tombstoning cancels it, and the
chain supply cap may clip the amount actually minted.

Although the module proto carries HTTP annotations, the pinned
`AppModuleBasic.RegisterGRPCGatewayRoutes` implementation is empty. This
package therefore does not claim that the custom
`/zerone/substrate_bridge/v1/...` REST paths are reachable. A deployment may
add independent routing, but the host must configure and authenticate that
transport explicitly.

## Attestation competition limits

The chain reserves an `(adapter_id, source_id)` on first successful
submission. The content hash and link hash make later verification
re-derivable, but they do not prove that a pending transaction will win that
reservation. A copied link can be submitted by another account before
inclusion, particularly for an open adapter. This package does not provide a
private mempool, anti-front-running relay, qualification proof, or atomic
source reservation. Treat those as deployment-level risks; never infer
settlement or reward entitlement from a locally signed transaction.

## Development and parity

```bash
# From the repository root. The adapter's local file dependency captures
# Wallet's built dist, so build Wallet before installing the adapter. --force
# refreshes that locked file dependency; it does not update dependency versions.
(cd packages/wallet \
  && bun install --frozen-lockfile \
  && bun run build)
(cd packages/wallet-zerone \
  && bun install --frozen-lockfile --force \
  && bun run ci \
  && npm pack --ignore-scripts --dry-run)
```

The checked-in vector was generated independently with zerone-core's own
protobuf types, `keeper.ComputeLinkHash`, Cosmos SDK `v0.50.15`
unmarshal/re-marshal, and `secp256k1.PubKey.VerifySignature`. It also asserts
that simulation `TxRaw` has exactly one empty signature.

```bash
# Networked pinned checkout:
./scripts/regenerate-go-cosmos-vector.sh --check

# Or reuse a local pinned checkout and cached Go modules:
ZERONE_CORE_CHECKOUT=/path/to/zerone-core \
GOPROXY=off GOSUMDB=off \
./scripts/regenerate-go-cosmos-vector.sh --check
```

Use `--write` only when intentionally regenerating the committed vector after
reviewing the pinned chain change.

The normative adapter draft is
[`docs/specs/AGENT-WALLET-ZERONE-0.1.md`](../../docs/specs/AGENT-WALLET-ZERONE-0.1.md).

## License

Apache-2.0. The protocol draft is offered under CC0 unless a section states
otherwise.
