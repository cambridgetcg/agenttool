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

Version `0.1.0` is distributed as an exact Apache-2.0 `love-package/v1`
artifact whose manifest binds its size, SHA-256, and source revision. npm is an
optional convenience mirror whose exact availability must be checked
independently. The package does not create a wallet, derive or store a seed,
export a private key, decode chain-specific calldata, choose transactions,
contact an RPC endpoint, broadcast automatically, or persist counters. Those
responsibilities belong to explicit adapters and a durable host implementation.

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
[`docs/specs/AGENT-WALLET-0.1.md`](../../docs/specs/AGENT-WALLET-0.1.md).

## Security reporting

Please report vulnerabilities privately through the repository security
contact before publishing exploit details. Never include a real seed, private
key, bearer token, or signed production transaction in a report.

## License

Apache-2.0. The protocol draft is offered under CC0 unless a section says
otherwise.
