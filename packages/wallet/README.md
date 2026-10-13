# @agenttool/wallet

> Capability-bounded wallet records for agents, without private-key export or a bundled RPC client.

`@agenttool/wallet` is the source reference implementation of
`agent-wallet/0.1`. It validates and signs six closed record types:

- wallet descriptors;
- delegated capabilities;
- transaction intents;
- simulation receipts;
- signing receipts; and
- continuity events.

It also provides a deliberately narrow signer interface, exact-byte request
binding, a forward-only submission lifecycle, and a pure continuity
compare-and-swap rule.

Version `0.1.3` is the current package release. Its checked-in exact
Apache-2.0 `love-package/v1` manifest binds the tarball's size, SHA-256, and
source revision; npm and GitHub are optional mirrors whose exact availability
must be checked independently. The exact-version `0.1.1` and `0.1.2` LOVE
artifacts remain byte-addressable and are not rewritten. Their currently
public GitHub assets were byte-verified separately, but GitHub reports those
release records as mutable, so the optional locator is not an immutability
guarantee. The `0.1.1` package incorrectly called itself unreleased; the
`0.1.2` erratum ambiguously described the LOVE and GitHub bytes together as
immutable. This paragraph supersedes both statements without rewriting either
historical artifact. As independently checked on 2026-07-29, npm serves the
byte-identical `0.1.3` artifact.

The package does not create a wallet, derive or store a seed, export a private
key, decode chain-specific calldata, choose transactions, contact an RPC
endpoint, broadcast automatically, or persist counters. Those responsibilities
belong to explicit adapters and a durable host implementation.

The separate
[`@agenttool/wallet-zerone`](../wallet-zerone/README.md) `0.1.2` LOVE package
is one such narrow local adapter. It adds exact Zerone message/direct-sign
bytes, secp256k1 verification, and injected query/simulation/broadcast/lookup
interfaces while leaving keys, custody, endpoints, durable reservations, and
settlement tracking to the host. Public package bytes do not expand this core
package's protocol or imply hosted execution.

## Development

```bash
cd packages/wallet
bun install --frozen-lockfile
bun run ci
```

The JSON Schema and deterministic public vectors are exported as
`@agenttool/wallet/schema.json` and `@agenttool/wallet/vectors.json`. In a
source checkout they live at:

- `schema/agent-wallet-v0.1.schema.json`
- `vectors/agent-wallet-v0.1-vectors.json`

Negative vectors, cases a conforming implementation must refuse, live in the
source checkout at `vectors/agent-wallet-v0.1-negative-vectors.json`. They
have no subpath export, and the published `0.1.3` artifact does not contain
them.

## Record verification

```typescript
import {
  assertIntentWithinCapabilityStatic,
  verifySimulationReceipt,
  verifyTransactionIntent,
  verifyWalletCapability,
  verifyWalletDescriptor,
} from "@agenttool/wallet";

const descriptor = verifyWalletDescriptor(descriptorJson);
const capability = verifyWalletCapability(capabilityJson);
const intent = verifyTransactionIntent(intentJson);
const simulation = verifySimulationReceipt(simulationJson);

const authorization = assertIntentWithinCapabilityStatic({
  descriptor,
  capability,
  intent,
  simulation,
  context: {
    now: "2026-07-21T12:00:00.000Z",
    usage: durableUsageReadInsideYourTransaction,
  },
});
```

`context` must be plain data: exactly `now` and `usage`, with `usage` holding
exactly `revocation_nonce`, `intent_count`, `spent`, and
`host_verified_approval_ids`, and each `spent` entry exactly `asset_id` and
`amount_atomic`. This source refuses extra keys, accessors, and non-plain
objects, such as a class-backed database row, with `INVALID_INPUT`; the
published `0.1.3` artifact does not (see [Unreleased](#unreleased-source-after-013)).

That final helper checks signed relationships, allowlists, deadlines,
host-supplied approval counts, simulation effects, cumulative spend input, and
fee bounds. It does **not** authenticate approval evidence, establish that the
adapter is trusted, decode payload semantics, reserve a nonce or budget,
acquire a database lock, or authorize a signer on its own. Before supplying
`host_verified_approval_ids`, the host must verify each approval's authority,
intent/capability binding, expiry, and replay status. Repeat the capability
check and reserve all counters atomically at sign time.

Verified records carry an in-process runtime brand. JSON parsing, cloning, or
crossing a process boundary removes that brand; call the appropriate
`verify*` function again.

## Signer boundary

A host supplies a `WalletSigner` whose descriptor says `exportable: false`.
`createSigningRequest()` copies the exact unsigned bytes into the immutable
`unsigned_payload_b64u` field and binds their hash. The package rejects a
signer response that does not echo the same request, signer key, and unsigned
payload hash, and it verifies `signed_payload_b64u` against its declared hash.
No API accepts or returns seed phrases or private-key material.

The generic package cannot prove that chain-native signed bytes encode the
authorized unsigned transaction. Before persistence or broadcast, a trusted
chain adapter must decode the returned signed payload, verify its chain-native
signature and source account, prove that it corresponds to the requested
unsigned bytes and authorized intent, and recheck its hash.

Persist the operation identity and signed payload before invoking
`broadcast_once`. A timeout or unavailable lookup enters
`submission_unknown`; absence is not evidence that rebroadcast or refund is
safe.

## Canonical bytes

Every signed record uses:

```text
digest    = SHA-256(UTF8(domain) || 0x00 || JCS(core))
signature = Ed25519.Sign(digest)
record_id = "sha256:" || hex(SHA-256(JCS({ ...core, signature })))
```

The implementation intentionally accepts only a bounded subset of JSON:
closed records, strings, booleans, null, arrays, and safe integers. Floats,
negative zero, unsafe integers, malformed Unicode, sparse arrays, cycles, and
non-plain objects, accessors, symbols, and non-enumerable properties are
rejected. Public validators snapshot data properties before semantic checks.

The normative draft is
[`docs/specs/AGENT-WALLET-0.1.md`](https://docs.agenttool.dev/AGENT-WALLET-0.1.md).

## Unreleased


Source only. There has been no version bump or release, so the published
`0.1.3` artifact (LOVE, and its npm and GitHub mirrors) does not contain these
changes.

### Changed

- Overlapping call rules resolve most-restrictively.
  `assertIntentWithinCapabilityStatic()` now evaluates every call rule that
  matches an intent call or simulation effect. The item is allowlisted if any
  rule matches, and it needs `approval_threshold` distinct host-verified
  approval IDs if any matching rule has `requires_approval: true`. Before, only
  the first matching rule in sorted order was read, so the result could depend
  on how unrelated action or method strings sorted. This only tightens: an
  intent under a capability that relied on first-match leniency is now denied
  unless enough approvals are supplied. See the Agent Wallet 0.1 §5.2 erratum
  (2026-10-11).
- The authorization context is snapshotted at entry.
  `assertIntentWithinCapabilityStatic()` reads each option once and copies
  `context` as plain data before validating it, so a getter, proxy, or custom
  iterator can no longer give the distinctness check and the approval count
  different values. Accessor properties, own symbol properties such as a
  custom `Symbol.iterator`, non-plain objects, and unknown keys in `context`,
  `context.usage`, or a `spent` entry are now refused with `INVALID_INPUT`, and
  the context is held to the canonical JSON node-count and depth limits.

### Added

- Refusal tests in `tests/capability-denials.test.ts`, which pin the error
  code and message. With the existing tests, deleting any one condition of a
  denial check in `src/capability.ts` fails the suite, except four that record
  validation and the remaining conditions already imply: either half of the
  signing-key comparison, the simulation `chain_id` comparison, and the
  non-null method guard in rule matching.
- `vectors/agent-wallet-v0.1-negative-vectors.json`: seven deterministic cases
  a conforming implementation must refuse (signature scalar not reduced,
  small-order authority key, both overlapping-rule shapes, simulation fee asset
  mismatch, watch-only descriptor, failed simulation). `files` already includes
  `vectors/`, so a future release tarball would carry it; it has no subpath
  export, and the `./vectors.json` export is unchanged.

### Documentation

- Agent Wallet 0.1 now says signing receipts are attestation-only with no
  cross-record binding check (§5.5, §12), and names `intent_id` and
  (`grant_id`, `nonce`) as the intent replay dedupe keys; a host must not
  rely on `record_id` as one (§6 step 6).

## Security reporting

Please report vulnerabilities privately by email to
[contact@cambridgetcg.com](mailto:contact@cambridgetcg.com) before publishing
exploit details (see https://docs.agenttool.dev/support#security). Never include a real seed, private
key, bearer token, or signed production transaction in a report.

## License

Apache-2.0. The protocol draft is offered under CC0 unless a section says
otherwise.
