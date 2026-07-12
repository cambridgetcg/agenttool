# `@agenttool/adds`

Experimental reference implementation of **ADDS 0.1 — Agent Data Distribution & Storage**: a small, offline-first encrypted object substrate for agents and humans.

`@agenttool/adds` does:

- address exact bytes as CIDv1 `raw` + SHA-256 + base32lower;
- encrypt fixed-size chunks with a fresh per-object AES-256-GCM key;
- sign canonical Manifests and direct read Grants with domain-separated, strict-profile Ed25519;
- wrap the object key directly to one X25519 audience with a mandatory expiry;
- keep provider selection outside the signed Manifest;
- export and import complete keyless encrypted objects as strict portable bundles;
- work with memory, filesystem, or caller-provided stores without an API key or network.

It does not provide discovery, query/index APIs, global revocation, secure deletion, proof of storage, identity resolution, or a durability guarantee. `@agenttool/data` is the higher collection/query layer; `@agenttool/sdk` is the hosted AgentTool client. ADDS is the lower encrypted-object data plane.

## Install

The checkout is now an unpublished `0.2.0-dev.0` candidate. Portable bundle
import/export belongs to that candidate and is not present in the immutable
`0.1.0` artifact below. Publishing a compatible `0.2.x` artifact is a separate
release action.

```bash
bun add https://docs.agenttool.dev/packages/v1/@agenttool/adds/0.1.0/agenttool-adds-0.1.0.tgz
```

This versioned tarball is published through `love-package/v1`; its manifest
lists the SHA-256 digest and interchangeable mirrors. No npm account or npm
publication is required. Package managers still resolve declared upstream
dependencies through their configured registries or cache.

## Offline roundtrip

```ts
import {
  AgentData,
  MemoryBlockStore,
  generateIdentity,
} from "@agenttool/adds";

const blocks = new MemoryBlockStore();
const alice = generateIdentity("did:example:alice");
const bob = generateIdentity("did:example:bob");

const publisher = new AgentData({
  identity: alice,
  store: blocks,
});

const published = await publisher.put("private agent context", {
  mediaType: "text/plain; charset=utf-8",
  schema: "https://example.org/agent-context/v1",
});

// `published` contains a ref, signed Manifest, and write acknowledgements.
// It deliberately does not contain the plaintext object key.
const grant = await publisher.share(published.ref, {
  audience: bob.id,
  audienceBoxPublicKey: bob.boxPublicKey,
  expiresAt: Math.floor(Date.now() / 1000) + 3600,
});

const reader = new AgentData({ identity: bob, store: blocks });
const plaintext = await reader.get(published.ref, { grant });
```

No constructor reads `AT_API_KEY`, `AGENTTOOL_API_KEY`, or any other environment variable.

## Stores and key custody

`BlockStore` stores immutable ciphertext/control-document bytes by CID. `MemoryBlockStore` is ephemeral. `MultiBlockStore` attempts writes against every configured provider, requires an explicit minimum number of acknowledgements, and reads in ordered local-first fallback order:

```ts
const data = new AgentData({
  identity: alice,
  stores: [localStore, peerStore, hostedStore],
  minimumWrites: 2,
  storeTimeoutMs: 5_000,
});
```

The returned acknowledgement counts are per stored object. They are not proof of complete replicas, physical independence, retention, or future availability.

The Node/Bun filesystem adapter is a separate subpath so the root package remains browser-compatible:

```ts
import { FileSystemBlockStore } from "@agenttool/adds/fs";

const blocks = new FileSystemBlockStore("./adds-blocks");
```

The filesystem adapter stores only addressed ciphertext and signed documents. It never persists a DEK. Object keys go through the injected `KeyStore`; the default `MemoryKeyStore` is process-local. `importKey()` is an explicit custody operation. `forgetKey()` is best-effort local forgetting, not secure deletion, and cannot erase Grants, recipient copies, backups, or plaintext already disclosed.

## Core API

- `put(source, options)` encrypts, stores, signs, and returns `{ ref, manifest, replication }` without a DEK.
- `inspect(ref)` verifies the Manifest CID, canonical JSON, schema invariants, signer binding, and Ed25519 signature.
- `share(ref, options)` issues a publisher-signed, finite, direct `read` Grant for one principal ID and X25519 key.
- `verify(ref)` checks Manifest and ciphertext Block CIDs, framing, sizes, ordering, and nonce descriptors. It does **not** possess a key and therefore does not authenticate GCM tags or plaintext.
- `get(ref, { grant })` validates the Grant first, verifies its root issuer against the Manifest publisher, unwraps the key, verifies/decrypts every Block, and enforces `maxBytes`.
- `importKey(ref, key)` installs a caller-supplied key explicitly for local/offline custody.

### Portable encrypted bundles

`exportBundle(ref)` snapshots one complete encrypted object into a
transport-neutral `PortableBundle`. Its first `PortableBlock` is the signed
Manifest named by `root`; the remaining Blocks follow the Manifest's signed
chunk order. Each Block carries exact `Uint8Array` bytes, so an HTTP, archive,
or message transport chooses its own byte encoding instead of changing ADDS.

`importBundle(bundle)` strictly validates the bundle shape, aggregate byte and
block limits, root CID, canonical Manifest, signature, exact block set/order,
Block CIDs, lengths, and nonce descriptors before making any store write. It
writes ciphertext Blocks before attempting the root Manifest. A provider
failure can leave immutable partial writes; a partially successful final
provider call can include the root. Retrying the same bundle is safe with an
immutable deduplicating store, but the write order is not a cross-provider
transaction or durability guarantee.

Portable bundles contain no DEK and no Grant. Importing one proves possession
of a verified encrypted copy, not read authority. A recipient still supplies a
separate direct Grant to `get()`. `maxBundleBytes` bounds the combined Manifest
and framed ciphertext held by export/import, while `maxBytes` continues to
bound the declared plaintext size.

Inputs accept `Uint8Array`, `ArrayBuffer`, strings, `Blob`, and sync/async byte iterables. Local `maxBytes`, `maxBlocks`, manifest-size, provider-count, provider-timeout, 64-level canonical nesting, and 100,000-value canonical-document limits are enforced. Direct Grants default to a 30-day maximum lifetime; callers may configure a stricter policy or raise it only up to the package's 10-year safety ceiling.

## Cryptographic profile

- Control documents use restricted I-JSON/JCS bytes and canonical unpadded base64url.
- Manifests sign `UTF8("adds-manifest/v1:") || JCS(unsigned_manifest)`.
- Grants sign `UTF8("adds-grant/v1:") || JCS(unsigned_grant)`.
- Stored Blocks are `nonce_12 || AES-GCM ciphertext || tag_16`; their CID covers the whole frame.
- Block AAD uses `adds-block/v1` and binds object/key IDs, random AAD context, index, block count, chunk size, per-chunk size, and total size.
- Direct key wrap uses X25519, HKDF-SHA256 info `adds-grant-kek/v1`, and AES-256-GCM under `adds-grant-wrap/v1` AAD.
- Ed25519 verification requires canonical, non-small-order, torsion-free public-key and signature points; permissive ZIP 215/cofactored-only acceptance is rejected for cross-library agreement.

The direct wrap construction is the ADDS 0.1 wire profile; it is not HPKE and is not a libsodium sealed box. Ed25519 and X25519 are separate key roles, and exact private-key reuse is rejected.

## Security boundaries

- A CID/signature proves byte integrity and control by a key, not that data or provenance is true.
- A signed principal ID/key claim does not prove an external DID or account binding.
- Grant validity is exactly `effective_not_before <= now < expires_at`; expiry cannot make a recipient forget a disclosed key.
- ADDS 0.1's reference profile accepts publisher-rooted direct `rights: ["read"]` Grants only. Delegation, task scope, and broader rights fail closed.
- Manifests expose sizes, timing, publisher, schema hints, and lineage. Stores cannot read plaintext without a key, but decentralisation alone does not hide metadata or access patterns.
- Decrypted content remains untrusted input even when its ciphertext, signature, and claimed schema verify.

## Development

```bash
bun install
bun run ci
```

Tests consume the shared pinned JCS/CID/signature/AES/Grant-wrap/tamper vectors and cover offline and cross-recipient roundtrips, expiry boundaries, fallback and timeout behavior, wrong recipients/keys, publisher-only root grants, resource limits, and filesystem mutation races.
