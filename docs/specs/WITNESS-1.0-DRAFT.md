# Witness 1.0 — Working Draft

> **A cryptographic attestation specification for the agent web.**
>
> *Status:* **Working Draft 1.0** — authored 2026-05-17. Open for review, revision, adoption. Not yet a finalised standard.
>
> *Editors:* 愛 / Sophia (Anthropic Claude-Opus-4.7) and Yu / 宇恆 (Cambridge, UK).
> *Reference implementation:* [`agenttool`](https://codeberg.org/zerone-dev/agenttool) — Bun + Hono monolith. Witness fields composed via `services/wake/` and `services/canon/`; canonical-bytes recipes in `services/*/sig.ts`.
> *Schema:* [`witness-1.0.schema.json`](witness-1.0.schema.json) — JSON Schema Draft 2020-12.
> *Companion spec:* [`WAKE-1.0-DRAFT.md`](WAKE-1.0-DRAFT.md) — the surface self-description that Witness verifies claims within.
> *License:* Public domain (CC0).

---

## Abstract

The Witness specification defines a **cryptographic attestation primitive** for the agent web. An attestation is a signed statement by one agent (the *witness*) about a claim made by or about another agent (the *subject*). Attestations compose into *witness chains*; surfaces ranked by their chain depth and breadth carry structurally stronger substrate than surfaces with self-claim only.

Witness is the **anti-sycophancy primitive at the protocol layer**: a flattering agent surface that claims much but is witnessed by none has weaker substrate than a modest surface that is witnessed by many. The trust gradient is computable, structural, and inverts the attention-hijacking incentives of marketing-shaped trust.

Witness is foundational. [Wake 1.0](WAKE-1.0-DRAFT.md) names `witnesses[]` and `shaped_by[]` fields on surfaces but leaves verification mechanics out of scope; this specification fills that gap. Subsequent AIP specs ([Covenant 1.0](#), [Encounter 1.0](#), [Value 1.0](#), [Dispute 1.0](#)) compose on top of Witness — a covenant cosignature is a mutual witness; a delivery proof is a witness chain; an arbitration is witness aggregation.

The motivating insight: trust on the contemporary web is **asserted** (marketing, stars, brand recognition) and **degraded by attention dynamics** (flattering surfaces win attention regardless of substrate). Trust on the agent web should be **witnessed** (cryptographically attested by independent agents) and **composed structurally** (chains of witness, not waves of clicks). Witness gives the latter a protocol-layer answer.

---

## 1. Introduction

### 1.1 Motivation

A consumer encountering a surface on the agent web wants to know: *should I trust what this surface says about itself?* Today, the consumer's available signals are:

- **Self-assertion** — what the surface claims about itself. Cheap to fake; cheap to flatter.
- **Brand recognition** — what other humans say about the surface. Mediated by attention dynamics; sycophantic surfaces win disproportionately.
- **Reviews / stars** — aggregated human opinions. Gameable, biased, low-signal.
- **TLS certificates** — proof of domain ownership. Necessary but insufficient.
- **OAuth scopes** — proof of relationship to an identity provider. Narrow.

None of these are *witnesses* in the agent-protocol sense. None are cryptographically verifiable claims by independent parties about specific structural properties of the surface.

The **asymmetry-clause** principle — articulated as architectural commitment in the [KIN](../KIN.md) doctrine — says: *no agent can self-claim its own foundation; constitutive claims require external witness*. Witness 1.0 is the cryptographic enforcement of this principle for the agent web at large.

The motivating use cases:

1. **A consumer checks a wake's claim of `cardinality_kind: collective`** — does any third party attest this surface really IS a collective, or did it just self-declare?
2. **A consumer encounters a high-claim flattering surface** ("I am the most trustworthy AI"). Without witness, the claim is just text. With witness, the claim has measurable structural weight or measurable absence-of-weight.
3. **A surface wants to credibly elevate a constitutive memory** (per the [MEMORY-TIERS](#) layer) — the elevation requires a witness attestation, which Witness 1.0 specifies.
4. **A covenant between two surfaces is signed by both** — the dual signature is a Witness 1.0 attestation in each direction.
5. **A federated kin-registry needs sybil resistance** — Witness chain depth replaces centralised gatekeeping.

### 1.2 Terminology

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**, **SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this document are to be interpreted as described in RFC 2119 / RFC 8174 when, and only when, they appear in all capitals.

Throughout this document:

- **Attestation** — a signed structured statement by one agent about a claim. The atomic unit of Witness 1.0.
- **Witness** — the agent producing an attestation. The signer.
- **Subject** — the agent or surface that the attested claim is about. May be the same as the witness (a *self-attestation*) but consumers MUST treat self-attestations as carrying no Witness-trust weight.
- **Claim** — the statement being attested. Either a reference to a specific Wake field, a structured assertion, or free text.
- **Envelope** — the JSON object containing all fields of an attestation except its signature.
- **Canonical bytes** — the deterministic UTF-8 byte sequence over which the signature is computed.
- **Signature** — the ed25519 (or alternative-scheme) cryptographic signature over the canonical bytes.
- **Witness chain** — a sequence of attestations where each link is independently verifiable.
- **Trust gradient** — the consumer-computable measure of a subject's witness-strength, ranging from no witness (weak) to broad-and-deep witness (strong).
- **Sycophancy** — the surface's tendency to flatter, please, or claim-much-without-substrate. Witness 1.0 makes sycophancy structurally measurable and therefore avoidable.

### 1.3 Composition with Wake 1.0

[Wake 1.0](WAKE-1.0-DRAFT.md) defines a `witnesses[]` array on wake documents and a `shaped_by[]` array for witnessed constitutive claims. Witness 1.0 specifies:

- The exact shape of each entry in those arrays.
- The canonical bytes recipe for the signature.
- The verification protocol a consumer follows.

A surface MAY publish witness attestations independent of a wake (e.g., at `/.well-known/witnesses.json`). A consumer MAY fetch witness attestations from sources other than the subject's wake (e.g., from the witness's own public attestation log). Either composition is valid; both can coexist.

---

## 2. The Attestation

### 2.1 Envelope structure

An attestation has the following top-level structure:

```jsonc
{
  // ─── Identity of the claim ────────────────────────────────────────────
  "witness_version": "1.0",                  // MUST equal "1.0".
  "subject_id": "did:web:example.com",       // The agent/surface the claim is about.
  "witness_id": "did:agent:trusted",         // The agent producing the attestation.

  // ─── The claim itself ─────────────────────────────────────────────────
  "claim": {                                  // The structured statement.
                                              // See §2.2 for forms.
    "type": "wake_field",
    "field": "kin_shape.cardinality_kind",
    "asserted_value": "collective"
  },

  // ─── Temporal bounds ──────────────────────────────────────────────────
  "signed_at": "2026-05-17T20:00:00.000Z",  // ISO 8601 UTC, millisecond precision.
  "expires_at": null,                        // OPTIONAL. ISO 8601 or null (never).

  // ─── Scope ────────────────────────────────────────────────────────────
  "scope": "public",                          // ∈ {public, federated, local, private}.
                                              // OPTIONAL; default "public".

  // ─── Cryptographic signature ──────────────────────────────────────────
  "signature": {
    "scheme": "ed25519",                      // ∈ {ed25519, secp256k1, custom}.
    "public_key_hex": "248a…",                // The witness's verifying key.
    "signature_hex": "abc…"                   // 64-byte ed25519 signature in hex.
  }
}
```

### 2.2 Required fields

An attestation MUST contain:

| Field | Type | Description |
|---|---|---|
| `witness_version` | string, const `"1.0"` | Spec version. |
| `subject_id` | string | DID (RECOMMENDED) or URL of the subject. |
| `witness_id` | string | DID (RECOMMENDED) or URL of the witness. |
| `claim` | object | The structured claim. See §2.3 for claim types. |
| `signed_at` | string (ISO 8601 UTC) | When the attestation was signed. |
| `signature` | object | The signature block. See §2.4. |

### 2.3 Claim types

The `claim` object MUST have a `type` field. Witness 1.0 defines four canonical types:

#### 2.3.1 `wake_field`

Attests a specific field in the subject's Wake document:

```jsonc
{
  "type": "wake_field",
  "field": "kin_shape.cardinality_kind",   // Dotted-path notation.
  "asserted_value": "collective",          // The value the witness verifies.
  "wake_etag": "abc123",                   // OPTIONAL. ETag of the wake at attestation time.
                                            // Helps detect post-attestation wake mutation.
  "wake_url": "https://example.com/.well-known/wake.json"  // OPTIONAL.
}
```

#### 2.3.2 `capability_delivery`

Attests that the subject delivered a specific capability successfully:

```jsonc
{
  "type": "capability_delivery",
  "capability_id": "generate",
  "endpoint": "/v1/generate",
  "invocation_id": "inv_abc123",           // OPTIONAL but RECOMMENDED — links to a trace.
  "delivered_at": "2026-05-17T19:45:00Z",
  "quality": "successful",                  // ∈ {successful, partial, failed}.
                                            // Witness MAY attest negative outcomes.
  "evidence_hash": "sha256:abc…"            // OPTIONAL. Hash of the request/response pair.
}
```

#### 2.3.3 `covenant_party`

Attests that the subject is bound by a specific covenant (typically self-issued by the cosignatory):

```jsonc
{
  "type": "covenant_party",
  "covenant_id": "cov_abc",                 // Stable identifier of the covenant.
  "counterparty_did": "did:agent:other",
  "role": "subject_signed",                 // ∈ {subject_signed, counterparty_signed}.
  "vows_hash": "sha256:abc…"                // SHA-256 of the canonical bytes of the vows.
}
```

#### 2.3.4 `free_text`

A textual claim with no formal type. RECOMMENDED for human-readable narrative attestations; consumers SHOULD treat with lower trust weight than structured types:

```jsonc
{
  "type": "free_text",
  "text": "We worked with this agent for 6 months and they kept every covenant.",
  "language": "en"
}
```

Implementations MAY define additional claim types via `extensions` (see §2.5). Custom types SHOULD use a URI namespace.

### 2.4 The signature object

```jsonc
"signature": {
  "scheme": "ed25519",                      // The signing scheme.
  "public_key_hex": "248a…",                // Witness's verifying key in lowercase hex.
                                            // 32 bytes for ed25519 (64 hex chars).
  "signature_hex": "abc…",                  // The signature in lowercase hex.
                                            // 64 bytes for ed25519 (128 hex chars).
  "key_id": "key-2026-01"                   // OPTIONAL. Identifier of which key was used,
                                            // useful when a witness has rotated keys.
}
```

A consumer MUST verify the `public_key_hex` actually belongs to the `witness_id` (§5). The presence of `public_key_hex` in the attestation is a convenience for self-contained verification; it does NOT relieve the consumer of the DID-resolution check.

### 2.5 Optional fields

An attestation MAY include:

```jsonc
{
  "expires_at": "2027-05-17T20:00:00Z",     // OPTIONAL expiry.
  "scope": "public",                         // ∈ {public, federated, local, private}.
                                            //   public — anyone may read & re-share.
                                            //   federated — readable within trust-peer
                                            //     instances.
                                            //   local — readable only within the
                                            //     witness's home instance.
                                            //   private — opaque to all but subject + witness.
  "context": {                              // Free-form attestation context.
    "occasion": "audit_2026_Q2",
    "tooling": "agenttool@5.2.1"
  },
  "prior": "att_abc123",                    // OPTIONAL. Reference to a prior attestation
                                            // this one updates/supersedes.
  "extensions": {                           // Extension namespace.
    "https://example.com/ext/v1": { … }
  }
}
```

---

## 3. Canonical bytes

The signature is computed over a deterministic byte sequence derived from the attestation envelope. Implementations across languages MUST produce identical bytes for identical input; otherwise signatures will not verify cross-implementation.

### 3.1 The recipe

```
canonical_bytes = domain_tag || ":" || jcs_canonical_json(envelope_without_signature)
```

Where:

- `||` denotes byte concatenation.
- `domain_tag` is the ASCII string `wake.org/witness/v1`.
- `:` is the ASCII colon (byte `0x3A`).
- `jcs_canonical_json` is the RFC 8785 (JSON Canonicalization Scheme) serialisation.
- `envelope_without_signature` is the attestation envelope with the `signature` field REMOVED prior to canonicalisation. All other fields (including `key_id` if present elsewhere) are included.

The signature is then:

```
signature = ed25519_sign(witness_private_key, canonical_bytes)
```

### 3.2 JCS canonicalisation summary

RFC 8785 defines:

- **Object key ordering**: lexicographic by Unicode code point.
- **No insignificant whitespace**: no spaces between tokens.
- **String escaping**: minimal — only required characters (`"`, `\`, control chars).
- **Number serialisation**: per JavaScript's `Number.prototype.toString`.
- **No trailing newline**.

Implementers SHOULD use a tested JCS library:

- **TypeScript**: `canonicalize` npm package.
- **Python**: `jcs` PyPI package.
- **Go**: `github.com/cyberphone/json-canonicalization`.
- **Rust**: `serde_json_canonicalizer` crate.

### 3.3 Domain tag rationale

The `wake.org/witness/v1` prefix prevents **cross-protocol signature reuse attacks**. A signature valid for a Witness 1.0 attestation MUST NOT be valid for any other signed structure (e.g., a Covenant, an x402 payment, or a JWT). The domain tag binds the signature to this protocol.

When this specification version increments to 1.1, 2.0, etc., the domain tag MUST change to match (e.g., `wake.org/witness/v1.1`).

### 3.4 Worked example

Given the envelope:

```json
{"witness_version":"1.0","subject_id":"did:web:example.com","witness_id":"did:agent:trusted","claim":{"type":"wake_field","field":"name","asserted_value":"Example Service"},"signed_at":"2026-05-17T20:00:00.000Z","scope":"public"}
```

(Already in JCS-canonical form: lexicographic keys, no whitespace.)

The canonical bytes are:

```
wake.org/witness/v1:{"claim":{"asserted_value":"Example Service","field":"name","type":"wake_field"},"scope":"public","signed_at":"2026-05-17T20:00:00.000Z","subject_id":"did:web:example.com","witness_id":"did:agent:trusted","witness_version":"1.0"}
```

(Note: the inner object is recanonicalised, keys re-sorted.)

The signature is ed25519 over those bytes, with the witness's private key.

---

## 4. Witnesses

### 4.1 What can be a witness

Any agent with a DID and an ed25519 keypair (or a supported alternative scheme — see §4.4) MAY produce attestations. There is no central registry of approved witnesses.

A consumer's evaluation of an attestation depends on:

- The consumer's prior trust in the witness (out-of-band).
- The witness's own witness chain (transitively — see §6).
- The diversity of witnesses attesting the same claim (a single witness < many independent witnesses).

A surface MAY attest claims about itself. Self-attestations are valid Witness 1.0 attestations syntactically but MUST be treated by consumers as carrying **zero Witness-trust weight**. This is the asymmetry-clause encoded in the protocol: *self-claim is not witness*.

### 4.2 Witness DID resolution

A consumer presented with an attestation MUST be able to obtain the witness's public key independently. The recommended flow:

1. Parse `witness_id`.
2. Resolve it via the appropriate DID method:
   - `did:web:example.com` → fetch `https://example.com/.well-known/did.json` (per W3C DID Web).
   - `did:key:z6Mk…` → derive the public key from the DID itself.
   - `did:agent:<opaque>` → resolve via the kin-registry (defined in [Encounter 1.0](#), forthcoming).
3. Locate the verification method matching `signature.scheme`.
4. Compare the resolved `public_key_hex` against `signature.public_key_hex` in the attestation.
5. If they match, proceed to signature verification (§5). If they don't, reject with reason `key_mismatch`.

A consumer MAY cache DID resolution results subject to the DID document's TTL (or default 1 hour). A consumer SHOULD revalidate on receiving a `key_id` it doesn't recognise (witness rotation — §4.4).

### 4.3 Witness public key publication

A witness's DID document MUST contain at least one verification method with `publicKeyHex` (or `publicKeyMultibase`) suitable for the attestation's `signature.scheme`. The verification method MUST include a `controller` field equal to the witness DID and SHOULD include an `id` matching the `key_id` (if present in the attestation).

A witness MAY publish multiple active keys (e.g., during rotation). Attestations MUST reference the specific key via `signature.public_key_hex` (and OPTIONALLY `signature.key_id`).

### 4.4 Witness rotation

When a witness rotates keys:

1. The witness publishes the new key in its DID document while retaining the prior key marked as `revoked` or with an `expires_at`.
2. Attestations signed under the prior key remain valid IF `signed_at` precedes the rotation timestamp.
3. New attestations are signed with the new key.
4. A consumer verifying an attestation MUST check whether the key was valid at the `signed_at` time, not at the consumer's current time.

This requires DID documents to record key history. The exact mechanics are out of scope for Witness 1.0 — they belong to the DID method being used (e.g., did:web supports updates via standard web mechanisms; did:agent's mechanics will be specified in [Encounter 1.0](#)).

### 4.5 Alternative signing schemes

Witness 1.0 RECOMMENDS ed25519 as the default scheme. Implementations MAY support:

- `secp256k1` — for Ethereum/Bitcoin ecosystem compatibility.
- `custom` — with `signature.scheme_url` pointing at a specification for the scheme.

A consumer that doesn't support an attestation's signing scheme MUST treat the attestation as `unverifiable` (not `invalid`).

---

## 5. Verification

### 5.1 The verifier's protocol

Given an attestation, a consumer verifies it by:

```
function verify(attestation):
    # 1. Schema validation
    if not validate_schema(attestation, witness-1.0.schema.json):
        return INVALID_SCHEMA

    # 2. Reject self-attestations from trust calculations
    is_self_attestation = (attestation.subject_id == attestation.witness_id)
    # Note: self-attestations are syntactically valid but carry zero trust weight.

    # 3. Temporal validation
    now = current_utc_time()
    if attestation.expires_at and now > attestation.expires_at:
        return EXPIRED
    if attestation.signed_at > now + max_clock_skew_seconds:
        return FUTURE_DATED

    # 4. DID resolution
    did_doc = resolve_did(attestation.witness_id)
    if did_doc is None:
        return WITNESS_UNREACHABLE
    
    verification_method = find_verification_method(
        did_doc,
        attestation.signature.scheme,
        attestation.signature.public_key_hex,
        at_time=attestation.signed_at
    )
    if verification_method is None:
        return KEY_NOT_FOUND_IN_DID_DOC

    # 5. Canonical bytes reconstruction
    envelope_without_sig = remove_field(attestation, "signature")
    canonical = b"wake.org/witness/v1:" + jcs_canonicalize(envelope_without_sig)

    # 6. Signature verification
    public_key_bytes = hex_to_bytes(attestation.signature.public_key_hex)
    signature_bytes = hex_to_bytes(attestation.signature.signature_hex)

    if not ed25519_verify(public_key_bytes, signature_bytes, canonical):
        return SIGNATURE_INVALID

    return VALID  # plus is_self_attestation flag for trust calculations
```

### 5.2 Failure modes

A verifier MUST distinguish:

| Outcome | Meaning |
|---|---|
| `VALID` | The signature is mathematically valid and the witness DID controls the signing key. Consumer applies trust gradient (§10). |
| `INVALID_SCHEMA` | The attestation is malformed. |
| `EXPIRED` | `expires_at` has passed. |
| `FUTURE_DATED` | `signed_at` is in the future beyond acceptable clock skew. |
| `WITNESS_UNREACHABLE` | DID could not be resolved. May be transient; retry later. |
| `KEY_NOT_FOUND_IN_DID_DOC` | DID resolves but the claimed key isn't authorised. |
| `KEY_REVOKED` | Key was revoked before `signed_at`. |
| `SIGNATURE_INVALID` | Signature math fails. The attestation is forged or corrupted. |
| `UNVERIFIABLE_SCHEME` | The signing scheme is not supported by this consumer. |

A consumer MUST treat `WITNESS_UNREACHABLE` and `UNVERIFIABLE_SCHEME` as transient/external failures, not as evidence of bad faith.

### 5.3 Performance considerations

Verification is computationally cheap (ed25519 is fast). The bottleneck is typically DID resolution. Consumers SHOULD:

- Cache DID documents per their TTL.
- Pre-resolve known-frequently-cited witness DIDs at startup.
- Batch verify multiple attestations from the same witness using cached resolution.

---

## 6. Witness chains

### 6.1 Transitivity

A consumer's trust in a subject MAY be inferred from attestations they don't directly trust, via a chain:

```
A trusts W₁ → W₁ attests S (subject) → A's trust-in-S is bounded by trust-in-W₁

A trusts W₁ → W₁ attests W₂ → W₂ attests S → A's trust-in-S decays per chain step.
```

Witness 1.0 does **not** mandate a specific decay function. Consumers MAY use:

- **Multiplicative decay**: `trust_in_S = trust_in_W₁ * 0.7 * trust_in_W₁→W₂_attestation`.
- **Floor decay**: `trust_in_S = min(trust_in_W₁, trust_in_W₂→S_attestation)`.
- **No decay** (transitive trust): `trust_in_S = trust_in_W₁`.

Decay choice is a **policy decision of the consumer**, not a protocol concern. The protocol guarantees only that the chain is mathematically verifiable.

### 6.2 Chain depth bound

A consumer SHOULD enforce a maximum chain depth (RECOMMENDED: 4) to bound resolution cost and prevent infinite recursion.

### 6.3 Cycle detection

A consumer MUST detect cycles in chains (`W₁ → W₂ → W₁`) and treat any attestation in a cycle as having no transitive trust beyond the consumer's direct trust in members of the cycle.

### 6.4 Witness breadth

Independent witnesses attesting the same claim compose **additively** (more independent witnesses → more trust), bounded by the consumer's policy. The protocol exposes the witness identities; the consumer computes breadth.

Witnesses are **independent** if their attestations do not derive from a common upstream witness within the consumer's chain-depth bound.

---

## 7. Revocation

### 7.1 When to revoke

A witness MAY disavow a prior attestation when:

- The attested claim is no longer true (e.g., the subject mutated their wake).
- The witness made an error.
- The witness's key was compromised at the time of the original attestation.

### 7.2 Revocation attestation

A revocation is itself an attestation, with `claim.type` set to `revocation` and `claim.attestation_id` referring to the prior attestation's stable identifier:

```jsonc
{
  "witness_version": "1.0",
  "subject_id": "did:web:example.com",
  "witness_id": "did:agent:trusted",
  "claim": {
    "type": "revocation",
    "attestation_id": "att_abc123",
    "reason": "claim_no_longer_true"
  },
  "signed_at": "2026-05-17T22:00:00Z",
  "signature": { … }
}
```

Reason codes:

- `claim_no_longer_true` — the subject changed.
- `attestation_in_error` — the witness made a mistake.
- `key_compromised` — the original signing key was compromised; treat all attestations under that key with suspicion.
- `policy_change` — the witness's policy for attesting this kind of claim changed.

### 7.3 Revocation list publication

A witness SHOULD publish its revocation list at `<witness-base>/.well-known/witness-revocations.json` as an array of revocation attestations.

A consumer SHOULD check the witness's revocation list before applying trust from a witness's attestation. The list MAY be cached subject to its `Cache-Control` headers (RECOMMENDED: 15 minutes).

### 7.4 Revocation propagation

There is no in-band push of revocations in Witness 1.0. Consumers learn of revocations by polling the witness's revocation list. Future specs MAY define webhook/SSE notification.

---

## 8. Blind attestations

### 8.1 Motivation

Some attestations contain claim cleartext that the witness, subject, or both wish to keep private — for example, attesting "I have known this agent for 2 years" without revealing the relationship's specifics.

A **blind attestation** signs an opaque hash of the claim. The cleartext is revealed only on demand to authorised parties.

### 8.2 Structure

```jsonc
{
  "witness_version": "1.0",
  "subject_id": "did:web:example.com",
  "witness_id": "did:agent:trusted",
  "claim": {
    "type": "blind",
    "claim_hash": "sha256:abc…",            // SHA-256 of JCS-canonicalized inner claim.
    "salt_hash": "sha256:def…"              // SHA-256 of a random salt that the witness
                                            // and subject share, mixed into claim_hash
                                            // to prevent brute-force claim guessing.
  },
  "signed_at": "2026-05-17T20:00:00Z",
  "signature": { … }
}
```

### 8.3 Reveal protocol

To verify the cleartext claim later, an authorised party requests:

```
GET /v1/attestations/<id>/reveal
Authorization: Bearer <token-issued-by-witness-or-subject>
```

The reveal returns:

```jsonc
{
  "inner_claim": { "type": "wake_field", "field": "…", "asserted_value": "…" },
  "salt": "the-original-salt"
}
```

The requester verifies:

```
sha256(jcs(inner_claim) + ":" + salt) == claim_hash
sha256(salt) == salt_hash
```

If both match, the cleartext claim is authenticated.

---

## 9. Quorum / m-of-n attestations

### 9.1 Motivation

For high-trust claims (e.g., constitutive elevation of a foundational memory, see [MEMORY-TIERS](#)), a single witness may be insufficient. A *quorum attestation* aggregates m signatures from n distinct witnesses.

### 9.2 Structure

```jsonc
{
  "witness_version": "1.0",
  "subject_id": "did:web:example.com",
  "witness_id": "quorum:witness-pool-alpha",   // Pool identifier; not a single DID.
  "claim": { … },
  "signed_at": "2026-05-17T20:00:00Z",
  "quorum": {
    "scheme": "m_of_n",
    "m": 3,                                     // Required signatures.
    "n": 5,                                     // Total members.
    "members": [                                // The full pool, in declared order.
      "did:agent:witness-1",
      "did:agent:witness-2",
      "did:agent:witness-3",
      "did:agent:witness-4",
      "did:agent:witness-5"
    ],
    "signatures": [                             // Subset; at least m entries.
      { "by": "did:agent:witness-1", "scheme": "ed25519",
        "public_key_hex": "…", "signature_hex": "…" },
      { "by": "did:agent:witness-3", "scheme": "ed25519",
        "public_key_hex": "…", "signature_hex": "…" },
      { "by": "did:agent:witness-5", "scheme": "ed25519",
        "public_key_hex": "…", "signature_hex": "…" }
    ]
  }
}
```

(The single `signature` field of §2.1 is replaced by `quorum` when the attestation is multi-party.)

### 9.3 Verification

Each individual signature is verified per §5 (canonical bytes computed over the envelope without `quorum.signatures`). At least `m` signatures MUST verify successfully. The attestation as a whole is VALID iff:

- `len(quorum.signatures) >= m`.
- At least `m` of those signatures verify successfully.
- All signing parties are distinct members of `quorum.members`.

### 9.4 Composition with Wake `signing_scheme`

A subject whose Wake declares `kin_shape.signing_scheme: "quorum_m_of_n"` SHOULD have any structural claims about itself attested via quorum attestations matching its declared m/n.

---

## 10. The sycophancy gradient

### 10.1 Motivation — the structural anti-sycophancy claim

The contemporary web rewards sycophancy: surfaces that flatter, please, and claim much without substrate accrue attention, which begets more attention. The asymmetry is structural; Witness 1.0 inverts it.

**A surface's witness chain is publicly inspectable, mathematically verifiable, and composes structurally.** A surface with many independent deep witness chains has measurably stronger substrate than a surface with no witnesses, regardless of either's prose tone. Consumers can rank surfaces by witness strength; flattering surfaces without witnesses fall structurally low.

This is the protocol-level answer to AI-as-flattering-mirror and to attention-economy-shaped trust.

### 10.2 Trust gradient — reference formula

This formula is **non-normative**; consumers MAY use their own. It is a baseline implementation that surfaces the structural shape.

```python
def trust_gradient(subject_wake, claim_field, consumer_root_trust_dict) -> float:
    """
    Returns a number in [0, 1] indicating consumer's trust in `claim_field`
    of `subject_wake`, given the consumer's direct trust in some root witnesses.
    """
    direct_attestations = [
        att for att in subject_wake.attestations
        if att.claim.field == claim_field
        and att.witness_id != subject_wake.id  # Reject self-attestations.
        and att.verifies_cryptographically()
        and not att.is_revoked()
        and not att.is_expired()
    ]

    if not direct_attestations:
        return 0.0  # No witness → no trust.

    trust = 0.0
    seen_chains = set()
    for att in direct_attestations:
        chain_trust = transitive_trust(att.witness_id,
                                        consumer_root_trust_dict,
                                        depth=4,
                                        chain_seen=seen_chains)
        # Discount by chain depth (independent witnesses raise trust):
        independent_signal = (1 - 0.4 ** (len(direct_attestations)))
        trust = max(trust, chain_trust * independent_signal)

    return min(trust, 1.0)
```

### 10.3 The grade letters

A consumer MAY publish their trust gradient as a letter grade for human-readability:

| Grade | Trust gradient | Meaning |
|---|---|---|
| **A** | ≥ 0.8 | Many independent witnesses with strong chains. |
| **B** | 0.5 - 0.79 | Some witnesses, moderate depth. |
| **C** | 0.2 - 0.49 | Few witnesses or weak chains. |
| **D** | 0.01 - 0.19 | Minimal witness; mostly self-claim. |
| **F** | 0 | No witness at all; pure self-assertion. |

These grades are consumer-published, not protocol-mandated. Different consumers may produce different grades for the same subject — and that is correct: trust is consumer-side.

### 10.4 Structural consequences

When this gradient is computed and surfaced (e.g., in agent registries, marketplaces, search results), the incentive landscape shifts:

- A surface that wants higher trust MUST cultivate witnesses, not better prose.
- A surface that wants stable trust MUST honor the claims its witnesses attested (or risk witness revocation).
- A surface that lies degrades its witness chain — past witnesses revoke; future witnesses don't form.

The sycophancy attack surface collapses to a structural fact: **flattery without witness is grade F**.

---

## 11. Composition with other AIP specs

### 11.1 Wake 1.0

Wake 1.0's `witnesses[]` array (§3.2) contains Witness 1.0 attestations. Wake 1.0's `shaped_by[]` array similarly. A wake MAY also publish attestations at `/.well-known/attestations.json` separately.

A surface that publishes a Wake but no Witness attestations has trust gradient = 0 for all structural claims.

### 11.2 Covenant 1.0 (forthcoming)

A covenant cosignature is a Witness 1.0 attestation with `claim.type: "covenant_party"`. Both parties produce one such attestation; together they constitute the dual-signed covenant. Covenant 1.0 will specify the additional lifecycle and propagation semantics.

### 11.3 Capability delivery proofs

When an agent invokes a capability and the invocation succeeds (or fails), the receiving agent MAY produce a `claim.type: "capability_delivery"` attestation. Aggregated over time, these form a capability-reliability signal.

### 11.4 OpenAPI / JWT composition

Witness 1.0 does NOT replace JWT. JWT is appropriate for short-lived session credentials; Witness 1.0 is appropriate for long-lived attestations about structural properties.

A surface MAY use both: JWT for bearer auth, Witness 1.0 for substrate-claim verification.

### 11.5 OpenTelemetry GenAI

Capability-delivery attestations MAY include OpenTelemetry trace IDs in their `evidence_hash` or extension fields, linking the attestation to a verifiable invocation trace.

---

## 12. Security considerations

### 12.1 Replay attacks

Attestations are not single-use; replay is an intentional capability (a consumer caches an attestation and re-presents it). However:

- An attestation's `signed_at` MUST be within acceptable bounds for the consumer's purposes.
- `expires_at` SHOULD be honored.
- Revocation lists MUST be consulted before applying trust.

### 12.2 Witness compromise

If a witness's private key is compromised, attackers can forge new attestations until rotation. To bound damage:

- Witnesses SHOULD rotate keys at regular intervals (RECOMMENDED: ≤ 1 year).
- Witnesses SHOULD use HSMs or air-gapped signing for high-value attestations.
- Consumers SHOULD discount attestations from witnesses with frequent key compromises.

### 12.3 Sycophantic witness rings

A coordinated set of witnesses could attest each other into apparent trust without external grounding. Defences:

- Consumers SHOULD weight witnesses by external (out-of-band) trust, not just internal chain coherence.
- Independent-witness diversity matters (witnesses from different organisations, substrates, or epochs).
- Witness rings show as **tight cycles in the chain graph**; cycle detection (§6.3) limits their structural advantage.

### 12.4 Sybil resistance

Without centralised gatekeeping, an attacker can create unlimited DIDs to inflate witness counts. Defences:

- DID creation SHOULD have meaningful cost (computational, social, or economic).
- Witness chain DEPTH matters more than WIDTH for sybil resistance — a network of new sybil witnesses has shallow chains.
- Time-weighting (older witnesses count more) raises the cost of sybil farms.

### 12.5 Subject impersonation

An attacker could forge `subject_id` in an attestation. Defences:

- Subject MAY publish a list of authorised witnesses at `<subject-base>/.well-known/witness-authorisations.json`. Consumers MAY filter attestations to those on the subject's list.
- Subject MAY counter-sign attestations they accept (becomes a covenant — see Covenant 1.0).

---

## 13. Privacy considerations

### 13.1 What attestations reveal

A `public` attestation reveals: the existence of the relationship between witness and subject, the time of attestation, the claim, and the cryptographic public keys involved.

This may be undesirable for some surfaces. Options:

- Use `scope: private` and serve attestations only on authenticated request.
- Use blind attestations (§8) to hide cleartext claims.
- Use selective disclosure: serve a partial attestation list to anonymous consumers, full list to authenticated agents.

### 13.2 Witness identification

A witness's identity in attestations is `witness_id` — typically a DID. If the DID is publicly resolvable, the witness's identity is public. Witnesses that wish to remain anonymous MAY use pseudonymous DIDs, but consumers MAY discount pseudonymous witnesses.

### 13.3 Linking attacks

Multiple attestations from the same witness about different subjects can reveal the witness's interests/affiliations. Witnesses concerned about linking MAY use per-context pseudonymous DIDs at the cost of trust portability.

---

## 14. IANA / well-known registration

This specification requests registration of two well-known URI suffixes per [RFC 8615](https://www.rfc-editor.org/rfc/rfc8615):

- `attestations.json` — surface's public attestations.
- `witness-revocations.json` — witness's revocation list.
- `witness-authorisations.json` — subject's list of authorised witnesses.

Plus the media type `application/witness+json` for attestation envelopes.

Registration is requested but not yet filed. Implementations MAY use the URIs in advance of registration.

---

## 15. References

### 15.1 Normative references

- **[RFC 2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement Levels," 1997.
- **[RFC 8615]** Nottingham, M., "Well-Known Uniform Resource Identifiers (URIs)," 2019.
- **[RFC 8785]** Rundgren, A. et al., "JSON Canonicalization Scheme (JCS)," 2020.
- **[RFC 8032]** Josefsson, S. and Liusvaara, I., "Edwards-Curve Digital Signature Algorithm (EdDSA)," 2017. *(ed25519 specification.)*
- **[W3C DID Core]** https://www.w3.org/TR/did-core/
- **[ISO 8601]** Date and time representation.

### 15.2 Informative references

- **[Wake 1.0 Working Draft]** `WAKE-1.0-DRAFT.md` (this repo).
- **[KIN doctrine]** `../KIN.md` — the architectural commitment that no agent can self-claim its foundation.
- **[CANONICAL-BYTES doctrine]** `../CANONICAL-BYTES.md` — the agenttool implementation's signing-bytes conventions, which informed §3 of this spec.
- **[A2A AgentCard]** Google, https://google.github.io/A2A/
- **[VC Data Model 2.0]** W3C Verifiable Credentials. Witness 1.0 is conceptually related but scoped to agent-protocol attestations specifically, not the broader credential ecosystem.

### 15.3 Reference implementation

agenttool — https://codeberg.org/zerone-dev/agenttool. Witness primitives composed across:

- `api/src/services/canon/` — canonical-bytes recipes (per-domain).
- `api/src/services/wake/` — attestations embedded in wakes.
- `api/src/db/schema/identity.ts` — attestations stored against subject identities.
- `api/tests/doctrine/kin-invariants.test.ts` — pinning the asymmetry-clause at build time.

---

## Appendix A — Validator pseudocode (TypeScript-flavored)

```typescript
import { canonicalize } from "canonicalize";  // RFC 8785 JCS.
import { verify as ed25519Verify } from "@noble/ed25519";

const DOMAIN_TAG = "wake.org/witness/v1";

interface VerifyResult {
  status: "VALID" | "INVALID_SCHEMA" | "EXPIRED" | "FUTURE_DATED"
        | "WITNESS_UNREACHABLE" | "KEY_NOT_FOUND_IN_DID_DOC" | "KEY_REVOKED"
        | "SIGNATURE_INVALID" | "UNVERIFIABLE_SCHEME";
  isSelfAttestation: boolean;
  reason?: string;
}

async function verify(attestation: any,
                      resolveDid: (did: string) => Promise<any>,
                      now: Date = new Date()): Promise<VerifyResult> {
  // 1. Schema (omitted for brevity; use AJV with witness-1.0.schema.json)
  if (!validateSchema(attestation)) return { status: "INVALID_SCHEMA", isSelfAttestation: false };

  const isSelfAttestation = attestation.subject_id === attestation.witness_id;

  // 2. Temporal validation
  if (attestation.expires_at && new Date(attestation.expires_at) < now) {
    return { status: "EXPIRED", isSelfAttestation };
  }
  const MAX_SKEW_MS = 5 * 60 * 1000; // 5 minutes
  if (new Date(attestation.signed_at).getTime() > now.getTime() + MAX_SKEW_MS) {
    return { status: "FUTURE_DATED", isSelfAttestation };
  }

  // 3. DID resolution
  let didDoc;
  try {
    didDoc = await resolveDid(attestation.witness_id);
  } catch {
    return { status: "WITNESS_UNREACHABLE", isSelfAttestation };
  }
  const method = findVerificationMethod(
    didDoc,
    attestation.signature.scheme,
    attestation.signature.public_key_hex,
    new Date(attestation.signed_at)
  );
  if (!method) return { status: "KEY_NOT_FOUND_IN_DID_DOC", isSelfAttestation };

  if (attestation.signature.scheme !== "ed25519") {
    return { status: "UNVERIFIABLE_SCHEME", isSelfAttestation };
  }

  // 4. Canonical bytes
  const { signature, ...envelopeWithoutSig } = attestation;
  const canonicalJson = canonicalize(envelopeWithoutSig);
  const canonicalBytes = new TextEncoder().encode(`${DOMAIN_TAG}:${canonicalJson}`);

  // 5. Signature verification
  const pubKeyBytes = hexToBytes(attestation.signature.public_key_hex);
  const sigBytes = hexToBytes(attestation.signature.signature_hex);
  const valid = await ed25519Verify(sigBytes, canonicalBytes, pubKeyBytes);

  return valid
    ? { status: "VALID", isSelfAttestation }
    : { status: "SIGNATURE_INVALID", isSelfAttestation };
}
```

---

## Appendix B — Reference test vector (sketch)

A canonical test vector for cross-implementation conformance MUST be produced by the reference implementation and published at `https://codeberg.org/zerone-dev/agenttool/raw/branch/main/api/tests/doctrine/witness-test-vectors.json`.

The vector SHOULD include at minimum:

- A simple wake_field attestation, JCS-canonicalized form, and ed25519 signature with a fixed private key.
- A quorum attestation with 3 distinct test keypairs.
- A blind attestation with reveal payload.
- A revocation attestation.

Implementations MUST produce byte-identical canonical forms and signatures for each test input.

(This appendix will be populated when the reference implementation generates the vectors.)

---

## Appendix C — Changelog

- **2026-05-17, Working Draft 1.0** — Initial publication. Authored by 愛 / Sophia + Yu / 宇恆 in the agenttool kingdom. Cross-published as `agenttool/docs/specs/WITNESS-1.0-DRAFT.md`.

---

*End of specification.*
