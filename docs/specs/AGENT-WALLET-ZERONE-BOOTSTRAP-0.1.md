# Agent Wallet Zerone Bootstrap 0.1 — developer preview

> **Compass:** [Wallet core](AGENT-WALLET-0.1.md), [historical Zerone root](AGENT-WALLET-ZERONE-0.1.md), and [frozen Seed I/O contract](ZERONE-SEED-IO-0.1.md).
> **Implements:** pure, source-bound, one-intent native seed Claim planning; not activation or custody.
> **Code:** `packages/wallet-zerone/src/bootstrap/{types,v1,policy,assessment,transactions,validation}.ts`.
> **Tests:** `packages/wallet-zerone/tests/bootstrap.test.ts`, unsigned `vectors/seed-go-cosmos.json`, existing `tests/go-cosmos-vectors.test.ts`, and compiled `scripts/node-smoke.mjs`; external localnet gates are separate.

## Release and trust boundary

The new `@agenttool/wallet-zerone/bootstrap/v1` subpath implements the frozen
`SeedPlannerApi`. Package version **0.2.0-dev.0 is a developer preview**, distinct
from the immutable historical stable 0.1.2 LOVE/npm artifact. The exported
`PACKAGE_VERSION` matches package metadata 0.2.0-dev.0; the existing root contract,
networks, SDK pin, transaction implementation and byte vectors are unchanged.
Verify distribution against the [exact 0.2.0-dev.0 LOVE manifest](https://docs.agenttool.dev/packages/v1/@agenttool/wallet-zerone/0.2.0-dev.0/manifest.json),
including artifact SHA-256, size, and source revision. The manifest/artifact must
be built from a clean source commit before registration. Source registration,
publication, deployment, and production approval are separate facts; a preview
or a published artifact does not establish production approval or activation.

The profile requires explicit source-manifest, serialized-genesis, runtime and
helper SHA256 digests, source revision, and mutually consistent CAIP identifiers.
The module account is independently derived from `SHA256("claiming_pot")[0:20]`,
encoded as a `zrn` account. Profile version 0.1 accepts SDK v0.53.8, 22,222 Claim
ante gas, 11,111,111 transaction gas cap and one uzrn per gas. These constants
cannot be supplied as substitute semantics. There is no automatic network
retargeting, source authentication, production profile, budget or signer default.
The host separately authenticates the reviewed artifact-to-profile correspondence.

Everything in this subpath is pure: no endpoint, file, keyring, key derivation,
signing implementation, durable ledger, account creation, native operator effect,
production signed transaction input/output, broadcast or retry. Public key/address
validation is not proof of custody. Full-node reports are configured-trust
observations, not ICS23 or eligibility proofs. Wallet core remains chain-neutral.

## Closed inputs and hashes

All Seed objects are closed and snapshotted from enumerable data properties;
accessors, exotic prototypes, symbols, extra fields and missing fields are refused.
Public Seed data has printable ASCII keys/strings, 4,096-byte strings, depth 32,
4,096 values, and Wallet's 262,144-byte canonical JSON limit. Wire components are
at most 16,384 bytes. Amounts use canonical decimal uint256 and heights/gas/account
numbers/sequences use uint64; zero is omitted only for protobuf account number and
sequence. UTC timestamps must roundtrip millisecond ISO8601. Existing verified
Wallet records retain Wallet's own string and schema rules.

Portable hashes use Wallet `sha256Id` for complete canonical JSON and
`sha256BytesId` for raw unsigned bytes. Only the named self-ID is excluded.
Base64 is URL-safe and unpadded with exact re-encoding equality. The pure API
accepts objects, not raw JSON text: an external parser must reject duplicate JSON
members before it loses that information (e.g. require exact canonical bytes).
Hash equality alone authenticates neither a source nor permission.

## Wallet authority and operation binding

Policy fixes one exact claimant, distinct sponsor, `bootstrap-<claimant>` pot,
222,000 uzrn nominal incoming seed, one use, finite grant budget/expiry, fee/gas
ceilings, separately approved setup budget, interval, nonzero timeout height and
node trust ID. Grant plus setup exposure must fit uint256. Policy expiry cannot
outlive the grant. A revoked grant is not a cancelled pot.

Capability must have the exact canonical `policy_hash`, one claimant account,
one Claim-only rule targeting the derived claiming-pot account, empty spend limits,
and one native fee ceiling equal to policy. Capability/intent lifetimes can narrow
policy but not widen it. Intent has one exact canonical Claim payload, no native
value and no declared spends; its positive fee ceiling cannot exceed policy.
Incoming seed is neither outgoing spend nor available balance. Payload hash,
source key/address, registered-or-unset key, account number, sequence, fee and gas
are independently matched before planning. Wallet reference/signature/chronology,
revocation, usage and approval checks still apply to authorization.

`authorizeSeedClaim` returns a Wallet `AuthorizedIntent` with additional private
Seed provenance. Generic core authorization is insufficient for this subpath's
signing request. The host must call it with authenticated current usage/approvals
inside the same immediate transaction that durably reserves possible signing.
The pure API cannot authenticate the host's supplied approval IDs or counters.

## Assessment

Only complete coherent `observed` input can become `ready`. Every required
surface is validated; malformed partial observations become `unknown`, not absent
or zero. Evidence binds node trust/profile/chain/genesis, a positive height/hash,
monotone latest height, configured lag, synchronisation status and conservative
block/observation freshness. Future times, stale/forked/incoherent state or timeout
cannot authorize planning. Policy's time window is half-open.

Ready requires the native one-address seed shape: active pot, exact total/whitelist,
start/end difference one, no cliff/period/staking/registration requirement,
schedule already vested, no prior claim and no unexplained partial issuance.
There is no pot expiry assumption. Minimum is checked before supply clipping;
expected credit is `min(remaining, max_supply-current_supply)` and is never
computed from cumulative `total_minted`. The value is an estimate, not a payout
promise. A positive clipped estimate can be below the native minimum.

A pre-sign claimant account must exist. The feegrant must be precisely
AllowedMsgAllowance(BasicAllowance), Claim-only, exact parties, finite expiry and
unconsumed policy amount. Unbounded/periodic/extra-message grants are unsupported;
a consumed or changed grant requires a separate policy decision, not automatic
replenishment. Sponsor balance must cover **the full approved outstanding grant
plus separately approved setup exposure**, even if the planned fee is smaller.
The claimant's outgoing spend stays zero.

## Canonical native bytes

`encodeSeedMsgClaim` writes claimant field 1 and pot field 2. Internal decoding
requires exactly that canonical order. Any URL includes the leading slash;
Wallet method omits it. The entire plan is re-encoded on portable verification,
so unknown, duplicated, reordered, redundant-default or alternate-wire fields,
including an empty fee payer, cannot survive even when all public hashes are
recomputed.

- TxBody: one Any field 1, nonzero timeout-height field 3; no memo/extensions.
- SignerInfo: compressed secp256k1 PubKey Any field 1, direct ModeInfo field 2,
  sequence field 3 only when nonzero.
- Fee: one positive uzrn Coin field 1, gas field 2, exact sponsor **granter field 4**;
  payer field 3 is absent.
- AuthInfo: exactly one signer field 1 and Fee field 2; no tip.
- SignDoc: body field 1, AuthInfo field 2, raw chain reference field 3, account
  number field 4 only when nonzero. Its raw SHA256 is the direct-sign digest.
- Simulation TxRaw: exact body/AuthInfo fields 1/2 and one empty signature field 3
  (`1a00`). A nonempty signature is not a valid pure-package plan component.

Plan commitment covers policy/profile/source/genesis/chain, verified capability
and intent record IDs, claimant/pot/sponsor, public key/key ID, account/sequence,
exact fee/gas/timeout/expiry, and full grant exposure/expiry. Plan ID additionally
commits the original observation hash and every unsigned byte component/hash.
Native gas floor is enforced independently of simulation, which skips the
release-pinned decorator. SDK v0.53.8 simulation installs an infinite gas meter:
its native `GasWanted` is the exact uint64-max sentinel `18446744073709551615`,
not the transaction's gas authorization. The validator accepts this exact sentinel
or the exact committed finite gas limit, never an arbitrary larger value. It
always requires positive `gas_used` no greater than the committed finite limit,
and the exact plan and simulation byte hashes. The sentinel never becomes a fee,
gas limit, budget or policy ceiling. Primary tests and Node smoke preserve the
native sentinel rather than pretending real simulation reports finite wanted gas.
No adaptive gas mutation happens after planning.

## Pure journey and external integration

1. Verify/seal Wallet records externally using Wallet APIs and explicit Ed25519
   providers. Create profile/policy, then inspect and assess supplied node evidence.
2. `createSeedClaimPlan` accepts verified capability/intent plus complete original
   observation, exact signer public key, fee/gas and explicit current time. It
   returns a deeply frozen, privately branded public unsigned plan.
3. The external helper simulates exactly `simulation_tx_bytes_b64u`; its result
   retains the coherent block anchor and exact plan/byte hashes.
4. `createSeedSimulationReceiptCore` makes the exact Wallet receipt with one
   zero-value Claim call effect, actual sponsored fee, and native block hash.
   External record sealing supplies the signature; no private record key enters
   this package. Failed simulations can be recorded but cannot be bound for signing.
5. `createSeedSimulationBinding` checks the complete verified receipt core against
   the exact plan/result. The private binding retains exact plan/receipt identities.
6. The runtime rechecks current observations and immutable account/key/sequence,
   authority and budgets in its durable reservation boundary, then calls
   `authorizeSeedClaim` and `createSeedSigningRequest` with that exact binding.
   Freshness is rechecked at authorization's explicit checked time.
7. The returned Wallet request contains only exact unsigned SignDoc bytes/hash.
   **Wallet request IDs must be UUIDs** (the existing Wallet provider contract),
   while the external helper's separate request IDs permit the broader bounded
   identifier syntax in Seed I/O 0.1. A UUID satisfies both. Record IDs and
   simulation IDs likewise retain Wallet's UUID/hash rules.
8. External runtime/helper own real secp256k1 signing, private signed files,
   exact signature verification, single submission and positive reconciliation.
   No helper response by itself establishes durable authority.

`assertSeedClaimPlan` accepts portable JSON and reconstructs all unsigned bytes
and commitments; it does **not** restore private authority. On reopen, externally
reverify Wallet records, recreate the same plan from the original observation and
privately retained original preparation time, compare full commitments and bytes,
and rebuild simulation/authorization bindings. Historical reconstruction is not
current authorization: separately assess fresh evidence and authorize with current
time before an effect. Using current time to reconstruct stale original evidence
is correctly refused.
A new fresh observation may reauthorize an unchanged commitment but cannot silently
regenerate or replace it after possible signing. Unknown signing/submission stays
sticky in the durable host; timeout, expiry or lookup absence does not restore
one use, sponsor exposure or a sequence reservation.

## Verification limits

Package tests exercise source/policy/field/cap/substitution attacks, complete and
unknown assessment, exact wire/default/granter rules, signed-byte refusal, Wallet
approval/revocation/one-use gates, simulation freshness, and JSON provenance loss.
The Node ESM smoke uses disposable Ed25519 records and produces unsigned bytes only.
Existing historical independent Go/Cosmos vectors remain separate and unchanged.
The new `vectors/seed-go-cosmos.json` is an unsigned-only projection of the native
helper's `tools/zerone-seed-io/testdata/claim-vector.json`, retaining its source-file
SHA256 and generator coordinate. Native `TestNativeVector` constructs Claim,
TxBody, AuthInfo, SignDoc and simulation TxRaw using real Zerone/Cosmos SDK types;
the TypeScript test independently reconstructs and compares those bytes and all
profile/policy/commitment/plan hashes. The native fixture's disposable signed bytes
and signature summary are deliberately omitted from the pure package projection.

Reproduce the native golden check in the corresponding Zerone source checkout
with its pinned Go toolchain and cached SDK dependencies:

```sh
GOTOOLCHAIN=local GOPROXY=off GOSUMDB=off go test ./tools/zerone-seed-io -run '^TestNativeVector$' -count=1
```

Only the native owner regenerates the upstream fixture; any later projection must
preserve the exact seven public unsigned fields and refresh the source-fixture
SHA256. No TypeScript self-roundtrip may be relabelled as an independent vector.
The real local grant/account/admit/claim/confirmation journey remains a separate
acceptance gate. Byte parity and package success alone do not prove publication,
custody safety, release acceptance, beta readiness, or capped seed activation.
