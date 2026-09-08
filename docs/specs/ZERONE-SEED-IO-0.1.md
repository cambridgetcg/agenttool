# Zerone Seed I/O 0.1 — implementation candidate, not released

> **Compass:** [Agent Wallet](AGENT-WALLET-0.1.md) and the unchanged
> [released Zerone profile](AGENT-WALLET-ZERONE-0.1.md).
> **Implements:** one bounded post-beta seed Claim, not seed activation or new economics.
> **Code:** `packages/wallet-zerone/src/bootstrap/types.ts` is the shared type contract;
> `bootstrap/v1.ts`, `bin/zerone-seed/`, and Zerone `tools/zerone-seed-io/` are its intended implementers.
> **Tests:** forthcoming independent Go/Cosmos byte vectors, offline profile tests,
> native helper tests, and disposable CLI-to-chain integration. This document is not a test receipt.

## 1. One contract and its boundaries

The `Seed*` exports in `bootstrap/types.ts` are normative field names. All JSON
objects are **closed**: unknown fields, duplicate JSON members, unsupported
versions, ambiguous numeric encodings and noncanonical protobuf are rejected.
Types alone do not validate input. This is a separately versioned Claim-only
profile, not an expansion of old Send/witness exports or Wallet core's schema.

The pure package builds unsigned bytes and verifies Wallet records; it does not
open endpoints, keyrings, files, ledgers or production signed transactions. The
external runtime owns current authorization, Ed25519 record sealing, atomic
reservation and native-helper invocation. The external native helper owns actual
Cosmos secp256k1 signing and verification. Neither a public plan nor a helper
success response is, alone, permission to sign or submit.

There are no default endpoints, provider identities, production budgets, custody
bindings, key creation, key export, arbitrary RPC/message entrypoints,
`signAndSend`, automatic retry or network retargeting. Operator construction is
separate from claimant execution. This candidate activates nothing and changes
neither dark genesis nor unrelated economics.

## 2. Canonical bytes and content commitments

Use Wallet `canonicalJsonBytes` / `sha256Id` for JSON and `sha256BytesId` for raw
bytes. JSON is UTF-8 without BOM, whitespace or trailing newline; object keys
sort lexicographically, arrays retain order, numbers are safe integers, and
negative zero, fractions, NUL and lone surrogates are forbidden. Public Seed
contract strings and object keys are printable ASCII, except canonical UTC
strings which are also ASCII. Private path handles may be Unicode but never
participate in public hashing. Existing Wallet records retain Wallet's own
Unicode rules. Go must not HTML-escape `<`, `>` or `&` when reproducing Wallet
canonical bytes; use exact canonical serialization, not ordinary `json.Marshal`
output as an assumed canonicalizer.

All `Sha256Id` values are `sha256:` followed by **64 lowercase hex digits**.
`profile_id = sha256Id(SeedProfileCore)`, `policy_hash = sha256Id(SeedPolicyCore)`,
`commitment_hash = sha256Id(SeedClaimCommitment)`, and
`plan_id = sha256Id(SeedClaimPlanCore)`. Only the named self-ID field is excluded;
no other field is silently dropped. `observation_hash = sha256Id(SeedObservation)`.
Raw byte hashes hash decoded bytes, never their base64 text.

`source_digest` is SHA256 of the **exact canonical public source-manifest bytes**
selected by the release, not a padded Git SHA. `zerone_core_commit` is a separate
40-lowercase-hex source revision. `runtime_sha256` and `helper_sha256` hash the
exact installed executable bytes; `genesis_hash` hashes the exact approved
serialized genesis-file bytes. No source or executable digest is inferred from
an RPC version label. An explicitly trusted host verifies these artifact pins
and their reviewed correspondence before using the dynamic profile; fields in a
JSON profile do not authenticate their own provenance.

Every `*_b64u` uses RFC 4648 **URL-safe, unpadded** base64, validated by a decode /
re-encode exact roundtrip. Standard padded base64 is only a native gRPC/Comet
transport representation and must be converted at that external boundary.
`signer_key_id` hashes the compressed **33 raw secp256k1 public-key bytes**, not
protobuf PubKey bytes. `SeedTxHash` is **64 uppercase hex digits** of SHA256 of
exact signed `TxRaw`; its `signed_tx_bytes_hash` counterpart is the same digest
in `Sha256Id` form. Production signed bytes never enter pure-package calls,
public plans, stdout JSON, logs or test artifacts.

Bounds: one input JSON document and one output JSON document, each at most
262,144 bytes; depth 32, at most 4,096 JSON values, individual strings at most
4,096 UTF-8 bytes, decoded unsigned protobuf components at most 16,384 bytes.
Wire readers enforce these limits while reading. Request IDs match
`[A-Za-z0-9][A-Za-z0-9._-]{0,63}`. Addresses are canonical lowercase `zrn` bech32
20-byte accounts. Heights/account numbers/sequences/gas are decimal strings in
`0..2^64-1`; amounts are decimal strings in `0..2^256-1`, at most 78 digits.
No leading zeros except `"0"`. Fee, grant, gas and timeout ceilings are positive;
setup cost may be zero. Timestamps are valid roundtripping
`YYYY-MM-DDTHH:mm:ss.sssZ`; native finer timestamps are truncated toward earlier
milliseconds for conservative freshness, never silently used as a different
feegrant expiry. `max_observation_age_seconds` is 1..300 and `max_height_lag`
is 0..100. Requests have an explicit total `timeout_ms` in 1..30,000.

## 3. Profile, policy and immutable Claim

The profile binds exact chain/genesis/source/runtime/helper and SDK v0.53.8
(Zerone `go.mod:22`; feegrant v0.2.0 at line 15). The historical Send/witness
profile remains on its own older pin; do not copy that pin into this candidate.
The reviewed source's Claim floor is 22,222 gas, transaction cap 11,111,111,
and consensus gas price 1 uzrn/gas; different semantics require a new reviewed
profile version, not accepting caller-supplied substitute constants. The chain
reference and CAIP-2, native CAIP-19 and CAIP-10 account prefixes must agree.
The claiming-pot module address must equal Cosmos's module address for
`claiming_pot`, independently derived, not merely a supplied target string.

Policy fixes one claimant, a distinct sponsor, `pot_id = "bootstrap-" + claimant`
(raw address), 222,000 uzrn nominal seed, fee/gas caps, a finite claim-only grant
and its exact expiry, setup exposure, one intent, time/height limits and approved
node trust ID. The canonical policy hash must equal
`WalletCapability.policy_hash`. No default numeric budget is supplied. Policy
expiry must precede or equal grant expiry; both remain finite.

The Wallet capability has `max_intents = 1`, one exact claimant account and one
`call` rule targeting the profile's claiming-pot module account, method
`zerone.claiming_pot.v1.MsgClaim` (no leading slash). Its spend limits are empty;
its one native-asset fee ceiling is positive and agrees with policy. The intent
has exactly that call with `payload_b64u = encodeSeedMsgClaim(...)`, the raw
payload hash, `native_value = null`, `declared_spends = []` and positive native
`max_fee`. Wallet simulation has that one call effect, `asset_id = null` and
`amount_atomic = "0"`; estimated fee is the actual sponsored transaction fee.
Incoming seed is not outgoing spend or available balance. Record links, signer,
time windows and approvals are still validated using Wallet core. Policy checks
can only narrow Wallet authority, never bypass it.

`SeedClaimCommitment` binds policy/profile/source/genesis/chain, verified record
IDs, claimant/pot/sponsor, exact public key, account number/sequence, final fee,
gas, timeout, expiry and grant exposure. A plan ID commits both this object and
all unsigned bytes. Changing **any** field requires a different plan and fresh
pre-sign authorization; once possible signing is reserved there is no replacement
or automatic regeneration. Reopening reconstructs and compares full commitments
and bytes, not just IDs. A fresh observation may reauthorize an unchanged plan
without mutating its original observation commitment.

## 4. Exact protobuf parity

Native references in the Zerone checkout are
`proto/zerone/claiming_pot/v1/tx.proto:31-36`,
`x/claiming_pot/types/types.go:68-82`, and
`sdk/typescript/src/feegrant.ts:285-361`.

* Exactly one Any: `/zerone.claiming_pot.v1.MsgClaim`; its value encodes
  `claimant` as string field **1**, `pot_id` as string field **2**, in that order.
* `TxBody`: one messages field **1**, required nonzero timeout-height field **3**.
  Memo, extension options, non-critical options and every other field are absent.
* `AuthInfo`: exactly one SignerInfo field **1**, Fee field **2**; tips absent.
  SignerInfo contains Any `/cosmos.crypto.secp256k1.PubKey` with key field **1**,
  ModeInfo.single field **1** with SIGN_MODE_DIRECT enum **1**, and sequence
  field **3** only when nonzero.
* Fee has one positive `uzrn` Coin in field **1**, gas-limit field **2**, and the
  exact sponsor's raw address in **granter field 4**. **Payer field 3 is absent**,
  including an explicitly encoded empty payer. Coin fields are denom **1** and
  canonical decimal amount **2**. Fee is at least `gas_limit * 1 uzrn` and within
  Wallet/policy/grant ceilings. Simulation never replaces the ante-floor check.
* SignDoc fields are exact body bytes **1**, exact AuthInfo bytes **2**, raw
  chain reference **3**, and account number **4** only when nonzero. The signing
  digest is SHA256 of these protobuf SignDoc bytes, without a Wallet domain tag.
* Simulation TxRaw fields are body **1**, AuthInfo **2**, and exactly one empty
  signature field **3** (`1a00`). Signed TxRaw replaces that slot with a compact
  64-byte lower-S secp256k1 signature. Helper verifies that signature, signer
  address, all unsigned bytes, commitments and hashes before reporting success.

Use minimal uint64 varints and ascending fields; reject unknown, duplicated,
reordered, redundant-default, alternate-wire-type and noncanonical encodings.
Independent Go/Cosmos marshaling vectors, not only a TS self-roundtrip, must
prove exact Claim, granter, SignDoc and simulation parity and unchanged old
Send/witness vectors.

## 5. Inspection is trusted observation, not proof or eligibility

`SeedNodeConfig` is external request configuration only. Both RPC and gRPC
addresses are explicit and belong to one operator-approved full node. `local`
requires literal loopback addresses and no userinfo, path credentials or remote
DNS. `tls` requires HTTPS RPC, TLS gRPC, an explicit server name and CA file;
there are no redirects, ambient credentials or fallback endpoints. A configured
trust ID is checked against policy and an independently approved host mapping;
a request cannot approve itself by hashing its own transport configuration.
The host binds that mapping to the approved exact genesis/runtime and verifies
the helper executable digest. Node replies do not prove source or custody.

Use typed native protobuf reads, either gRPC with pinned-height metadata or the
same typed gRPC query through Comet `abci_query`. Check response height and the
canonical block before and after the read set, chain ID, synchronization, latest
height lag and wall-clock freshness. Only a complete coherent `observed` result
can be assessed. Any unavailable, oversized, unsupported or inconsistent required
surface yields `unknown`, never zero, absent, eligible or ready. Authenticated
full-node observations are an explicit trust boundary, **not portable state or
ICS23 proofs**. Empty gateway registration is not query support.

Bound reads to this pot, address, allowance, native balance and supply audit:
ClaimingPot `QueryPot`, `QueryClaims`, `QueryParams`; Cosmos auth `Account`, bank
`Balance`, feegrant `Allowance`; VestingRewards `SupplyCouplingAudit`, plus exact
Comet status/block metadata. No all-pots/accounts search, transaction search,
unbounded pagination or arbitrary query method. `QueryClaims` has no pagination:
validate the one-address seed pot first and accept at most one exact claim record;
anything larger is unsupported. NotFound is absent only with the source-pinned
typed module/SDK absence contract, never an arbitrary HTTP 404 or gRPC Unknown.

Assessment checks exact native one-address seed shape, active status, whitelist,
zero staking/registration requirements, schedule readiness, prior claim,
minimum/remaining claim amount, matching or unset claimant key, existing account,
exact finite AllowedMsgAllowance(BasicAllowance), exact parties/expiry/MsgClaim
allowlist and sufficient sponsor exposure. The seed schedule is start/end=start+1,
cliff=period=0; pots do **not** expire after vesting. `QueryClaimable` is arithmetic,
not the keeper's eligibility test (`keeper/grpc_query.go:50-68`).

Estimated credited amount is vested/remaining amount clipped to
`max(0, max_supply - current_supply)`, not cumulative `total_minted`. Native
minimum-claim checking occurs **before** supply clipping, so a positive clipped
credit can be below the minimum (`keeper/msg_server.go:151-197`). Recheck before
sign and submission; never promise the estimate as a payout.

## 6. Frozen pure API and external helper commands

The only proposed pure entrypoint is `bootstrap/v1.ts`, with the exact signatures
in `SeedPlannerApi`: `createSeedProfile`, `createSeedPolicy`, `encodeSeedMsgClaim`,
`assessSeedClaim`, `createSeedClaimPlan`, `assertSeedClaimPlan`,
`authorizeSeedClaim`, `createSeedSimulationReceiptCore`,
`createSeedSimulationBinding`, and `createSeedSigningRequest`.
`authorizeSeedClaim` reuses Wallet static authorization over verified records,
current usage and authenticated host approval IDs; the host must call it again
inside the durable transaction. Simulation bindings and SigningRequests keep
private in-process provenance just as the existing adapter does. Reopened state
reverifies records and rebuilds those bindings; JSON cannot forge their brands.
There is no production `createSignedPayload` or signed-byte verification export
on this pure entrypoint.

Invoke `zerone-seed-io <command>` with exactly one canonical `SeedIoRequest` on
stdin, EOF, and one canonical `SeedIoResponse` on stdout (a single terminating LF
is allowed only as framing, not part of hashes). CLI command and JSON command
must agree. Nonzero exit without a valid response is never proof of no effect.
Stderr is bounded closed diagnostics; do not print raw request, key handles,
node error bodies, passwords, signature bytes or transaction bytes.

| Command | Effect boundary and exact result |
| --- | --- |
| `inspect` | Bounded reads only; `SeedObservation`. No keyring or ledger creation. |
| `simulate` | Exact final granter-bearing simulation TxRaw at requested height; `SeedSimulationResult`. No signer and no chain mutation. |
| `sign` | Existing explicit keyring backend/home/key-name only; exact plan, real signature, external verification, exclusive private TxRaw file; digest-only `SeedSignedSummary`. No RPC or submission. |
| `verify` | Read the explicit private TxRaw file, verify exact canonical bytes/signature/plan; same digest-only summary. No signer or network. |
| `submit` | Independently verify file/plan/hash, then one native broadcast call; `SeedSubmitResult`. No signer or retry. |
| `lookup` | Exact hash only; helper fetches/checks signed bytes externally against plan, inclusion and canonical block; `SeedLookupResult`. No replay. |
| `operator-grant` | Construct only one MsgGrantAllowance with one positive `uzrn` BasicAllowance spend limit, required future expiry, wrapped in AllowedMsgAllowance allowing exactly MsgClaim. |
| `operator-revoke` | Construct only one MsgRevokeAllowance for the exact distinct parties. |
| `operator-admit` | Construct only one MsgAddBootstrapEntry, authority field 1, one address field 2. No general CreatePot/param-update/governance-submission escape hatch. |

Operator commands return a canonical Any **value** and its raw hash, not signed
transactions or authority. Separate explicit operator tooling signs/submits these
messages under separately approved setup budget and governance/registrar authority;
a claimant command never invokes those keys. Governance authority as a string is
not a usable signer. SDK GrantAllowance materializes a missing grantee Cosmos
account; no dust transfer is required. Revoke/expiry stops sponsorship, **not the
non-expiring admitted pot**. Admission remains a lifetime issuance commitment.

Keyring `test` is allowed only in explicitly disposable test contexts. No helper
command creates a keyring or key; missing handles fail closed. Interactive unlock,
if supported, uses a separately attached operator terminal, never JSON stdin or
logged environment values. API non-exportability is not hardware isolation.
Signed files are external private runtime state (raw binary TxRaw), not public
artifacts: symlink-free owner-only directory, regular owner-only 0600 file,
single hard link, bounded size, exclusive creation, fsync. Sign verifies before
persistence; verify/submit reject unsafe shapes or mutation and hash the actual
opened bytes. Runtime journals record paths privately and summaries only publicly.

## 7. Durable runtime and positive reconciliation

`inspect`/`status` are read-only by default and `prepare` is unsigned only; none
creates a ledger/reservation, opens a signer, admits a pot or submits a grant.
Before possible signing, one immediate durable transaction repeats current
Wallet authorization, profile/policy, exact simulation and fresh observation
checks and reserves one use, claimant/pot attempt, sequence and immutable plan.
Reserve **full policy grant budget plus separately approved setup exposure**, not
claimant balance or estimated gas. Native grants bind message type, not pot or
attempt count; exposure cannot be limited by off-chain one-Claim intentions.
The sponsor is dedicated and the signer host is single; no distributed
exactly-once claim is made.

### Production pre-sign activation consumption

The concrete host's closed configuration requires `activation_gate`. The sole
omission mode is `{mode:"disposable-local"}`, accepted only with
`disposable_test:true`, a literal-loopback local node and `seed-local-*` profile.
Production `zerone-2` requires `mode:"production"`, `disposable_test:false`, exact
Python/verifier/codec/gpgv pins, public trust/keyring/packet paths and hashes,
release artifacts and prerequisite evidence. There is no packet-selected code,
argv, default keyring, production clock override or configurable no-gate fallback.

After `init` and ordinary `prepare`, `pre-sign --plan FILE` returns
`zerone-seed-runtime.presign/0.1`: the original prepared bundle plus actual sealed
simulation/result, a fresh native observation and inert operation coordinates.
It creates no journal operation/reservation or chain signing request. It can seal
a **public Wallet simulation record** through the explicit record provider, not
open the claimant's Cosmos signer. Original `prepared_at` is preserved.

The operation commits host/ledger binding and exact journal prestate, original
bundle/plan/SignDoc/source/record IDs, observation and currentness/budget hashes,
request ID, account/sequence, deadlines and required full exposures. Its status
is `unreserved`, not an alias for `signing_unknown`; only the eventual atomic
`sign_boundary` records an operation. Observer and custodian sign the candidate's
operation within Zerone's separate `SEED-OPERATION.json` contract; the full
candidate is its hash-bound `SEED-PRESIGN.json` (canonical, no LF).

`reserve-sign --plan CANDIDATE` launches the pinned `verify-seed-activation.py`
itself using isolated Python `-I -B` and one explicitly pinned codec. It checks
actual compiled-CLI bytes against the signed packet and accepts only the closed
matching result from that invocation, not deserialized success JSON. Gate output
authenticates configured attestations, **not independent chain/ledger truth**.
Inside the immediate reservation it reconstructs the original Wallet bindings,
compares the full operation against real prestate and freshly reread signed
currentness/budget files, and checks both historical candidate readiness and fresh
native observations. Timestamp and revocation-nonce highwaters span **all same-
wallet operations** at pre-sign/reservation/submission and journal replay.

The host reserves full grant **plus full lifetime setup budget without deducting
already-spent setup**, covers the complete approved cohort (including recipients
not yet reserved), adds outside-journal/other-cohort exposure without counting a
cohort twice, and rechecks it at submission. Missing or changed evidence, drift,
unknown state, replay and underfunding refuse before the signing boundary.

The immutable journal binding includes the activation root, not its changing
per-operation evidence pin. Prior candidate journals with the old binding/event
shape are **not migrated automatically**; a mismatch fails closed. Do not erase
or recreate a journal containing possible effects to bypass that refusal. Fresh
fixture journals in disposable test directories exercise the new candidate.

This protects the supported cooperative single host; it does not isolate hostile
same-user/privileged processes, an independently invoked provider, replacement
of all local state, the Python stdlib or OS. Real gpgv synthetic tests exercise
the compiled CLI, actual prestate and full gate output but use a labelled fake
native helper, not a daemon or production release acceptance.

The host durably enters possible-signing before invoking `sign`. Crash, timeout,
invalid response or lost result becomes sticky `signing_unknown`; a new plan,
expired policy, absence or recovered file does not restore one-use authority.
A recovered file may be verified for the same attempt only. Before `submit`,
reauthorize against fresh state and durably enter possible-submission. Once the
broadcast transport is invoked, every error (including CheckTx rejection,
malformed response or timeout) is `submission_unknown` with the precomputed hash.
Local failures before transport are recorded as pre-submit failures without
reopening the already-consumed signing allowance. Helper errors cannot clear the
host's previously persisted possible-effect boundary.

Lookup absence/unavailability never permits refund or retry. Inclusion returns
actual native code and gas; require the exact transaction bytes/hash, inclusion
block and a canonical successor block before reporting confirmation.
`credited_amount_uzrn` is non-null only for code zero with the exact
`zerone.claiming_pot.pot_claimed` event and matching Claim state at inclusion;
otherwise credit is unknown, not guessed from balance changes. Sequence and
allowance observations are read at the returned evidence height and remain
separate from payout attribution. Sequence advance may retire a sequence fence,
never prove credit or restore one-use authority. Allowance absence alone is not
proof of amount consumed (it may have been revoked). Failed inclusion remains a
consumed attempt, even if no seed was credited.

Release acceptance requires independent byte vectors, real disposable keyring
and Ed25519 records, local grant/account/admit/claim/confirmation, replay refusal,
crash/reopen/concurrency checks and old-profile regression tests. Production
artifact provenance, custody, independently accepted beta and separately capped
seed activation are additional gates, not claims established by this candidate.
