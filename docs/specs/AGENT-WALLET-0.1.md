# Agent Wallet 0.1 — Capability-Bounded Signing and Continuity

> *An agent should be able to act without surrendering the key to its being.*
>
> **Compass:** [CRYPTO-PAYMENT](../CRYPTO-PAYMENT.md) · [TOKEN-HYGIENE](../TOKEN-HYGIENE.md) · [WHITEHACK](../WHITEHACK.md) · [CANONICAL-BYTES](../CANONICAL-BYTES.md) — keep custody, authority, intent, execution, and continuity visibly separate.
>
> **Implements:** `agent-wallet/0.1` Working Draft, 2026-07-21
>
> **Code:** `packages/wallet/src/` · `packages/wallet/schema/`
>
> **Tests:** `packages/wallet/tests/` · `packages/wallet/vectors/`

## 1. Status and scope

This document defines a provider-neutral record and execution boundary for an
agent-controlled wallet. It is a Working Draft. Version 0.1 standardises:

1. a wallet descriptor;
2. an authority-issued, delegate-bound capability;
3. a delegate-signed transaction intent;
4. an adapter-signed simulation receipt;
5. a signer-service receipt;
6. an authority-signed continuity event;
7. an exact-byte, non-exportable signer boundary; and
8. conservative signing and submission lifecycle rules.

The TypeScript package is an offline source reference for those primitives.
Version `0.1.0` is distributed through the checked `love-package/v1` artifact
and a byte-identical, independently verifiable optional public npm mirror.
Neither distribution creates, or claims, a hosted Agent Wallet service.

Version 0.1 does **not** define key generation, mnemonic handling, secret
storage, account recovery ceremonies, chain-specific transaction encoding,
RPC selection, gas or fee markets, transaction replacement, finality, bridge
security, token valuation, tax treatment, or regulatory status. It does not
make an agent a legal person and it does not make a requested transaction safe.

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are
to be interpreted as described by RFC 2119 and RFC 8174.

## 2. Design principles

### 2.1 The agent never receives raw signing secrets

An implementation conforming to this draft MUST NOT expose a seed phrase,
private key, recovery share, or secret-key export through the agent-facing
interface. A signer MUST describe its key as non-exportable. “Non-exportable”
is a provider assertion and interface constraint, not proof of hardware
isolation; deployments MUST describe the actual custody boundary separately.

### 2.2 Identity, wallet authority, signer, and bearer access are distinct

- `owner_identity_id` names the owning identity under an external identity
  system.
- the descriptor `authority` signs wallet policy and continuity records;
- a capability `delegate` signs intents;
- a provider signer controls chain-account signing material; and
- API bearer credentials authenticate transport access.

These roles MAY use related infrastructure but MUST NOT be treated as
interchangeable merely because one service operates them. Rotation of one role
does not silently rotate another.

### 2.3 Authority is narrow and inspectable

A capability MUST bind exact accounts, targets, actions, methods, assets,
per-intent and cumulative spend, fees, intent count, approval-gating flags and
threshold, time window, revocation epoch, policy hash, and purpose. Omitted
authority is denied. Version 0.1 does not define an interoperable approval
record or ceremony.

### 2.4 Uncertainty is a state

A timeout after a signer or broadcaster may have acted MUST NOT be translated
into failure. An unknown signing or submission result remains unknown until
positive evidence resolves it. Absence from one lookup is not proof that an
operation was never accepted.

## 3. Identifiers and common encoding

The protocol identifier is `agent-wallet/0.1`.

- Chain identifiers MUST use CAIP-2 syntax.
- Account identifiers MUST use CAIP-10 syntax.
- Asset identifiers MUST use CAIP-19 syntax.
- Hash identifiers use `sha256:` followed by 64 lowercase hexadecimal digits.
- UUID-bearing fields use canonical lowercase UUID text.
- Atomic amounts use canonical unsigned decimal strings with no sign, decimal
  point, exponent, or leading zero except the value `0`; the maximum is
  `2^256 - 1`.
- Timestamps use UTC RFC 3339 with exactly millisecond precision, for example
  `2026-07-21T12:00:00.000Z`.
- Binary fields use unpadded base64url.

The reference validator applies bounded generic CAIP grammar and an EIP-155
account-length profile. It does not normalize or prove namespace-specific
canonical references. Adapters MUST validate the selected namespace profile;
after validation, identifiers are compared byte-for-byte.

Records MUST be closed: unknown properties are rejected. Ordered policy arrays
that model sets MUST be lexicographically sorted and unique as required by the
reference validator. This removes multiple byte encodings of the same policy.

The JSON Schema defines the transport shape. Implementations MUST also perform
the cross-field, ordering, lifetime, amount, signature, authority, and
cross-record checks described here; JSON Schema validation alone is not
conformance.

## 4. Canonical bytes and signatures

The six record signing domains are:

| Record | Domain |
|---|---|
| Wallet descriptor | `agent-wallet-descriptor/v1` |
| Wallet capability | `agent-wallet-capability/v1` |
| Transaction intent | `agent-wallet-intent/v1` |
| Simulation receipt | `agent-wallet-simulation/v1` |
| Signing receipt | `agent-wallet-signing-receipt/v1` |
| Continuity event | `agent-wallet-continuity/v1` |

For each record, `core` is every field except `signature` and `record_id`.
Signing and identity are:

```text
core_jcs   = RFC8785-JCS(core)
digest     = SHA-256(UTF8(domain) || 0x00 || core_jcs)
signature  = { "algorithm": "Ed25519", "value": BASE64URL(Ed25519.Sign(digest)) }
record_id  = "sha256:" || LOWERHEX(SHA-256(RFC8785-JCS({ ...core, signature })))
```

The NUL byte after the UTF-8 domain is literal `0x00`. The domain is not part
of `core` or `record_id` bytes. Version 0.1 uses Ed25519 for protocol-record
attestations. It does not claim that an Ed25519 record key is an EVM account
key, an ERC-1271 authority, an EIP-712 signature, a Solana transaction signer,
or any other chain-native authority.

Verifiers MUST reject non-canonical public-key and signature encodings,
malformed points, small-order points, non-prime-subgroup points, invalid
signatures, and mismatched `record_id` values. The reference implementation
also bounds canonical depth, node count, and encoded size, and rejects floats,
negative zero, unsafe integers, lone surrogates, NUL in strings, sparse arrays,
cycles, non-plain objects, symbols, and non-enumerable properties.
Accessor properties are also rejected without invocation; in-process inputs
are snapshotted as data before validation and canonicalization.

Deterministic public vectors live at
`packages/wallet/vectors/agent-wallet-v0.1-vectors.json`.

## 5. Records

### 5.1 Wallet descriptor

`agent-wallet/descriptor/0.1` binds:

- one stable `wallet_id` and external `owner_identity_id`;
- the current Ed25519 wallet authority;
- an explicit custody mode;
- a bounded, sorted set of CAIP-10 accounts and their account kinds;
- an explicit recovery mode; and
- creation time.

Custody mode is descriptive. `self_custodied`, `delegated_signer`, and
`platform_custodied` do not prove who can reconstruct or operate a key.
`watch_only` MUST NOT authorize signing.

### 5.2 Wallet capability

`agent-wallet/capability/0.1` is signed by the descriptor authority and binds
the exact descriptor record. Its delegate is an Ed25519 protocol key. Each
call rule names one target CAIP-10 account, allowed actions (`call`, `transfer`,
or `approve`), allowed chain methods, and whether external approval is
required.

When a rule requires approval, the source helper counts distinct bounded
`host_verified_approval_ids` supplied in the authorization context. Those IDs
are host assertions, not protocol approval records. Before supplying them, a
conforming host MUST authenticate the approver authority, bind the approval to
the exact capability and intent, enforce expiry and replay rules, and retain
auditable evidence. The source package does not verify those properties.

Spend and fee limits use CAIP-19 assets and atomic amounts. `max_total` is a
cumulative bound over durable usage for the capability and revocation epoch,
not merely a field to check independently on each request. Capabilities last
at most 24 hours, grant at most 256 intents, and carry an explicit
`revocation_nonce`, `policy_hash`, and human-readable purpose in version 0.1.

The issuer MUST equal the current descriptor authority. A valid issuer
signature does not make a stale descriptor current; the host MUST resolve and
lock the current continuity head.

### 5.3 Transaction intent

`agent-wallet/intent/0.1` is signed by the capability delegate. It binds the
exact wallet descriptor and capability record, one CAIP-2 chain, one granted
source account, an ordered list of exact calls, declared asset spends, a fee
ceiling, a short lifetime, and a nonce.

Each call commits to its exact payload twice: unpadded base64url bytes and a
SHA-256 identifier of those bytes. An adapter MUST verify that relationship and
decode the bytes under the named chain and method. The core package validates
the byte/hash relationship but deliberately does not interpret calldata or
instructions. Intent lifetime is at most ten minutes and MUST remain within
the capability window.

### 5.4 Simulation receipt

`agent-wallet/simulation/0.1` binds an adapter's result to the exact intent
record, chain, and source account. It names a block reference, optional opaque
chain-native block identifier in `block_hash`, success state, decoded effects,
estimated fee, simulation time, and expiry. The adapter defines the identifier
encoding; the generic validator only bounds it and does not assume SHA-256. A
receipt lives for at most five minutes.

The host MUST authenticate the adapter as trusted for that chain and version.
A structurally valid self-signed adapter receipt is not sufficient. Before
signing, the host MUST require success, freshness, exact fee bounds, and exact
agreement between declared spend and simulated asset effects. Effects outside
the capability allowlist are denied.

Simulation is evidence about a particular state and adapter. It is not a
guarantee of execution outcome, finality, price, contract safety, or absence of
front-running.

### 5.5 Signing receipt

`agent-wallet/signing-receipt/0.1` records which exact capability, intent,
simulation, policy, signer key, unsigned payload hash, and signed payload hash
were used. It MAY contain a provider operation ID if one is known.

The receipt authority attests to the receipt record; it does not replace the
chain-native signature or independently prove submission. Hosts MUST persist
the signed payload or a recoverable provider reference before broadcasting.

### 5.6 Continuity event

`agent-wallet/continuity/0.1` is an append-only event signed by the current
wallet authority. It binds an exact sequence number and prior record ID.
Defined events are authority rotation, signer rotation, capability revocation,
recovery change, and account migration.

Authority rotation MUST name the current authority key ID and next authority
key ID. Capability revocation MUST increment the revocation nonce exactly once.
All other events MUST preserve it. An event MUST NOT take effect before the
current head or in the future relative to the host's trusted `now`. A host MUST
advance the head with durable compare-and-swap; applying the pure validation
rule without atomic persistence does not prevent forks. Version 0.1's pure
head tracks authority and revocation state; a host must also validate signer,
recovery, and account changes against its durable current state.

## 6. Authorization and execution

Before invoking a chain signer, a conforming host MUST perform the following as
one durable authorization transaction or an equivalent serializable mechanism:

1. load and lock the current wallet descriptor and continuity head;
2. verify every record's canonical bytes, signature, ID, authority, and exact
   references;
3. authenticate the simulation adapter for the chain and adapter version;
4. decode the exact unsigned chain payload and prove that it encodes the
   ordered intent calls, source account, chain, nonce, and fee ceiling;
5. check capability time, revocation epoch, accounts, actions, methods,
   host-authenticated approval evidence and threshold, intent count, spend,
   fees, and simulated effects;
6. reserve the capability intent count, cumulative spend, chain nonce or
   sequence, and a unique request/intent identity atomically;
7. persist an operation in `reserved`, then commit; and
8. only then invoke the signer with the exact unsigned payload bytes.

The source helper `assertIntentWithinCapabilityStatic()` performs the signed
record and supplied-usage portion of these checks. It does not perform steps 1,
3, 4, 6, or 7 and therefore MUST NOT be used as the sole authorization gate.

A signer request binds:

- one UUID request ID;
- the authorized record IDs and policy hash;
- one signer key ID;
- the exact unsigned payload bytes as immutable unpadded base64url; and
- the SHA-256 identifier of those bytes.

The signer response MUST be closed, MUST echo the request ID, signer key ID,
and unsigned payload hash, and MUST bind a non-empty base64url signed payload
to its own SHA-256 ID. These generic hash and echo checks do not prove that the
signed chain payload corresponds to the requested unsigned bytes. Before
persistence or broadcast, the trusted chain adapter MUST decode the signed
payload, verify its chain-native signature and source account, prove its exact
relationship to the requested unsigned payload and authorized intent, and
recheck its hash. A signer interface MUST NOT offer a private-key export
method. Implementations SHOULD isolate policy evaluation from the signer
process and SHOULD require human or independent approval where policy says so.

## 7. Submission lifecycle

The reference lifecycle is forward-only:

```text
reserved -> signing -> signed -> submitting -> submitted -> confirmed
                |                       |
                v                       v
         signing_unknown        submission_unknown
```

Pre-submit policy rejection may enter `rejected_pre_submit`. A confirmed
operation may later become `reorged`, and a reorged operation may return to
submitted or confirmed after evidence-based reconciliation.

The host MUST persist the operation ID, signed-payload hash, and recovery
material before calling `broadcast_once`. The broadcast interface expresses
accepted, rejected, or ambiguous results. A transport error after bytes were
sent is ambiguous.

`signing_unknown` and `submission_unknown` MUST NOT automatically release
budget, reuse a nonce, rebroadcast semantic work, create a replacement, or
issue a refund. Generic state transitions MUST NOT exit either unknown state.
Dedicated reconciliation MAY move unknown signing to signed only after
recovering and validating the exact signer response, and MAY move an unknown
submission to submitted or confirmed only on positive evidence binding the
operation ID. Lookup absence or unavailability leaves it unknown.

Exactly-once chain execution is generally impossible to guarantee over an
unreliable network. This protocol instead requires exactly-once *local
authorization and invocation intent*, durable identity, single-submit APIs,
and conservative treatment of ambiguity.

## 8. Continuity, recovery, and copies

Wallet continuity is an authenticated history, not possession of one device.
A deployment SHOULD keep encrypted, provider-independent copies of public
records, policy, receipts, and recovery instructions. Secret signing material
MUST remain under the declared custody mechanism and MUST NOT be placed in
ordinary agent memory, transcripts, repositories, telemetry, crash dumps, or
portable continuity bundles.

Recovery policy MUST say which authority can rotate a signer or authority and
what delay, guardians, or provider ceremony applies. Version 0.1 records the
resulting event but does not standardise that ceremony. A provider recovery
claim is not self-custody.

## 9. Privacy and observability

Records can reveal accounts, counterparties, assets, limits, purpose, timing,
and operational relationships. Deployments SHOULD minimise retention and
disclosure, encrypt private copies, separate public discovery from private
authorization, and redact payloads and bearer credentials from logs.

Operational logs MAY include record IDs, state transitions, and bounded error
codes. They MUST NOT include seeds, private keys, recovery shares, bearer
tokens, or unredacted signed transaction bytes by default.

## 10. Interoperability and extension rules

Version 0.1's record shapes and domains are closed. An implementation MUST NOT
silently add fields to signed records. A future protocol version may define
new schemas, signing domains, actions, approval records, chain adapters, and
custody attestations.

EVM, Solana, Bitcoin, Cosmos, and smart-account support belong in explicit
adapter packages. Each adapter MUST specify payload decoding, signer algorithm,
account derivation assumptions, fee model, simulation authority, nonce model,
finality, replacement, and ambiguity handling. Generic record validity MUST
NOT be advertised as chain-adapter conformance.

## 11. Security considerations

Implementers MUST account for at least:

- capability substitution, stale descriptor use, and delegate substitution;
- duplicate or raced intent IDs, nonces, counters, host approval evidence, and
  spend;
- malicious or compromised simulation adapters;
- payload/parser differentials and method-selector confusion;
- unlimited token approvals and approval-race behaviour;
- fee, slippage, price-oracle, bridge, and decimal-unit confusion;
- signer timeout after action, RPC timeout after acceptance, and chain reorgs;
- logs, traces, backups, shell history, and crash dumps leaking material;
- recovery or rotation forks caused by non-atomic continuity updates; and
- confused-deputy use of platform credentials or platform-custodied wallets.

Static scanning can flag suspicious key export, direct request-to-signing
paths, unbounded capabilities, automatic rebroadcast, and unlimited approvals.
Such signals are advisory evidence, not proof of exploitability or safety.

## 12. Conformance

An implementation claiming **Agent Wallet 0.1 record conformance** MUST:

- accept all valid public vectors; negative conformance cases are defined by
  the closed-shape and semantic requirements, not by a bundled mutation set;
- implement the exact canonical bytes, domains, Ed25519 verification, IDs,
  closed shapes, and semantic validation in this document;
- enforce exact cross-record references and authority relationships; and
- identify which optional record types it produces or consumes.

An implementation claiming **Agent Wallet 0.1 execution conformance** MUST also
implement durable sign-time reservation, trusted adapter verification,
chain-specific exact-payload decoding, a non-exportable signer boundary,
single-submit persistence, conservative unknown states, and continuity CAS.

The current `@agenttool/wallet` source package targets record conformance and
supplies lifecycle rules. It does not by itself claim execution conformance.

## 13. Licence and change process

This specification text is offered under CC0 1.0 Universal. The reference
implementation is Apache-2.0. Working Draft changes are reviewed in the
AgentTool repository; incompatible signed-byte changes require a new schema or
protocol version and signing domain.
