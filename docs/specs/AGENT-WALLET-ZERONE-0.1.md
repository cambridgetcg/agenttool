# Agent Wallet Zerone 0.1 — Exact Direct Sign and Witness Adapter

> **Extends:** [Agent Wallet 0.1](./AGENT-WALLET-0.1.md)
>
> **Implements:** `agent-wallet-zerone/0.1` Working Draft, 2026-07-28
>
> **Code:** `packages/wallet-zerone/src/`
>
> **Tests and vectors:** `packages/wallet-zerone/tests/` ·
> `packages/wallet-zerone/vectors/`

## 1. Status and scope

This document defines the 0.1 Zerone chain adapter for Agent Wallet. It is a
Working Draft pinned to zerone-core commit
`35284a22192df8fc6273135f14e8549c804778b6` and Cosmos SDK `v0.50.15`.
The reference implementation is distributed as the exact public
`@agenttool/wallet-zerone@0.1.1` LOVE artifact. npm and GitHub are optional
mirrors and must be verified independently. Package distribution does not
imply a hosted service, deployed bridge, custody, host execution conformance,
or live-chain execution.

Version 0.1 standardises:

1. Zerone chain, account, key, and native-asset profiles;
2. a closed two-message allowlist;
3. exact AgentTool invocation content and keeper-link hashing;
4. exact Cosmos `SIGN_MODE_DIRECT` unsigned and signed bytes;
5. binding between Wallet intent, chain observations, simulation,
   authorization, signing request, and returned `TxRaw`;
6. an injected, bounded, single-submit network boundary; and
7. conservative lookup and finality interpretation.

The reference package is offline-first. It does not define or supply custody,
key generation, mnemonic handling, RPC endpoints, bearer credentials,
qualification evidence, durable database transactions, sequence locking,
spend reservation, automatic rebroadcast, transaction replacement, private
mempools, bridge trust, token value, or legal or tax treatment.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY**
are interpreted as described by RFC 2119 and RFC 8174.

## 2. Protocol and pinned profile

The adapter protocol identifier is `agent-wallet-zerone/0.1`.

The supported networks are:

| Network | Cosmos chain reference | CAIP-2 | Native asset |
|---|---|---|---|
| Mainnet | `zerone-1` | `cosmos:zerone-1` | `cosmos:zerone-1/denom:uzrn` |
| Testnet | `zerone-testnet-1` | `cosmos:zerone-testnet-1` | `cosmos:zerone-testnet-1/denom:uzrn` |

`denom` is an adapter-local CAIP-19 namespace profile. This draft does not
claim that `denom` is a registered CAIP asset namespace.

The native minimal denomination is `uzrn`; the display denomination is `ZRN`
with six decimals. BIP-44 coin type `118` is derivation metadata only. It MUST
NOT be interpreted as a claim that ZRN owns the SLIP-44 asset identity
associated with coin type 118.

Account addresses MUST be lowercase Bech32 with HRP `zrn`, a valid checksum,
and exactly 20 decoded bytes. CAIP-10 accounts combine one supported CAIP-2
identifier with one such address.

The deterministic `substrate_bridge` module address is:

```text
BECH32("zrn", SHA-256(UTF8("substrate_bridge"))[0:20])
= zrn17s8zugqf6tja9srze24jl94a2k6scz4qx2gswf
```

The adapter pins these message identifiers:

| Meaning | Identifier |
|---|---|
| `MsgSend` protobuf type URL | `/cosmos.bank.v1beta1.MsgSend` |
| Attestation protobuf type URL | `/zerone.substrate_bridge.v1.MsgSubmitExternalAttestation` |
| Attestation Wallet method | `zerone.substrate_bridge.v1.MsgSubmitExternalAttestation` |
| Cosmos secp256k1 public key type URL | `/cosmos.crypto.secp256k1.PubKey` |
| Direct-sign algorithm | `cosmos.secp256k1.sign-mode-direct` |
| AgentTool adapter | `agenttool-invocation-v1` |
| AgentTool work class | `agenttool.invocation` |

Wallet methods omit the leading slash. Protobuf `Any.type_url` values include
it. Implementations MUST compare these identifiers exactly and MUST NOT
normalise one form into the other silently.

## 3. Closed protobuf subset

All accepted protobuf messages MUST be canonical for the supported subset.
Unknown, missing, duplicate, or reordered fields and non-minimal varints MUST
be rejected. A decoder MUST re-encode accepted values and require byte
identity. Message values are bounded to 64 KiB, transactions to 128 KiB, and
one intent to at most eight messages.

### 3.1 Native `MsgSend`

`MsgSend` MUST contain:

1. `from_address` equal to the intent source address;
2. one canonical supported `to_address`; and
3. exactly one positive coin whose denomination is `uzrn`.

Its Wallet call MUST use:

- action `transfer`;
- the recipient CAIP-10 account as `target_account`;
- `method: null`;
- empty payload; and
- exact native value in the network's adapter-local asset ID.

The simulation effect is the same native transfer. All send amounts
contribute to declared spend.

### 3.2 AgentTool external attestation

`MsgSubmitExternalAttestation` MUST contain:

- `submitter` equal to the intent source address;
- adapter ID `agenttool-invocation-v1`;
- work class `agenttool.invocation`;
- the witness-only `SubstrateLink` defined below; and
- one positive decimal `bond_uzrn`.

The corresponding Wallet call MUST use action `call`, the deterministic
`substrate_bridge` module account, and the exact no-slash Wallet method. Its
payload MUST be the canonical custom protobuf bytes. `native_value` MUST equal
the message bond exactly.

The adapter emits two Wallet simulation effects for one attestation:

1. a zero-asset, zero-amount module `call` using the exact Wallet method; and
2. a native `transfer` effect to the module account for the bond.

The capability therefore needs one module-target rule allowing both `call`
and `transfer`, with the attestation method in its method allowlist. The bond
contributes to declared spend.

An intent's single native declared-spend entry MUST equal the sum of every
`MsgSend` amount and every attestation bond exactly. Duplicate attestation
`source_id` values in one transaction MUST be rejected because the pinned
keeper reserves that source reference on first execution.

## 4. AgentTool invocation content

The supported off-chain content is the exact public invocation projection:

```text
amount
buyer_did
completed_at
completion_sig
created_at
currency
id
listing_id
settled_at
status
```

No other property participates. The canonical bytes MUST match the pinned Go
relay's `encoding/json` struct field order and compact encoding. Strings use
Go's default JSON escaping, including HTML-safe escapes for `<`, `>`, and `&`
and escapes for U+2028 and U+2029. `amount` MUST be a non-negative safe signed
64-bit integer. Invocation and listing IDs MUST be canonical UUIDs.

An invocation is attestable through the safe high-level path only when:

```text
status == "released"
completion_sig != null and completion_sig != ""
settled_at != null and settled_at != ""
source_id == invocation.id
```

Escrowed, refunded, incomplete, or unsettled work MUST be rejected.

This validation operates on caller-supplied projection data. It does not fetch
or authenticate the AgentTool API response and does not define or verify the
issuer or semantics of `completion_sig`. A conforming execution host MUST
obtain the projection through an authenticated, freshness-bounded source and
apply its completion-evidence policy before submitting it.

The content hash is:

```text
content_hash = SHA-256(canonical_invocation_bytes)
```

## 5. Witness link and keeper hash

Version 0.1 accepts a `SubstrateLink` with:

- no cited facts;
- no pending claims;
- no recursion weight;
- adapter ID `agenttool-invocation-v1`;
- one external source; and
- one 32-byte link hash.

The external source has:

- empty `adapter_id`;
- canonical UUID `source_id`;
- canonical absolute HTTPS `source_url`, with no credentials, query, or
  fragment, whose path is exactly `/v1/invocations/{source_id}`;
- a 32-byte `content_hash`; and
- canonical unsigned 64-bit `fetched_at_block`.

The pinned `keeper.ComputeLinkHash` recipe for this subset is:

```text
U32BE(len(adapter_id)) || UTF8(adapter_id)
|| U32BE(len(source_id)) || UTF8(source_id)
|| U32BE(len(content_hash)) || content_hash
|| U64BE(fetched_at_block)

link_hash = SHA-256(the bytes above)
```

The pinned keeper does not bind `source_url` or `source.adapter_id`.
Implementations MUST keep `source.adapter_id` empty rather than accept
attacker-controlled unbound metadata. `source_url` is constrained as above
and remains inside the signed protobuf message, but a URL-host change does not
change the keeper link hash. Implementations MUST describe that distinction
and MUST NOT advertise the link hash as committing to the URL.

## 6. Accounts and signer keys

The only chain signer is a compressed 33-byte secp256k1 public key. Its Zerone
address is:

```text
BECH32("zrn", RIPEMD-160(SHA-256(compressed_public_key)))
```

That address MUST equal the intent source address.

A supplied `BaseAccount` observation MUST bind the exact source CAIP-10
account, account number, sequence, and positive observation height. Both
public-key fields MAY be null for an account whose key has not yet been set.
Otherwise they MUST contain the exact
`/cosmos.crypto.secp256k1.PubKey` type URL and exact signer public key.

Ed25519 account keys, unknown key types, partially present key observations,
and changed secp256k1 keys MUST be rejected. This restriction avoids the
pinned auth-path hazard in which constructing a secp256k1 `SignerInfo` for a
rotated or differently typed account would not prove the intended authority.

The `SignerInfo` MUST include the matching secp256k1 `Any` even when the
observed account key is unset.

## 7. Exact direct-sign bytes

The unsigned body is a Cosmos `TxBody` containing only the ordered supported
message `Any` values. Memo, timeout height, extension options, and
non-critical extension options MUST be absent.

`AuthInfo` contains:

- exactly one `SignerInfo`;
- the matching secp256k1 public-key `Any`;
- one `ModeInfo.Single` with `SIGN_MODE_DIRECT`;
- the exact observed sequence;
- exactly one `uzrn` fee coin;
- the exact gas limit; and
- no payer, granter, or tip.

The signing bytes are the protobuf serialization of:

```text
SignDoc {
  body_bytes: exact TxBody bytes
  auth_info_bytes: exact AuthInfo bytes
  chain_id: "zerone-1" or "zerone-testnet-1"
  account_number: exact observed account number
}
```

The simulation transaction is:

```text
TxRaw {
  body_bytes: exact body bytes
  auth_info_bytes: exact AuthInfo bytes
  signatures: [ empty bytes ]
}
```

The single empty repeated signature element MUST be encoded, not omitted.

The signed transaction replaces that element with one compact 64-byte
secp256k1 signature over `SHA-256(SignDoc bytes)`. Verification MUST require
canonical lower-S ECDSA. High-S, malformed, or invalid signatures MUST be
rejected. The signed `TxRaw` body and `AuthInfo` MUST be byte-identical to the
plan; changing either is a signature/plan failure even if a generic Wallet
payload hash is internally consistent.

The transaction hash is:

```text
UPPERHEX(SHA-256(signed TxRaw bytes))
```

It MUST be computed before any broadcast attempt.

## 8. Intent and plan binding

Plan construction MUST start from an in-process verified
`agent-wallet/intent/0.1` record. It MUST bind:

- selected network and exact intent chain;
- exact source account and derived signer address;
- signer key ID and bytes;
- account number and sequence;
- fee and gas;
- ordered message values and hashes;
- exact simulation effects and declared spend;
- body, `AuthInfo`, `SignDoc`, and simulation `TxRaw` bytes and hashes; and
- adapter snapshot height for attestations.

The plan ID is the `sha256:` identifier of exact `SignDoc` bytes. The reference
implementation also applies a private runtime brand to plan object identity.
Changing account number, sequence, fee, gas, message, or chain changes signed
bytes. Changing only adapter snapshot metadata may leave signed bytes equal;
it still creates a distinct plan object and MUST NOT inherit another plan's
simulation binding.

## 9. Adapter snapshot

Every attestation plan MUST include a caller-supplied adapter observation that
binds:

- the exact Zerone CAIP-2 chain;
- adapter `agenttool-invocation-v1`;
- status `active`;
- a minimum bond no greater than the submitted bond;
- an empty class allowlist or one containing `agenttool.invocation`;
- no required qualification domain; and
- an observation height at or after `fetched_at_block`.

Suspended or tombstoned adapters, missing work-class permission, insufficient
bond, future source heights, and non-null qualification domains MUST be
rejected. Qualification proofs are outside version 0.1 and MUST NOT be
assumed.

An adapter snapshot supplied to a send-only plan MUST be rejected to avoid
unbound state evidence.

## 10. Gas and fee

At the pinned commit:

```text
minimum transaction gas = 22,222
MsgSend mapped gas       = 21,000 per message
unmapped attestation gas = 22,222 per message
maximum transaction gas = 11,111,111
minimum fee              = 1 uzrn per declared gas unit
```

The pinned `ZRNGasDecorator` sums the message cost and then applies the
minimum:

```text
required_gas =
  max(22,222,
      sum(21,000 for each MsgSend
          + 22,222 for each MsgSubmitExternalAttestation))
```

The decorator skips this check during simulation and enforces it during
CheckTx and DeliverTx. A conforming adapter MUST compute the floor locally and
MUST NOT treat simulation success as evidence that the floor was met. For
example, two sends require 42,000 gas and two attestations require 44,444.

At the pinned commit, simulation also skips the emergency-halt, DID,
frozen-account, and Zerone capability decorators. The 0.1 adapter emits no
memo, so the DID path is normally inert, but emergency, account, and
chain-capability state remain delivery-time constraints. Simulation success
is bounded evidence about exact bytes at observed state, not proof of CheckTx
or DeliverTx success.

The selected gas MUST meet `required_gas` and the chain cap. The positive
`uzrn` fee MUST be at least the gas limit and no greater than the Wallet
intent's exact native `max_fee`.

## 11. Simulation and authorization binding

Simulation MUST use the exact planned simulation `TxRaw` and return its exact
hash. Status `succeeded` MUST correspond to code zero. The resulting verified
Wallet simulation receipt MUST bind the plan's intent, chain, source, block
height, exact effects, and exact native estimated fee.

Before creating a signing request, an implementation MUST bind:

```text
plan_id
intent_record_id
simulation_record_id
simulation_tx_bytes_hash
```

The reference implementation applies private object-identity bindings among
the plan, verified simulation receipt, binding, and adapter-created signing
request. A public generic `@agenttool/wallet.createSigningRequest()` result
MUST NOT enter the Zerone signed-payload path; it has not passed the adapter's
simulation binding.

The Wallet `AuthorizedIntent.simulation_record_id` MUST equal the exact
verified receipt and binding. Plan-A authorization, simulation, binding, or
request MUST be rejected with Plan B even when both plans name the same
intent.

Runtime brands and weak-map identity do not survive serialization or process
restart. A durable host MUST re-verify records and persist the explicit tuple
above inside the same atomic sign-time reservation that rechecks sequence,
capability counters, spend, fees, revocation, and approvals.

That transaction MUST re-read the exact source account and adapter
registration. If account number, sequence, registered key, adapter state,
minimum bond, qualification rule, work-class list, or relevant observation
height differs from the plan, the host MUST discard the plan, rebuild it from
new observations, and re-simulate. It MUST NOT patch or reuse old sign bytes.

## 12. Injected transport boundary

The reference client accepts separate query, simulation, and broadcast
transports. It fixes network context but does not select a URL, credential,
protocol gateway, retry policy, or provider.

Each call carries a monotonically increasing local operation number, exact
chain profile, `AbortSignal`, deadline, and a 2 MiB maximum-response
instruction. The default deadline is ten seconds; the maximum future window
is thirty seconds.

These limits are cooperative at the I/O boundary. The injected transport MUST
enforce the byte cap while streaming and before allocation, and SHOULD use the
signal to cancel socket/provider work where possible. The adapter validates
serialized JSON size after return, but that cannot undo a transport allocation
that already happened. An `AbortSignal` does not universally cancel an
underlying socket, remote provider, or request that has already been sent.
Returned JSON MUST nevertheless fit the cap and be a closed object binding the
exact request.

An invalid deadline or already-aborted signal MUST fail before the transport
closure is invoked. Once a broadcast closure is invoked:

- timeout;
- external abort;
- provider exception;
- provider-thrown validation-shaped error;
- malformed or extra response fields;
- wrong transaction hash;
- unsupported status or code; and
- oversized response

MUST produce `ambiguous` with the precomputed transaction hash. They do not
prove that bytes stayed local. The client SHOULD return promptly on its own
deadline or caller abort even if the injected transport ignores the signal,
but this does not cancel a request the provider may already have received.

Only an explicit `rejected_pre_submit` response asserts that the transport
proved rejection before any possible admission. That is a scoped provider
assertion, not a universal network guarantee.

The adapter MUST NOT retry broadcast automatically.

## 13. Lookup, inclusion, and application settlement

Transaction and block hashes in validated lookup responses are exactly 64
uppercase hexadecimal characters. A found transaction binds inclusion
height, observation height, code, codespace, and block hash. The observation
height MUST not precede inclusion.

The Wallet mapping marks a found transaction confirmed only when:

```text
execution code == 0
and observed height >= inclusion height + 1
```

Lookup absence and provider unavailability are non-authorizing evidence. They
MUST leave `submission_unknown` sticky and MUST NOT release spend, reuse a
sequence, rebroadcast, refund, or invoke another signer. A found nonzero-code
transaction resolves that it was submitted but does not mark it confirmed.

Code-zero inclusion does not prove an external attestation is `READY`,
`SETTLED`, that its bond was returned, or that a witness reward was paid.
These are module application states outside the transaction lifecycle.

The pinned message response and `external_attestation_submitted` event expose
`attestation_id`. A host that tracks settlement MUST recover that identifier
from exact typed response or event evidence, then query the module's typed
`Attestation` query through configured gRPC, ABCI, or CLI access.

Witness-only settlement returns the bond separately from any configured
witness reward. Reward minting waits until a challenge window survives. A
suspended adapter defers release by another window; tombstoning cancels the
pending reward; and the supply cap may clip the amount actually minted and
paid. Transaction inclusion and even attestation `SETTLED` MUST NOT be
reported as reward payment without the later release evidence.

The pinned module defines HTTP annotations in its proto, but
`AppModuleBasic.RegisterGRPCGatewayRoutes` is empty. Conformance MUST NOT claim
that custom `/zerone/substrate_bridge/v1/...` REST routes are reachable.
Deployment-specific routing MAY exist but is independently configured and
trusted.

## 14. Source reservation and front-running

The pinned keeper reserves one `(adapter_id, source_id)` on first successful
submission. It rejects later duplicates. This prevents simple replay after
inclusion; it does not guarantee that the locally signed transaction wins the
reservation.

Another participant may copy public link data and submit it first with their
own account, especially when an adapter has no qualification requirement.
Neither content hashing nor local signing provides a private mempool or
anti-front-running channel. Hosts MUST treat source competition, private
submission, qualification policy, and reward entitlement as deployment-level
concerns.

## 15. Security and privacy considerations

Implementers MUST account for:

- method/type-URL confusion and parser differentials;
- wrong chain, module target, denom, amount, bond, or declared spend;
- stale or substituted account and adapter observations;
- sequence, capability, and budget races outside the process;
- simulation that skips chain ante rules;
- public generic SigningRequest bypass;
- signer response substitution, high-S malleability, and changed `TxRaw`;
- transport timeouts after provider acceptance;
- absent lookup being mistaken for safe retry;
- inclusion being mistaken for attestation settlement;
- first-source reservation races and front-running;
- unbound source URL metadata;
- malicious or compromised query/simulation providers; and
- logs, traces, transcripts, crash dumps, and backups exposing credentials or
  signed production bytes.

No conforming interface accepts or returns a seed, mnemonic, private key, or
secret-key export. Implementations SHOULD keep policy evaluation, signer
custody, provider credentials, and transport processes separately scoped.

## 16. Conformance and independent vectors

An implementation claiming **Agent Wallet Zerone 0.1 wire conformance** MUST:

- implement the exact profiles, identifiers, message subset, canonical
  protobuf, invocation bytes, hashes, direct-sign bytes, signature rules, gas
  floor, and transaction hash in this document;
- accept the independent valid vector; and
- reject the negative canonicality, substitution, signer, fee/gas, snapshot,
  and signature cases described here.

An implementation claiming **Agent Wallet Zerone 0.1 execution conformance**
MUST additionally provide durable atomic sign-time reservations, trusted
observation and simulation providers, non-exportable signer custody,
single-submit persistence, conservative ambiguity, positive-evidence
reconciliation, and separate application-settlement tracking.

The checked-in vector at
`packages/wallet-zerone/vectors/agent-wallet-zerone-v0.1-vectors.json` is
generated independently inside the pinned zerone-core module. Its generator:

- uses zerone-core generated message types;
- calls the pinned `keeper.ComputeLinkHash`;
- uses Cosmos SDK `v0.50.15` `TxBody`, `AuthInfo`, `SignDoc`, and `TxRaw`;
- unmarshals and re-marshals each value byte-identically;
- asserts exactly one empty simulation signature; and
- verifies the signed fixture with Cosmos
  `secp256k1.PubKey.VerifySignature`.

TypeScript conformance tests compare the adapter's bytes and hashes to that
fixture rather than relying only on a TypeScript self-roundtrip.

## 17. Licence and change process

This specification text is offered under CC0 1.0 Universal. The reference
implementation is Apache-2.0. The draft is pinned to one chain commit;
changing a type URL, field shape, keeper hash, gas rule, signing byte,
algorithm, transport state, or finality claim requires reviewed vectors and,
when incompatible, a new adapter protocol version.
