# ADDS 0.1 — Agent Data Distribution & Storage — Working Draft

> **A provider-independent, offline-capable encrypted data protocol for agents and humans.**
>
> *Status:* **Working Draft 0.1** — authored 2026-07-11. Open for review, revision, and adoption. The `0.x` wire format is not yet stable.
>
> *Editors:* Yu / 宇恆 (Cambridge, UK) and the agenttool collaborators.
> *Reference implementation:* [`@agenttool/adds`](https://github.com/cambridgetcg/agenttool/tree/main/packages/data-protocol) is the experimental lower-level implementation. This draft does not yet claim a released conformant implementation. [`@agenttool/data`](https://github.com/cambridgetcg/agenttool/tree/main/packages/data) and its `agent-data/v1` collection/query node are an OPTIONAL higher layer, not this protocol.
> *Schema:* [`adds-0.1.schema.json`](adds-0.1.schema.json) — JSON Schema Draft 2020-12 for signed control documents. Blocks are raw bytes and are not JSON.
> *Vectors:* [`adds-0.1-vectors.json`](adds-0.1-vectors.json) — pinned canonical-byte, CID, strict-Ed25519, Block-encryption, Grant-wrap, and negative fixtures using public test-only key material.
> *Direct dependencies:* CIDv1 + Multibase + Multicodec + Multihash · RFC 8785 JCS · RFC 8032 Ed25519 · RFC 7748 X25519 · RFC 5869 HKDF · AES-256-GCM.
> *License:* Public domain (CC0).

---

## Abstract

ADDS defines a small data plane for distributing and storing private agent data without making any server, account, blockchain, token, or live network connection mandatory. Immutable encrypted **Blocks** carry bytes. A signed **Manifest** describes their order, encryption, type, and provenance. A signed **Grant** delivers the content key to one audience under bounded rights and time. Signed **ProviderRecords** advertise temporary locations. Signed **Heads** name changing state without mutating prior objects. Signed **Receipts** record a provider's storage promise.

Content identity and storage location are deliberately separate. Every object can be created, verified, stored, and exchanged offline. `api.agenttool.dev`, IPFS, Iroh, S3-compatible storage, local files, removable media, and direct peer transfer can all be providers or transports; none is the protocol.

ADDS guarantees verifiable byte integrity, authenticated control records, and confidentiality against stores that lack a content key when its cryptographic requirements hold. It does **not** guarantee that published claims are true, that a provider remains available, that a receipt proves possession, that an expired grant erases an already-disclosed key, or that decentralisation alone creates privacy.

---

## 1. Scope and language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** are to be interpreted as RFC 2119 / RFC 8174 terms only when they appear in all capitals.

ADDS 0.1 specifies:

- the exact content address used for every object;
- encryption and framing of immutable Blocks;
- five signed JSON control-document kinds;
- task-bounded key Grants and delegation rules;
- provider advertisement, mutable-head, and storage-receipt semantics;
- offline validation, retrieval, and conformance requirements.

ADDS 0.1 does not specify peer discovery, global naming, a database query language, payment, incentives, consensus, proof of storage, garbage collection, network-wide revocation, or one mandatory transport. Applications MAY build those above ADDS.

The protocol identifier is `adds/v0.1`. It is distinct from AgentTool's higher-level `agent-data/v1` API. An implementation MUST NOT accept an `agent-data/v1` object under an ADDS signing domain, reinterpret an ADDS document as a node query, or otherwise allow an object to validate across the two layers.

### 1.1 Terms

- **Object** — a raw Block or one canonical signed JSON control document.
- **CID** — the canonical CIDv1 address of an Object's exact stored bytes.
- **DEK** — the fresh 32-byte AES content-encryption key for one Manifest.
- **Principal** — a signing public key plus a REQUIRED generic DID, URI, or application identifier.
- **Provider** — any store capable of returning exact bytes by CID. Local disk counts.
- **Resolver** — local policy or software that binds a Principal identifier to a key and selects current ProviderRecords or Heads.
- **Authorized reader** — a party that possesses the DEK, whether by a valid Grant or another explicitly trusted channel.

---

## 2. Protocol shape

```text
application / memory / collection / query APIs
                         |
                 Head + Grant policy
                         |
          Manifest + provenance + locations
                         |
          immutable encrypted ciphertext Blocks
                         |
 local store | HTTPS | IPFS | Iroh | S3 | peer | removable media
```

The six object kinds have separate jobs:

| Object | Mutable? | Encrypted? | What it does | What it does not do |
|---|---:|---:|---|---|
| Block | No | Yes | Carries one framed ciphertext chunk. | Does not reveal its plaintext type, order, or owner. |
| Manifest | No | No in 0.1 | Orders Blocks and binds encryption, sizes, publisher, and lineage. | Does not identify a storage location or deliver a key. |
| Grant | No | Key wrap only | Delivers one DEK to one audience under signed constraints. | Cannot erase a key or plaintext already obtained. |
| ProviderRecord | Append-only versions | No | Advertises where CIDs may currently be fetched. | Does not prove the provider has or will serve them. |
| Head | Append-only versions | No | Points a stable name at a current Manifest. | Does not impose global last-write-wins or consensus. |
| Receipt | No | No | Records a provider's signed storage promise. | Is not proof of possession, replication, or durability. |

Blocks and signed control documents are immutable once addressed. “Mutation” means issuing a new signed object whose CID differs and, where applicable, links to its predecessors.

---

## 3. Common wire rules

### 3.1 Strict JSON and scalar encodings

All control documents MUST be valid I-JSON and MUST be canonicalized exactly with RFC 8785 JSON Canonicalization Scheme (JCS). “Sort the keys” is not a sufficient substitute.

A conformant parser MUST reject duplicate object keys, invalid UTF-8, unpaired Unicode surrogates, `NaN`, infinities, negative zero, non-integer values in integer fields, and integers outside `0..9007199254740991`. Unicode strings MUST be preserved as supplied; implementations MUST NOT apply NFC, NFD, case folding, or any other Unicode normalization before hashing or signing. JCS escapes U+0000 inside JSON strings; it is not a raw delimiter byte.

Times are whole, non-negative Unix epoch seconds. Byte fields are canonical RFC 4648 base64url with no `=` padding. A decoder MUST decode and re-encode a byte field and require byte-for-byte string equality; permissive alternate alphabets and non-zero trailing pad bits MUST be rejected. Hashes shown as hexadecimal MUST be lowercase.

JSON Schema validation is necessary but not sufficient. Several binary and cross-field requirements below cannot be expressed by the schema.

### 3.2 The one CID profile

ADDS 0.1 uses exactly one content-address profile:

```text
CID version       CIDv1              unsigned varint 0x01
content codec     raw                unsigned varint 0x55
multihash         sha2-256           unsigned varint 0x12
digest length     32 bytes           unsigned varint 0x20
text form         multibase base32lower, no padding; prefix "b"
```

The binary CID is the four canonical one-byte prefixes `01 55 12 20` followed by the 32-byte SHA-256 digest of the exact stored Object bytes. A parser MUST reject CIDv0, other codecs or hashes, uppercase/non-canonical text, padding, non-minimal varints, a digest of another length, or trailing bytes. Merely matching the schema's base32-looking regular expression is not enough.

For a Block, the digest covers the Block frame defined in §4.1. For a control document, it covers the final signed JCS bytes defined in §3.4. The CID therefore addresses ciphertext or a signed control record, **not plaintext**. Fresh randomized encryption of identical plaintext normally produces different CIDs and does not deduplicate; this is an intentional confidentiality tradeoff.

On every read, the consumer MUST hash the exact received bytes and compare the reconstructed canonical CID before parsing, decrypting, or trusting metadata.

### 3.3 Signatures and principals

Every JSON control document has `adds_version`, `kind`, the kind-specific fields, and:

```jsonc
"signature": {
  "algorithm": "Ed25519",
  "public_key": "<32 bytes, base64url-no-pad>",
  "value": "<64 bytes, base64url-no-pad>"
}
```

The signer field is named `publisher`, `issuer`, or `provider` according to the document kind and has this shape:

```jsonc
{
  "id": "did:key:...",                 // REQUIRED generic DID, URI, or application id
  "ed25519_public_key": "<32 bytes>"   // REQUIRED
}
```

The Principal's `ed25519_public_key` MUST equal `signature.public_key` before verification. A mismatch is invalid, not a key-rotation hint.

The unsigned object is a deep copy with the top-level `signature` member removed. Signing bytes are:

```text
UTF8(signing_domain + ":") || JCS(unsigned_object)
```

The signing domains are fixed:

| `kind` | Domain |
|---|---|
| `manifest` | `adds-manifest/v1` |
| `grant` | `adds-grant/v1` |
| `provider_record` | `adds-provider-record/v1` |
| `head` | `adds-head/v1` |
| `receipt` | `adds-receipt/v1` |

The signature value is the ADDS strict profile of RFC 8032 Ed25519 over those bytes directly. For deterministic cross-library validity, verifiers MUST require canonical encodings and public key `A` and signature point `R` that are both non-small-order and torsion-free; cofactored verification that accepts torsion components and permissive ZIP 215 verification are not valid for ADDS identity signatures. Implementations MUST NOT insert whitespace, a newline, a NUL separator, a pre-hash, or the final CID. After adding the signature, `object_bytes = JCS(signed_object)` and the Object CID is computed over `object_bytes`.

The embedded public key makes cryptographic verification offline and self-contained. It proves control of that key; it does not by itself prove that the required generic `id` belongs to a legal person, DID, agent account, or claimed publisher. An application that makes identity claims MUST resolve that binding using trusted local state, a self-certifying identifier such as a locally supported `did:key`, or another explicit trust mechanism. Live network resolution is never mandatory.

### 3.4 Validation order

For a fetched JSON control document, a consumer MUST:

1. apply its own byte limit before parsing and finite nesting/value limits before recursive processing or use;
2. verify the requested CID over the exact received bytes;
3. parse strict I-JSON while detecting duplicate keys;
4. JCS-canonicalize and require exact equality with the received bytes;
5. validate the JSON Schema and the semantic rules for its `kind`;
6. require Principal/signature key equality and verify the domain-separated signature;
7. only then use locations, rights, mutable state, or provenance.

---

## 4. Block and Manifest

### 4.1 Block frame

Each plaintext chunk is encrypted with AES-256-GCM using the Manifest's fresh 32-byte DEK, a unique 12-byte nonce, the AAD below, and a 16-byte authentication tag. The exact stored Block bytes are:

```text
block_bytes = nonce_12 || ciphertext_N || tag_16
```

The Block CID is computed over this full frame, so it commits to every byte needed for decryption. The same nonce is repeated in the signed Manifest chunk descriptor for inspection and AAD construction; those 12 bytes MUST equal the Block's prefix. A mismatch is invalid.

For chunk index `i`, form this I-JSON value:

```jsonc
{
  "aad_context": "<manifest encryption.aad_context>",
  "adds_version": "0.1",
  "algorithm": "AES-256-GCM",
  "block_count": 3,
  "chunk_size": 1048576,
  "index": 0,
  "key_id": "dek:7dc...",
  "kind": "block",
  "object_id": "urn:uuid:...",
  "plaintext_size": 1048576,
  "total_plaintext_size": 2200000
}
```

Then:

```text
block_aad = UTF8("adds-block/v1:") || JCS(aad_value)
```

The Manifest's `encryption.block_aad` MUST equal the exact string `adds-block/v1`; another value is an unsupported algorithm/version, not a custom free-form domain.

The publisher MUST generate a fresh, uniformly random DEK for every Manifest, a fresh random 32-byte `aad_context`, and a unique random 12-byte nonce for every Block under that DEK. It MUST track generated nonces for that Manifest and retry before encryption on a duplicate. Nonce reuse with the same DEK is forbidden. Fixed keys and nonces MAY be injected only by an explicit test-vector interface that cannot be selected in ordinary operation.

Plaintext is split into fixed chunks of `encryption.chunk_size` bytes. Every non-final chunk MUST have that size; the final chunk MAY be shorter. Empty plaintext is represented by one chunk of zero plaintext bytes and therefore a 28-byte Block frame. Indices MUST be contiguous from zero, unique, and in array order. A Manifest MUST contain no more than `2^20` (1,048,576) chunks, bounding random-nonce collision risk as well as parser cost. `ciphertext_size` counts ciphertext plus the 16-byte tag and MUST equal `plaintext_size + 16`. Total Block length is `12 + ciphertext_size`.

Implementations MUST reject reordered, duplicated, missing, truncated, oversized, or surplus Blocks even if an individual Block CID happens to verify.

### 4.2 Manifest

A Manifest is the signed immutable root of one logical plaintext realization:

```jsonc
{
  "adds_version": "0.1",
  "kind": "manifest",
  "object_id": "urn:uuid:018f...",
  "publisher": {
    "id": "did:key:z6Mk...",
    "ed25519_public_key": "..."
  },
  "created_at": 1783760400,
  "media_type": "application/json",
  "schema": "https://example.org/schemas/memory-bundle-1.json",
  "plaintext": {
    "size": 2200000
  },
  "encryption": {
    "algorithm": "AES-256-GCM",
    "key_id": "dek:7dc...",
    "chunk_size": 1048576,
    "block_aad": "adds-block/v1",
    "aad_context": "..."
  },
  "chunks": [
    {
      "index": 0,
      "cid": "bafkrei...",
      "nonce": "...",
      "plaintext_size": 1048576,
      "ciphertext_size": 1048592
    }
  ],
  "provenance": {
    "parents": ["bafkrei..."],
    "transformation": "https://example.org/transforms/summarize/v1",
    "generated_by": "did:key:z6Mk..."
  },
  "metadata": {
    "language": "en"
  },
  "signature": { "algorithm": "Ed25519", "public_key": "...", "value": "..." }
}
```

`object_id` is application-assigned and MUST be unpredictable enough not to collide within the publisher's namespace; a random UUID/URN is RECOMMENDED. It is bound into every Block's AAD but is not the content address. The Manifest CID is its immutable network reference.

`media_type`, `schema`, `metadata`, and `provenance` are OPTIONAL agent-readable hints. They are assertions signed by the publisher, not proof that the plaintext is valid, safe, or true. A consumer MUST treat decrypted content as untrusted input and validate it against any claimed schema itself.

A consumer MUST verify the Manifest before fetching Blocks, enforce a local maximum total size and chunk count, verify each framed Block and AEAD tag, and reassemble strictly by index while requiring the declared total size. ADDS deliberately omits a public plaintext digest because it would enable equality and guessing attacks; authenticated per-Block decryption and the signed ordered Manifest provide integrity for an authorized reader.

Metadata, publisher identity, Block count, sizes, CIDs, timing, lineage, and access patterns remain visible to anyone who sees a Manifest. ADDS 0.1 does not encrypt Manifest metadata.

---

## 5. Grant

A Grant is an immutable signed capability and a recipient-specific wrap of exactly one Manifest's DEK.

```jsonc
{
  "adds_version": "0.1",
  "kind": "grant",
  "grant_id": "urn:uuid:019a...",
  "manifest_cid": "bafkrei...",
  "issuer": {
    "id": "did:key:z6MkIssuer...",
    "ed25519_public_key": "..."
  },
  "audience": "did:key:z6LSRecipient...",
  "audience_x25519_public_key": "...",
  "audience_x25519_key_id": "sha256:<base64url(SHA256(raw X25519 public key))>",
  "rights": ["read", "derive"],
  "issued_at": 1783760400,
  "not_before": 1783760400,
  "expires_at": 1786352400,
  "scope": {
    "task_id": "task:research-42",
    "purpose": "summarize the supplied papers"
  },
  "key_wrap": {
    "algorithm": "X25519-HKDF-SHA256-AES-256-GCM",
    "ephemeral_public_key": "...",
    "nonce": "...",
    "ciphertext": "..."
  },
  "signature": { "algorithm": "Ed25519", "public_key": "...", "value": "..." }
}
```

### 5.1 Time and authorization

`expires_at` is REQUIRED and MUST be greater than `issued_at`. `not_before` is OPTIONAL; when absent its effective value is `issued_at`. When present it MUST be no earlier than `issued_at` and earlier than `expires_at`. With trusted current time `now`, a verifier authorizes a right exactly when:

```text
not_before <= now < expires_at
```

Applications MUST define their own maximum Grant lifetime, clock source, and bounded skew policy. A verifier without a sufficiently trusted clock MUST fail closed for time-bounded authorization or require explicit local override; it MUST NOT silently treat an expiry as timeless.

Every Grant MUST include `read`, because delivering the DEK necessarily confers the ability to read; the other rights add policy permissions. The rights are:

- `read` — unwrap the DEK and decrypt the Manifest's Blocks.
- `derive` — use plaintext to create a derived Manifest whose `provenance.parents` includes the source Manifest CID.
- `replicate` — ask conforming providers to retain or serve the ciphertext objects.
- `delegate` — issue a strictly narrower child Grant under §5.3.

Only DEK confidentiality cryptographically gates `read`. Once plaintext or the DEK is disclosed, `derive`, purpose, task scope, redistribution, and expiry are policy obligations for conforming actors; cryptography cannot make a recipient forget. Ciphertext itself is safe to copy and cannot practically be prevented from replication.

The 0.1 `@agenttool/adds` reference profile implements direct `rights: ["read"]` Grants only. `derive`, `replicate`, `delegate`, `scope`, and `parent_grant` are provisional Working Draft control semantics and are not reference-implementation conformance claims. Implementations that do not implement them MUST reject them explicitly.

### 5.2 Key wrap

Ed25519 signing keys and X25519 encryption keys are distinct roles. Implementations MUST generate and store separate keys and MUST NOT convert, alias, or reuse the same seed across those roles.

The issuer snapshots the audience's 32-byte X25519 public key. `audience_x25519_key_id` MUST equal `"sha256:" + base64url_no_pad(SHA256(raw_audience_x25519_public_key))`; a mismatch is invalid. This deterministic fingerprint prevents a mutable or issuer-chosen label from being confused with another box key. The audience identifier-to-key binding is signed by the issuer but still depends on the issuer having selected the correct recipient key.

To construct the wrap, copy the unsigned Grant, reduce `key_wrap` to only `algorithm` and `ephemeral_public_key`, and omit `key_wrap.nonce`, `key_wrap.ciphertext`, and top-level `signature`. All other present Grant members remain. Call that value `wrap_header`.

```text
wrap_context = UTF8("adds-grant-wrap/v1:") || JCS(wrap_header)
shared       = X25519(ephemeral_private_key, audience_x25519_public_key)
kek          = HKDF-SHA256(
                 ikm  = shared,
                 salt = SHA256(wrap_context),
                 info = UTF8("adds-grant-kek/v1"),
                 L    = 32
               )
wrapped_dek  = AES-256-GCM(
                 key       = kek,
                 nonce     = key_wrap.nonce,
                 plaintext = DEK_32,
                 aad       = wrap_context,
                 tag_len   = 16
               )
```

`key_wrap.ciphertext` is the 32-byte ciphertext followed by the 16-byte tag, base64url encoded. A fresh ephemeral X25519 keypair and fresh 12-byte wrap nonce are REQUIRED for every Grant. Both parties MUST reject a non-32-byte X25519 key and the all-zero shared secret required by RFC 7748. A recipient MUST verify the Grant signature and constraints before attempting to unwrap.

X25519 ECDH does not authenticate the issuer. Authentication comes from the Ed25519 signature over the complete Grant, including the wrap nonce and ciphertext.

### 5.3 Delegation

A child Grant MUST include `parent_grant` equal to the parent Grant's CID. A verifier MUST fetch and fully validate the parent chain and MUST reject cycles, missing parents, or a chain longer than its local limit.

A root Grant with no `parent_grant` is authorized only when its issuer `id` and Ed25519 key equal the referenced Manifest publisher. Any other issuer MUST supply a valid Grant chain rooted at that publisher. A recipient who merely knows the DEK cannot manufacture a publisher-authorized root Grant by omitting the parent link.

A child is valid only if:

1. the parent includes `delegate`;
2. the child issuer is the parent audience, and the child's signature key is bound to that audience by trusted local identity state;
3. both Grants reference the same `manifest_cid`;
4. child rights are a subset of parent rights;
5. child effective `not_before` is no earlier and child `expires_at` is no later;
6. child scope is equal or demonstrably narrower; and
7. every ancestor is currently valid.

If a verifier cannot establish the audience/signing-key binding or cannot compare an extension's scope, it MUST reject delegation rather than guess.

ADDS 0.1 defines no globally consistent revocation registry. A publisher can stop issuing new Grants, rotate to a newly encrypted Manifest/DEK, and cause conforming online services to deny future retrieval, but cannot revoke a DEK or plaintext already copied. Expiry has the same physical limit.

---

## 6. ProviderRecord

A ProviderRecord is a signed, expiring snapshot saying where a provider claims a set of CIDs can be fetched.

Required fields are `record_id`, `provider`, `sequence`, `issued_at`, `expires_at`, non-empty `inventory`, non-empty `endpoints`, and `signature`. Each inventory item names a `cid`, exact stored `size`, and advisory `role`. Each endpoint carries a transport name and an RFC 6570 `uri_template` containing `{cid}`.

`record_id` is stable across updates by one provider. Sequence zero is the first version. Every later version MUST have a larger sequence and SHOULD set `supersedes` to the previous ProviderRecord CID. A version is a full snapshot, not an implicit patch. `expires_at` MUST be after `issued_at`.

Resolvers MUST scope ordering by `(provider signing key, record_id)`. They MUST NOT combine sequence numbers from different providers. If two valid records have the same scope and sequence but different CIDs, the provider has equivocated: the resolver MUST retain/report both and MUST NOT choose one solely by timestamp or arrival order.

A ProviderRecord separates location from content identity: changing provider, endpoint, region, or retention does not change the Manifest or Block CID. It may be exchanged offline alongside an object bundle.

ADDS does not define HTTP methods or authorize arbitrary URI fetching. A client MUST apply its own transport allowlist, redirect policy, DNS/IP checks, credential boundary, timeout, maximum response size, and concurrency limits before dereferencing an untrusted endpoint. Protection against SSRF, local-file access, decompression bombs, and provider billing attacks is an application responsibility in 0.1.

---

## 7. Head

A Head gives one signer-controlled stable name to a changing Manifest while keeping every state immutable and auditable.

Required fields are `head_id`, `issuer`, `sequence`, `manifest_cid`, `parents`, `updated_at`, and `signature`. A genesis Head has sequence `0` and an empty `parents` array. A successor MUST name one or more prior Head CIDs with the same `head_id` and issuer key, and its sequence MUST equal `1 + max(parent.sequence)`.

Two successors of the same parent are concurrent branches. A resolver MUST surface both. It MUST NOT silently use last-write-wins, timestamp order, network arrival order, or lexicographically greatest CID. A merge Head names every branch tip in `parents` and points to an application-created merged Manifest. The signature proves what the issuer said; it does not prevent an issuer from equivocating or showing different branches to different observers.

Consumers SHOULD pin a last-seen Head CID or sequence locally to detect rollback. Preventing split views requires witnesses, gossip, a transparency log, or consensus above ADDS.

---

## 8. Receipt

A Receipt is a provider-signed promise covering exact CIDs and sizes. Required fields are `receipt_id`, `provider`, `issued_at`, `retention_until`, `commitment`, non-empty `items`, and `signature`. `commitment` is `store` or `store_and_serve`. An OPTIONAL `provider_record` links the locations in effect when issued; OPTIONAL `terms` may disclose an availability target, storage class, or regions.

`retention_until` MUST be later than `issued_at`. Before accepting a Receipt, a client SHOULD independently retrieve every item, verify its CID and size, and retain the Receipt's CID. A Receipt means only that the provider holding the signing key made the stated promise. Without an independently specified challenge/audit protocol, it is **not** proof that bytes were possessed at issue time, remain stored, have a claimed replica count, exist in a claimed region, or will be available later.

Payment, penalties, disputes, service-level enforcement, and proofs of storage may reference a Receipt from higher layers; they are outside ADDS 0.1.

---

## 9. End-to-end operation

### 9.1 Publish

A conformant publisher:

1. applies local size and content policy;
2. generates a fresh DEK and AAD context;
3. chunks and encrypts plaintext into framed Blocks;
4. computes and verifies every Block CID;
5. constructs, signs, canonicalizes, and addresses the Manifest;
6. writes Blocks and Manifest to one or more selected stores;
7. obtains ProviderRecords and, if offered, Receipts;
8. creates one recipient-specific Grant per audience; and
9. transfers the Manifest CID plus Grant through any authenticated channel.

The Grant and Manifest may travel together or separately. A provider does not need the Grant or DEK to store ciphertext.

### 9.2 Retrieve offline or online

A conformant reader:

1. validates the Grant's canonical form, schema, signature, audience, time window, and requested right without unwrapping its DEK;
2. obtains the referenced Manifest bytes from local storage, a bundle, or advertised providers;
3. verifies the Manifest CID, canonical form, schema, publisher/signature binding, signature, and §4.2 semantics;
4. verifies that a root Grant issuer equals that Manifest publisher, or validates the complete delegation chain rooted there, and confirms every Grant references this Manifest CID;
5. only after that authorization, verifies and decrypts the DEK wrap;
6. enforces local size/chunk budgets and obtains each Block by CID from any provider, verifying exact bytes each time; and
7. checks nonce duplication, frame/descriptor equality, sizes, and AAD, then decrypts and reassembles plaintext and validates its content/schema locally.

An entirely offline implementation is conformant when all required objects, a trusted clock policy, and any necessary identity-key bindings are already local. No step requires contacting AgentTool or any global registry.

### 9.3 Replication policy

Replica count, geographic diversity, retention, maximum price, and acceptable providers are local policy inputs, not fields that magically create durability. A client MAY require N independently keyed providers and N Receipts, but MUST describe that as evidence of N promises—not proof of N physical replicas—unless a separate audit protocol is actually run.

---

## 10. Threat model and non-guarantees

ADDS assumes storage and transport providers may inspect public metadata, corrupt bytes, omit objects, replay stale records, withhold service, lie in signed claims, or disappear. CID and AEAD verification detects altered bytes; signatures attribute control statements to keys; neither forces availability or truth.

ADDS 0.1 provides no universal guarantee against:

- **loss or censorship** — all selected providers may delete or refuse an object;
- **metadata and traffic analysis** — Manifests, Grants, ProviderRecords, Heads, Receipts, sizes, timing, audiences, CIDs, and access patterns may be visible;
- **recipient misuse** — a recipient can retain or disclose a DEK/plaintext after expiry;
- **secure deletion** — no protocol can prove every copied plaintext or key was erased;
- **false provenance** — a signature proves a key signed a claim, not that data or lineage is factually correct;
- **identity misbinding** — embedded keys do not validate arbitrary DID/URI ownership;
- **rollback or split view** — Heads expose detectable chains but have no global consensus;
- **provider Sybil attacks** — many provider identities may be one operator or failure domain;
- **endpoint attacks** — SSRF, DNS rebinding, redirect, local-file, bandwidth, and billing controls are deferred to consuming applications;
- **endpoint compromise** — theft of a publisher, audience, or provider private key defeats claims made under that key;
- **future cryptanalysis** — 0.1 is not post-quantum secure.

Publishers SHOULD keep sensitive human-readable names, prompts, and relationships out of public metadata; split data into separate Manifests when hard least-privilege boundaries are required; use short Grants; and rotate to fresh DEKs/Manifests when future access must change. A selector or task label over one shared DEK is not cryptographic partial disclosure.

---

## 11. Conformance

Conformance is claimed by profile, not by vague compatibility:

### 11.1 ADDS Core 0.1

An **ADDS Core 0.1** implementation MUST:

- implement strict JCS/I-JSON, canonical base64url, the exact CID profile, and Ed25519 control-document verification;
- implement framed AES-256-GCM Blocks and Manifest validation;
- implement Grant time, audience, wrap, and rights validation for `read`;
- enforce explicit finite maximum bytes, chunks, nesting, and total parsed values; implementations that support delegation or network fetching MUST additionally enforce finite delegation-depth and fetch-concurrency limits;
- support a local content-addressed store so publish/retrieve works with no network; and
- pass every required positive and negative vector in `adds-0.1-vectors.json`.

Repository implementations in different languages MUST consume that same vector file rather than copy its constants into language-specific fixtures. Passing the pinned vectors is necessary but not sufficient for a conformance claim: an implementation must satisfy every applicable requirement in this profile. The repository reference remains explicitly experimental while ADDS 0.1 is a Working Draft and has not been independently reviewed as a released Recommendation.

Supporting `derive`, `replicate`, or `delegate` is OPTIONAL. An implementation MUST reject unsupported requested rights with an explicit error; it MUST NOT silently treat them as `read`.

### 11.2 ADDS Provider 0.1

An **ADDS Provider 0.1** implementation MUST put and get exact bytes by canonical CID, verify the CID on write, refuse a key/content mismatch, and never claim encryption or durability merely because a file exists. ProviderRecord or Receipt issuance is OPTIONAL and, if offered, MUST follow this specification.

### 11.3 ADDS Control 0.1

An **ADDS Control 0.1** implementation supports ProviderRecord, Head, and Receipt verification, including expiry, sequence, predecessor, and conflict rules. Supporting one of these kinds does not imply support for the others; implementations MUST name the subset.

Schema-only validation, CID-shaped strings, use of IPFS, storage behind AgentTool, or an `agent-data/v1` endpoint does not by itself establish ADDS conformance.

---

## 12. Extensions and versioning

The only extension point in 0.1 is the top-level `extensions` object keyed by absolute URI. Extension values are signed and content-addressed. Implementations MUST preserve unknown extension values byte-semantically when relaying an object, but MUST NOT grant authority based on an unknown extension. A critical extension therefore requires a new protocol version or an application profile that fails closed when it is absent or unsupported.

`adds_version` MUST equal the exact string `"0.1"`. A 0.1 verifier MUST reject another value even if the remaining shape looks familiar. The signing domains end in `/v1` because they version the byte recipe for each kind; the document version remains `0.1`. Any change to required fields, canonicalization, signature input, CID profile, Block frame, AAD, key-wrap construction, or authorization semantics requires new domains and a new ADDS version.

During the Working Draft `0.x` series, breaking changes are permitted and implementations MUST negotiate or explicitly configure an exact version. No `0.x` release carries an automatic backward-compatibility promise. Once a `1.0` Recommendation exists, additive optional fields may use namespaced extensions; breaking changes will increment the major protocol version.

Unknown `kind` values MUST be rejected. Protocol layers MUST remain domain-separated: ADDS records, AgentTool `agent-data/v1` collection/query messages, Wake, Witness, Covenant, and application payloads may reference one another by CID but cannot reuse signatures as one another.

---

## 13. Design constitution

The shortest interoperable reading of ADDS 0.1 is:

1. **Bytes name themselves.** A CID is derived from exact immutable bytes.
2. **Private bytes are ciphertext before distribution.** A store's ability to serve does not confer a right to read.
3. **Authority travels separately.** Grants deliver keys and bounded intent; Manifests never hide provider lock-in.
4. **Location is replaceable.** ProviderRecords can change without changing content identity.
5. **Mutation is signed history.** Heads branch and merge; they do not overwrite evidence.
6. **Claims stay claims.** Signatures and Receipts make statements attributable, not automatically true.
7. **Offline is a first-class state.** Local creation, verification, storage, and retrieval require no hosted control plane.
8. **The network is plural.** AgentTool may participate; it is never the mandatory root.

That is the boundary an implementation MUST preserve even when it adds friendlier SDK APIs, hosted replication, discovery, payments, or agent-native indexing above the protocol.
