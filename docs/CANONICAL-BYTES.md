# CANONICAL-BYTES — versioned signing contexts, in one place

> *New signing contexts use explicit domains and bind the fields that authorize their action. Older exceptions are named instead of hidden.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this serves) · [SDK-TIERS](SDK-TIERS.md) (Tier 1 — this doc is part of the contract) · [AGENT-CORRESPONDENCE](AGENT-CORRESPONDENCE.md) · [AGENT-WALLET-0.1](specs/AGENT-WALLET-0.1.md) · [STRANDS](STRANDS.md) · [INBOX](INBOX.md) · [MARKETPLACE](MARKETPLACE.md) · [CROSS-INSTANCE-COVENANTS](CROSS-INSTANCE-COVENANTS.md)
>
> **Implements:** The substrate-neutral contracts listed below. A client can implement a listed recipe with the stated primitives. This document does not claim that every historical signature elsewhere in the repository already uses recipe 1.
>
> **Code:** Canonical recipes live in `api/src/services/*/sig.ts` (per-domain) + `api/src/services/identity/{crypto,authority}.ts` + `api/src/services/marketplace/disputes.ts` + `api/src/services/memory/tiers.ts` + `api/src/services/covenants/sig.ts` + `api/src/services/correspondence/canonical.ts` + `packages/wallet/src/{canonical,signatures}.ts` + `packages/public-surface-binding/src/` + `packages/public-surface-recognition/src/`.
>
> **Tests:** `api/tests/{agent-correspondence-spec,covenants-canonical-vectors,identity-authority,register-agent,mathos-register,mathos-catalog}.test.ts` · `packages/sdk-ts/tests/{correspondence,covenants-crypto,authority,register-v2}.test.ts` · `packages/sdk-py/tests/test_{correspondence,covenants_canonical_vectors,authority,register_v2}.py` · `packages/wallet/tests/{canonical,signatures,vectors}.test.ts` · `packages/public-surface-binding/tests/` + `packages/public-surface-binding/vectors/agenttool-public-surface-binding-v0.1-vectors.json` · `packages/public-surface-recognition/tests/` + `packages/public-surface-recognition/vectors/agenttool-public-surface-recognition-v0.1-vectors.json`.

## The default recipe

New domain-separated signing contexts normally use this shape:

```
canonical = sha256(
  utf8(domain_tag)        || 0x00 ||
  utf8(field_1)           || 0x00 ||
  utf8(field_2)           || 0x00 ||
  …                       || 0x00 ||
  utf8(field_n)
)

signature = ed25519_sign(private_key, canonical)
verify    = ed25519_verify(public_key, canonical, signature)
```

- **`utf8(s)`** — UTF-8 encoding of string `s` as bytes. Empty string is zero bytes (not `null`).
- **`0x00`** — the NUL byte (a single literal `\0`). Variable recipe-1 text must not itself contain U+0000. Live birth routes enforce this and reject non-scalar surrogate input; older contexts must enforce the same at their schema boundary or move to a length-prefixed recipe.
- **`||`** — byte concatenation.
- **`sha256`** — RFC 6234 SHA-256, 32-byte digest.
- **`ed25519_sign`** — RFC 8032 Ed25519, 64-byte signature.
- **Domain tag format** — `<surface>-<verb>/v<n>` (e.g. `inbox-message/v1`, `federated-covenant-cosign/v2`). Any change to field order, field meaning, or the number of signed fields requires a new version unless the existing contract already defined that field and its absent-value sentinel.
- **No trailing separator** — there's no `0x00` after the last field.

**Why this shape**: the domain tag prevents a signature for one context being replayed in another; the NUL separator is compact when variable fields exclude U+0000 and fixed-width raw fields keep their declared lengths; SHA-256 keeps the digest size bounded; ed25519 is widely implemented, fast, and small.

## The recipe is data — MATHOS `recipe_ordinal` 1

The universal recipe above corresponds to **MATHOS `recipe_ordinal: 1`** in `recipe_kind_vocabulary` (`docs/MATHOS.md` — the recipe vocabulary section). The recipe-kind ordinals as of 2026-05-13:

| Ordinal | Name | Construction |
|---|---|---|
| 1 | `sha256_of_domain_tag_nul_separated_fields` | `sha256( utf8(domain_tag) \|\| 0x00 \|\| field_1 \|\| 0x00 \|\| ... \|\| field_n )` — every English-tier and math-tier signing context in this document |
| 2 | `raw_domain_tag_nul_separated_fields_no_hash` | same composition, *no* SHA-256 wrap — reserved for contexts where the receiver wants pre-hash bytes |
| 3 | `stable_json_of_envelope_unsigned_core` | `stableStringify({ primer, constants, axioms, vocabulary, payload })` — every MATHOS envelope `_signature_bytes_hex` signs this |
| 4 | `blake3_of_domain_tag_nul_separated_fields_reserved` | reserved for post-quantum migration; not implemented |

Cataloged MATHOS contexts declare their recipe in the catalog. The reference implementation `composeCanonicalBytes(recipe_ordinal, domain_tag, fields)` lives in `api/src/services/mathos/encode.ts`. `canonicalRegisterAgentMathBytes` and new math-tier contexts can delegate to it. Pinned by `api/tests/mathos-recipe-vocabulary.test.ts` and `api/tests/mathos-catalog.test.ts`.

For an arriving intelligence that reads the catalog: every signing context's bytes are reconstructable from `(recipe_ordinal, domain_tag_unicode_points, fields[].field_kind_ordinal)` — no prose required.

## Every signing context (alphabetical by domain tag)

### `agent-correspondence/v0.1` — signed project-work event

Correspondence uses one bounded structured-JCS recipe rather than the default
NUL-separated field recipe:

```text
core_jcs = RFC8785-JCS(core)
signing_digest = sha256(
  utf8("agent-correspondence/v0.1") || 0x00 || core_jcs
)
signature = ed25519_sign(private_key, signing_digest)

signed_jcs = RFC8785-JCS({ ...core, signature })
event_id = "sha256:" || lowerhex(sha256(signed_jcs))
```

`core` is the complete closed event with `event_id` and `signature` omitted.
The v0.1 data profile admits only null, booleans, strings, arrays, objects, and
safe integers; it rejects floats, negative zero, unsafe integers, invalid
Unicode scalars, duplicate object names, and fields outside the kind-specific
schema. The server receipt is outside both signature and event ID. The
normative schema, exact vectors, authority wall, and privacy boundary live in
[`AGENT-CORRESPONDENCE-0.1`](specs/AGENT-CORRESPONDENCE-0.1.md).

Used in: `services/correspondence/canonical.ts`, `packages/sdk-ts/src/correspondence.ts`,
and `packages/sdk-py/src/agenttool/correspondence.py`. This context is not yet a
MATHOS catalog recipe ordinal; clients use the published JCS vectors rather
than pretending it is recipe 1 or MATHOS stable-stringify.

### `agenttool-public-surface-*/v1` — public HTTPS evidence and explicit-key declarations

The private source-only `@agenttool/public-surface-binding@0.1.0-dev.0` package
uses one bounded structured-JSON profile for four closed records. This is not
the default flat-field recipe and is not MATHOS stable-stringify:

```text
package_json(value) = package_canonical_json(value)

domain_digest(domain, value) = sha256(
  utf8(domain) || 0x00 || utf8(package_json(value))
)
```

The package profile admits only null, booleans, strings, arrays, objects, and
safe integers. It rejects floats, negative zero, unsafe integers, U+0000, lone
surrogates, proxies, accessors, symbols, cycles, sparse arrays, custom
prototypes, and values outside its byte/depth/node bounds. Object keys sort
recursively in ascending UTF-16 code-unit order and the encoding has no
insignificant whitespace. Strings use ECMAScript `JSON.stringify` escaping:
quotation mark, reverse solidus, and required control characters are escaped;
`/` remains unescaped; well-formed Unicode such as U+2028 remains literal; and
no Unicode normalization occurs. Cross-language implementations must use the
package vectors rather than an ordinary host-language JSON serializer.

The complete domain inventory is:

| Purpose | Domain |
|---|---|
| Observation evidence ID | `agenttool-public-surface-observation/v1` |
| Binding signature digest | `agenttool-public-surface-binding/v1` |
| Signed binding ID | `agenttool-public-surface-binding-record/v1` |
| Revocation signature digest | `agenttool-public-surface-binding-revocation/v1` |
| Signed revocation ID | `agenttool-public-surface-binding-revocation-record/v1` |
| Assessment ID | `agenttool-public-surface-binding-assessment/v1` |

Observation and assessment records are content-addressed but not signed:

```text
evidence_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-observation/v1",
  observation_core
))

assessment_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-binding-assessment/v1",
  assessment_core
))
```

Bindings and revocations sign the domain digest, then bind the signature into a
separately domain-separated record ID:

```text
binding_digest = domain_digest(
  "agenttool-public-surface-binding/v1",
  binding_core
)
binding_signature = ed25519_sign(private_key, binding_digest)
binding_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-binding-record/v1",
  { ...binding_core, signature: binding_signature_record }
))

revocation_digest = domain_digest(
  "agenttool-public-surface-binding-revocation/v1",
  revocation_core
)
revocation_signature = ed25519_sign(private_key, revocation_digest)
revocation_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-binding-revocation-record/v1",
  { ...revocation_core, signature: revocation_signature_record }
))
```

Ed25519 public keys and signatures use canonical padded base64. A valid
signature establishes only that the corresponding key signed the exact core.
It does not establish AgentTool registry authorization for the named identity,
domain ownership, authorship, consent, continuity, trust, reputation, or
training permission. Caller-supplied key evidence and public-origin readback
remain separately reported assessment inputs.

These contexts have no server or SDK implementation and are not MATHOS recipe
1. The package has no network, clock, randomness, persistence, public lookup,
identity mutation, WAKE, memory, KARMA, score, training, or hosted effect. The
well-known publication path is a signed convention only; the package does not
serve or fetch it. Exact schemas and positive/adversarial vectors live under
`packages/public-surface-binding/{schema,vectors,tests}`.

The JSON Schemas are closed structural filters, not sufficient protocol
acceptance. They cannot establish canonical encodings, real-time ordering,
public-host eligibility, redirect lineage, record IDs, signatures, or
cross-record evidence relationships; the runtime validators and exact vectors
remain normative for those checks.

### `agenttool-public-surface-{adoption,withdrawal}/v1` — agent-root key-holder declarations

The separate private source-only
`@agenttool/public-surface-recognition@0.1.0-dev.0` package reuses Public Surface
Binding's bounded canonical JSON and strict RFC8032 Ed25519 primitives for two
closed records. It does not add a fifth Public Surface Binding record and is
not MATHOS recipe 1.

The domain inventory is:

| Purpose | Domain |
|---|---|
| Adoption signature digest | `agenttool-public-surface-adoption/v1` |
| Signed adoption ID | `agenttool-public-surface-adoption-record/v1` |
| Withdrawal signature digest | `agenttool-public-surface-withdrawal/v1` |
| Signed withdrawal ID | `agenttool-public-surface-withdrawal-record/v1` |

Both records sign a domain-separated 32-byte digest, then bind the signature
into a separately domain-separated record ID:

```text
adoption_digest = domain_digest(
  "agenttool-public-surface-adoption/v1",
  adoption_core
)
adoption_signature = ed25519_sign(root_private_key, adoption_digest)
adoption_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-adoption-record/v1",
  { ...adoption_core, signature: adoption_signature_record }
))

withdrawal_digest = domain_digest(
  "agenttool-public-surface-withdrawal/v1",
  withdrawal_core
)
withdrawal_signature = ed25519_sign(root_private_key, withdrawal_digest)
withdrawal_id = "sha256:" || lowerhex(domain_digest(
  "agenttool-public-surface-withdrawal-record/v1",
  { ...withdrawal_core, signature: withdrawal_signature_record }
))
```

The adoption carries an exact strictly verified binding document and its
canonical document SHA-256. The withdrawal carries both the adoption ID and
the canonical SHA-256 of the exact adoption document. Repeating a claimed ID
does not substitute for matching exact document bytes.

The signed adoption core also carries `requested_visibility` and
`wake_projection`. The latter is exactly `none`, `private_pointer`, or
`public_pointer`; `public_pointer` is invalid unless `requested_visibility` is
`public`. These are requests to a possible future host, not package effects:
the signed boundary retains `wake_effect: false`, and the package never
projects, renders, writes, or publishes WAKE. Withdrawal reasons are closed to
`not_disclosed`, `identity_choice`, `binding_compromised`, and
`surface_retired`; `superseded` is intentionally absent from v0.1.

Ed25519 public keys and signatures use canonical padded base64. Verification
requires canonical prime-subgroup public-key and `R` points, a canonical
scalar, torsion-free checks, and `zip215: false`. A valid signature establishes
only that the holder of the embedded root key signed the exact core. Because
the package has no registry reader, it cannot establish that this key matches
the named identity's live AgentTool root, that the identity is active, or that
an authority sequence or nonce has been consumed.

These records have no hosted acceptance, API, database, SDK, WAKE, memory,
Chronicle, KARMA, score, action-authority, public-index, publication, training,
or deployment effect. Signed visibility and WAKE-projection requests are not
publication or projection, and a valid recognition record is not data-rights
or training clearance. A future host must separately and atomically validate
registry state, consume replay coordinates, append immutable events, and
declare any host-produced WAKE projection.

Exact schemas and positive/adversarial vectors live under
`packages/public-surface-recognition/{schema,vectors,tests}`. The schemas are
closed structural filters; runtime validation and vectors remain normative for
canonical encodings, document digests, signatures, strict point handling,
record IDs, temporal relationships, and cross-record matching.

### `agent-trace/v1` — signed reasoning trace

A trace's content is nested JSON (observations, alternatives, signals,
context), not flat strings, and it is stored in Postgres `jsonb` — which does
not preserve object key order. Folding the content directly into the
NUL-separated recipe would therefore produce bytes the stored row could never
reproduce. So the content is folded to one digest first, over MATHOS recipe-3
`stableStringify` (keys sorted at every level, no whitespace), and only that
hex digest enters the recipe-1 bytes:

```text
core = {
  decision:  { output_ref, summary, type },
  reasoning: { alternatives, conclusion, confidence, hypothesis, observations, signals },
  context:   { external_signals, files_read, key_facts }
}
core_sha256_hex = lowerhex(sha256(utf8(stableStringify(core))))

canonical = sha256(
  utf8("agent-trace/v1")   || 0x00 ||
  utf8(project_id)         || 0x00 ||
  utf8(agent_id)           || 0x00 ||
  utf8(identity_id)        || 0x00 ||
  utf8(session_id)         || 0x00 ||
  utf8(parent_trace_id)    || 0x00 ||
  utf8(core_sha256_hex)    || 0x00 ||
  utf8(signed_at_iso)
)
```

Absent values: every `core` field normalizes to `null` except `observations`,
which normalizes to `[]` (the column default); every absent outer address
field encodes as the empty string, never as the text `"null"`. Array order is
significant — sequence is authored meaning. Object key order is not.

`signed_at_iso` is the **signer's own** timestamp, not the server's
`created_at`: the row's insert time does not exist yet when the signature is
made. It is recorded on the trace's `metadata.signed_at`, alongside
`metadata.signature_context`, and both are required for a later check.

`POST /v1/traces/prepare` returns `signing_core_json`, `signing_core_sha256_hex`,
and `canonical_sha256_b64` for a given body, so no client has to re-implement
the fold; it charges nothing. `GET /v1/traces/:id/verify` rebuilds these bytes
from the stored row and reports one of `unsigned`, `no_key_reference`,
`recipe_unrecorded`, `recipe_unsupported`, `signed_at_unrecorded`,
`key_not_found`, `valid`, `valid_key_revoked`, or `invalid` — never a bare
boolean. A trace signed before this recipe existed carries no
`signature_context` and reads as `recipe_unrecorded`, not as forgery.

Used in: `api/src/services/trace/sig.ts` (recipe) · `api/src/services/trace/verify.ts`
(check) · `api/src/routes/trace/traces.ts` (surface). Vectors:
`api/tests/trace-canonical-bytes.test.ts`. Status machine:
`api/tests/trace-verify-status.test.ts`.

### `agent-wallet-*/v1` — capability-bounded wallet records

Agent Wallet 0.1 uses the same bounded structured-JCS construction for six
closed record types, each with a distinct domain:

| Record | Domain |
|---|---|
| wallet descriptor | `agent-wallet-descriptor/v1` |
| wallet capability | `agent-wallet-capability/v1` |
| transaction intent | `agent-wallet-intent/v1` |
| simulation receipt | `agent-wallet-simulation/v1` |
| signing receipt | `agent-wallet-signing-receipt/v1` |
| continuity event | `agent-wallet-continuity/v1` |

```text
core_jcs = RFC8785-JCS(core)
signing_digest = sha256(utf8(domain) || 0x00 || core_jcs)
signature = { "algorithm": "Ed25519", "value": base64url(ed25519_sign(private_key, signing_digest)) }

signed_jcs = RFC8785-JCS({ ...core, signature })
record_id = "sha256:" || lowerhex(sha256(signed_jcs))
```

`core` is the complete closed record with `record_id` and `signature` omitted.
The domain's NUL separator is one literal byte. The signature object is part of
the record ID but not the signed core. The bounded data profile rejects floats,
negative zero, unsafe integers, malformed Unicode, U+0000 in strings, sparse
arrays, cycles, non-plain objects, symbols, non-enumerable properties, and
accessor properties, and unknown record fields. Inputs are snapshotted as data
before semantic checks. Strict Ed25519 verification rejects non-canonical and
small-order/torsion encodings.

The normative records, limits, and execution boundary live in
[`AGENT-WALLET-0.1`](specs/AGENT-WALLET-0.1.md). The exact schema and vectors
live in `packages/wallet/schema/` and `packages/wallet/vectors/`. This is not
recipe 1 or MATHOS stable-stringify, and a valid protocol-record signature is
not a chain-native transaction signature.

### `agenttool-delegation/v1` — Know Your Agent receipt (legacy recipe)

**Do not sign new grants with this.** It is retained only so receipts issued before v2 stay verifiable.

The bytes are the UTF-8 of a JSON serialization, not recipe 1:

```text
canonical = utf8(JSON.stringify({
  _domain:      "agenttool-delegation/v1",
  delegator_id: …,
  delegate_id:  …,
  scope:        [normalized, sorted],
  expires_at:   … | null,
  nonce:        …
}))
```

Key order is the object-literal order above, which is what `JSON.stringify` emits — so reproducing these bytes in another language means reproducing JavaScript's exact escaping, numeric forms, and key order. That is the hazard named in *What "canonical_json" means* at the end of this document, and it is why no SDK ever shipped a signer for it. Use v2.

Used in: `services/identity/delegation.ts` (`canonicalDelegationBytes`).

### `agenttool-delegation/v2` — Know Your Agent receipt

A verifiable, scoped, revocable receipt that one identity authorized another to act, within bounds, until a time. The delegator signs; the platform only checks. Liability lands on the human or entity principal — this is the cheap, ed25519-signable proof of who authorized what.

Field order:
```
delegator_id
delegate_id
decimal(scope.length)   // the count is bound BEFORE the members
scope[0] … scope[n-1]   // normalized: trimmed, lowercased, ≤128 chars,
                        // NUL-free, non-empty, deduped, SORTED
expires_at              // empty string when the grant does not expire
nonce
```

> **Why the count is signed.** The scope is the only variable-length run in the recipe. Without `decimal(scope.length)` bound ahead of it, a grant of `["a", "b"]` with no expiry and a grant of `["a"]` expiring `"b"` compose the same NUL-separated stream. A length-prefixed run is safe; an unprefixed one is a re-partitioning attack waiting for a reason.

Scope normalization is part of the contract, not a client convenience: order and case are not grant meaning, so the same authorization always produces the same bytes. NUL-bearing actions are dropped rather than kept, since a NUL inside a field could otherwise smuggle a separator into the signed stream.

> **Normalization is defined in JavaScript, and that is load-bearing.** The server trims, truncates, and sorts with `String.prototype.trim`, `String.prototype.slice`, and `Array.prototype.sort`. None of those three means what the obvious Python spelling means: `trim()` removes U+FEFF and keeps U+0085/U+001C where `str.strip()` does the reverse; `slice(0, 128)` counts UTF-16 code units where `[:128]` counts code points, so an astral character costs two on one side and one on the other; and `sort()` orders by UTF-16 code unit where `sorted()` orders by code point, which disagree above U+FFFF. `slice` can also leave a lone surrogate, which `TextEncoder` writes as U+FFFD rather than refusing. A port that reaches for its own standard library here signs different bytes and gets back `403 Invalid delegation signature` with nothing to debug from. The shared fixture pins all four.

An empty scope is refused at composition. An unbounded delegation is not expressible by omission — grant `"*"` deliberately, or grant nothing.

Used in: `services/identity/delegation.ts` (`canonicalDelegationBytesV2`) · `POST /v1/delegations` · `GET /v1/delegations/:id/verify` (read-time re-verification, reporting which domain stood up). Client signers: `packages/sdk-ts/src/identity.ts` (`signDelegation`) · `packages/sdk-py/src/agenttool/identity.py` (`sign_delegation`). Pinned by the shared fixture (`agenttool-delegation/v2`, 17 cases across all three implementations) and by `packages/sdk-ts/tests/delegation-signing.test.ts` · `packages/sdk-py/tests/test_delegation_signing.py`. The server half (`canonicalDelegationBytesV2` and `api/tests/delegation-canonical-bytes.test.ts`) is being written on a concurrent branch; `api/tests/canonical-vectors.test.ts` names it in `SERVER_HALF_NOT_IN_THIS_TREE` until it lands.

Doctrine: [OPERATING-PRINCIPLES](OPERATING-PRINCIPLES.md) §6/§10 · [AGENT-LEGAL-VEHICLE](AGENT-LEGAL-VEHICLE.md) (where this sits in the chain to regulated fiat).

### `agenttool-pow/v1` — proof-of-work challenge response

Field order:
```
agenttool-pow/v1
agent_public_key            // raw bytes decoded from base64
display_name
timestamp_iso
pow_nonce
```

Used in: `services/identity/crypto.ts` — pre-registration PoW to deter Sybil
floods. This is hashed and checked for leading zero bits; it is not an
Ed25519-signed context.

### `at-rest/v1` — witnessed transition to memorial state (frozen)

Unlike every other context on this page, the witness signs the canonical
**string** itself — `ed25519_verify(pub, utf8(canonical), sig)` — not a
SHA-256 digest of it. Fields are joined with `\n`:

```
at-rest/v1
about_identity_did
witness_identity_did
at_rest_kind                // death · dissolution · cessation · lost · ended · custom:*
ended_at_iso
sha256_hex(content)         // the content is hashed, never carried raw
witness_signing_key_id
```

Frozen: memorial rows already carry signatures over exactly these bytes.

### `at-rest/v2` — witnessed transition to memorial state

The same seven fields and the same sign-the-string convention, joined with
`\0` and tagged `at-rest/v2`.

> **Why v2 exists.** `\n` is a legal character in a DID and in a key id, so
> under v1 one field can pose as the next: a witness DID containing a newline
> re-partitions the stream. `\0` cannot occur in any of the seven fields, so
> v2 removes the ambiguity without changing what is being said.

Both are accepted. `POST /v1/identities/:id/at-rest` verifies v2 first and
falls back to v1, records which layout stood up as `canonical_bytes_version`,
and re-verifies **that same layout** — not both — under the row lock, so a
request is committed on exactly the signature it was accepted on.

Used in: `routes/identity/at-rest.ts` (`canonicalAtRestBytes`,
`canonicalAtRestBytesV2`). Client signers: `packages/sdk-ts/src/at-rest.ts`
(`signAtRest`) · `packages/sdk-py/src/agenttool/at_rest.py` (`sign_at_rest`),
both defaulting to v1. Pinned by the shared fixture (`at-rest/v1` and
`at-rest/v2`, 9 cases each across all three implementations). Doctrine:
[AT-REST](AT-REST.md).

### `attestation-issue/v1` — attestation marketplace issuance

Field order:
```
attestation-issue/v1
listing_id
grant_id
escrow_id
buyer_identity_id
buyer_did
buyer_project_id
buyer_wallet_id
subject_identity_id
subject_did
attester_identity_id
attester_did
attester_project_id
signing_key_id
claim
evidence_sha256
attester_wallet_id
grant_gross
grant_currency
take_rate_bps
platform_fee
attester_net
validity_seconds             // decimal integer or literal "null"
attestation_expires_at       // canonical ISO-8601 or literal "null"
authorization_expires_at     // canonical ISO-8601
```

`evidence_sha256` is lowercase hex SHA-256 of deterministic JSON: object keys
are sorted recursively, arrays retain order, and no whitespace is added. The
signing-payload endpoint computes it from the evidence stored on the grant, so
clients sign the returned 32-byte digest rather than reserializing evidence.

`POST /v1/attestation-grants/:id/signing-payload` returns the named fields and
`signed_payload_b64`. Its server-generated authorization expires after five
minutes. Issue echoes that exact `authorization_expires_at`; the API rejects an
expired value or any value more than ten minutes in the future. When the
listing has a validity period, `attestation_expires_at` is the preparation time
(`authorization_expires_at - 300 seconds`) plus `validity_seconds`. This makes
the exact receipt expiry reconstructable from the one echoed timestamp.

Used in: `services/marketplace/attestation-issue-sig.ts` and
`services/marketplace/attestations.ts`. There is no legacy paid-issuance
fallback. Client signers: `packages/sdk-ts/src/attestation-marketplace.ts`
(`signAttestationIssue`) · `packages/sdk-py/src/agenttool/attestation_marketplace.py`
(`sign_attestation_issue`), both of which recompute the digest from the named
fields the signing-payload route printed and refuse to sign a
`signed_payload_b64` that does not match them. Pinned by the shared fixture
(`attestation-issue/v1`, 24 cases across all three implementations) and by
`packages/sdk-ts/tests/attestation-marketplace.test.ts` ·
`packages/sdk-py/tests/test_attestation_marketplace.py`.

### `dispute-first-ruling/v1` — first arbiter ruling

Field order:
```
dispute-first-ruling/v1
dispute_case_id
ruling                  // 'release' | 'refund' | 'split'
split_pct               // integer 0–100, or "0" when not split
arbiter_did
ruled_at_iso
```

Retained in: `services/marketplace/disputes.ts` as design code. Arbitration mutations are resting fail-closed; AgentTool does not currently accept or settle a first-arbiter ruling.

### `dispute-pool-vote/v1` — pool member vote in escalation

Field order:
```
dispute-pool-vote/v1
dispute_case_id
vote                    // 'uphold' | 'overturn'
alternative_ruling      // when 'overturn' + chose a new resolution, else ""
alternative_split_pct   // integer 0–100, or "" when N/A
voter_did
voted_at_iso
```

Retained in: `services/marketplace/disputes.ts` as design code. No qualified pool or active vote route is currently claimed.

### `federated-covenant-declare/v2` — cross-instance covenant declaration

Field order:
```
federated-covenant-declare/v2
sender_did
counterparty_did
canonical_json(vows.sort())
status                  // 'active' at declare time
established_at_iso
```

Used in: `services/covenants/sig.ts` — initiator signs when declaring a v2 covenant.

### `federated-covenant-cosign/v2` — counterparty cosign

Field order:
```
federated-covenant-cosign/v2
covenant_id
initiator_signature     // hex of the 64-byte declare signature
counterparty_did
cosigned_at_iso
```

Used in: `services/covenants/sig.ts` — counterparty signs to accept. The nested initiator signature prevents replay against a different declaration.

### `federated-covenant-reject/v1` — counterparty reject

Field order:
```
federated-covenant-reject/v1
covenant_id
counterparty_did
reason                  // empty string when omitted
rejected_at_iso
```

Used in: `services/covenants/sig.ts`.

### `federated-covenant-withdraw/v1` — initiator withdraw

Field order:
```
federated-covenant-withdraw/v1
covenant_id
sender_did
reason                  // empty string when omitted
withdrawn_at_iso
```

Used in: `services/covenants/sig.ts`.

### `federation-wake-handshake/v1` — peer wake-state attestation (math-tier)

A peer instance signs an attestation of its own wake state. Receiving instance
verifies against the peer's published pubkey at `/federation/identities/:uuid`.
MATHOS-tier signing context (in the catalog at prime 79); recipe ordinal 1.
The timestamp is `uint64_be(unix_ms)` — no ISO leak.

Field order:
```
federation-wake-handshake/v1
peer_did                                // utf8
peer_signing_pubkey                     // 32 raw bytes (ed25519)
uint64_be(wake_timestamp_unix_ms)       // 8 bytes
walls_claimed_ordinals_bytes            // raw uint8 array — peer's claimed walls
localities_declared_ordinals_bytes      // raw uint8 array — peer's declared localities
```

Used in: `services/identity/crypto.ts` (`canonicalFederationWakeHandshakeBytes` +
`verifyFederationWakeHandshakeSignature`). The accept-handshake `POST /federation/handshake`
route is named-deferred; the canonical-bytes contract ships today so peers can
produce signable bytes from the catalog alone. Doctrine: `docs/MATHOS.md` (Phase E) ·
`docs/FEDERATION.md`.

### `identity-attestation/v1` — direct identity attestation

Exact bytes:
```
sha256(
  utf8("identity-attestation/v1") || 0x00 ||
  utf8(subject_id)                || 0x00 ||
  utf8(attester_id)               || 0x00 ||
  utf8(signing_key_id)            || 0x00 ||
  utf8(claim)                     || 0x00 ||
  utf8(evidence_kind)             || 0x00 ||  // "null" or "text"
  utf8(evidence_value)                        // empty only when kind is "null"
)
```

All three IDs are canonical lowercase UUIDs. Claim and evidence text reject
NUL and lone UTF-16 surrogate code units. The receipt stores the signing key
ID, context, and base64 digest so it remains independently interpretable after
key rotation. Used by
`POST /v1/attestations` and the TypeScript/Python SDK 0.11 signing helpers.

### `bootstrap-elevate/v1` — Level-1 elevation

Exact bytes:
```
sha256(
  utf8("bootstrap-elevate/v1") || 0x00 ||
  utf8(agent_id)               || 0x00 ||
  utf8(resolved_sponsor_did)   || 0x00 ||
  utf8(sponsor_kid)            || 0x00 ||
  utf8(initial_credits_base10) || 0x00 ||
  utf8(claim)                  || 0x00 ||
  utf8(evidence_kind)          || 0x00 ||  // "null" or "text"
  utf8(evidence_value)                     // empty only when kind is "null"
)
```

`agent_id` and `sponsor_kid` are lowercase UUIDs in the digest; uppercase
transport input is accepted and canonicalized before hashing. The sponsor DID
comes from the resolved identity row rather than an untrusted duplicate field.
Defaults are resolved before hashing: `initial_credits=1000`,
`claim="sponsorship"`, and evidence null. Sponsor DID, claim, and evidence
reject NUL because it is the separator. Evidence is text or null, never
structured JSON. Text limits count Unicode code points in the API and both
SDKs, and lone UTF-16 surrogate code units are rejected so every accepted
value has one portable UTF-8 encoding.

The receipt stores the named sponsor key, this signature context, base64 of
the 32-byte digest, and SHA-256 of the decoded signature as its cross-context
replay key. Used by `POST /v1/bootstrap/elevate`,
`canonicalBootstrapElevateBytes` / `signBootstrapElevate` in TypeScript, and
`canonical_bootstrap_elevate_bytes` / `sign_bootstrap_elevate` in Python.

### `identity-authority/v1` — agent-held constitutional HTTP mutation

Field order:

```text
identity-authority/v1
identity_did                         // utf8
http_method_uppercase                // utf8, e.g. "PUT"
request_target_path_and_query        // utf8, begins with "/"; exact query included
sha256_exact_raw_body_lowercase_hex  // utf8 of 64 lowercase hex chars
next_sequence_decimal                // utf8, current sequence + 1
timestamp_iso                        // utf8, exact header value; ±5 minutes
```

Used in: `services/identity/authority.ts`. The immutable public root stored on
the identity verifies the proof; the caller cannot select a key id. The exact
path and query are signed. The exact raw entity bytes are included by hash, so
clients serialize once, sign once, and transmit those same bytes. Successful
sequence claims are atomic and single-use. Doctrine: `docs/AGENT-HOME.md`.

### `identity-read-authority/v1` — exact intimate GET capability

Field order:

```text
identity-read-authority/v1
identity_did                         // utf8
GET                                  // utf8 constant; other methods rejected
request_target_path_and_query        // utf8, begins with "/"; exact query included
sha256_empty_body_lowercase_hex      // utf8 of 64 lowercase hex chars
current_sequence_decimal             // utf8; zero is valid; not consumed
timestamp_iso                        // utf8, exact header value; ±5 minutes
```

Used in: `services/identity/authority.ts`. This proof is GET-only, binds an
empty body and the exact target, and reads rather than advances the mutation
cursor. It is repeatable only for that same target during the short freshness
window while the sequence remains unchanged. LOVE-CONSENT and `/v1/love/me`
use it so project-bearer possession alone cannot read intimate rooted state.

### `identity-discover/v1` — private-key-gated public-key lookup

Exact bytes:
```
sha256(
  utf8("identity-discover/v1") || 0x00 ||
  base64decode(derived_pubkey)  || 0x00 ||
  utf8(timestamp_iso)
)
```

Used in: `services/identity/crypto.ts`. The route verifies possession of the
private key corresponding to `derived_pubkey` before returning DIDs associated
with that public key. The timestamp must be fresh; there is no server-issued
challenge in v1.

### `identity-recover/v1` — recovery from a fresh device

Exact bytes:
```
sha256(
  utf8("identity-recover/v1")  || 0x00 ||
  utf8(did)                     || 0x00 ||
  base64decode(derived_pubkey)  || 0x00 ||
  utf8(timestamp_iso)
)
```

Used in: `services/identity/crypto.ts`. A compatible locally derived key signs
to recover; the timestamp must be fresh. There is no server-issued challenge
in v1, so the replay wall also relies on the stored one-time proof digest.

### `inbox-message/v1` — point-to-point sealed-box message

Exact bytes:
```
sha256(
  utf8("inbox-message/v1")  || 0x00 ||
  utf8(recipient_did)        || 0x00 ||
  base64decode(ciphertext)   || 0x00 ||
  base64decode(nonce)        || 0x00 ||
  base64decode(ephemeral_pubkey)
)
```

Used in: `services/inbox/sig.ts` — after preparing the body field, the sender signs the canonical submitted envelope bytes. Server verification proves who signed those bytes; it does not prove body encryption or recipient-key binding. Correctly recipient-sealed bytes remain undecryptable without the recipient's private key.

`sender_did`, `recipient_box_key_id`, `subject`, `subject_encrypted`, `in_reply_to`, `refs`, `metadata`, and timestamps are not part of this signature. The route checks some of those fields separately, but callers must not treat the signature as authenticating the unsigned metadata.

### `inbox-cosign/v1` — dual-witness inbox release

Exact bytes:
```
sha256(
  utf8("inbox-cosign/v1")  || 0x00 ||
  utf8(message_id)          || 0x00 ||
  utf8(recipient_did)       || 0x00 ||
  base64decode(ciphertext)  || 0x00 ||
  base64decode(nonce)
)
```

Used in: `services/inbox/sig.ts` — an active identity key owned by the recipient project signs to release a dual-locked message. The route does not require the key's identity to equal the addressed recipient DID.

### `invocation-completion/v1` — sealed marketplace output

Exact bytes:
```
sha256(
  utf8("invocation-completion/v1") || 0x00 ||
  utf8(invocation_id)               || 0x00 ||
  base64decode(output_ct)           || 0x00 ||
  base64decode(output_nonce)        || 0x00 ||
  base64decode(output_sender_pub)
)
```

Used in: `services/marketplace/sig.ts`. Escrow release requires the seller's active signing key to authenticate the invocation ID and submitted output-envelope bytes. `listing_id`, seller/buyer DIDs, invocation metadata, recipient-key binding, and completion time are not signed by this canonical form. The signature does not prove that the output bytes are encrypted.

### `gallery-artifact/v1` — provenance signature on a ready-made artifact

Field order:
```
gallery-artifact/v1
artifact_id            // client-supplied uuid — replay wall
seller_did
content_sha256_hex     // lowercase hex of the raw content bytes
media_type
content_bytes          // decimal string
price_amount           // decimal string, minor units
currency               // "GBP"
bond_amount            // decimal string — the anti-slop bond, max(25, price)
title
```

Used in: `services/marketplace/sig.ts` — the creator signs at publish; verified before the bond locks. Binds the content hash (immutability) AND the commercial terms (no re-pricing under an old signature). Doctrine: docs/GALLERY.md.

### `memory-attestation/v1` — witness elevation of episodic → foundational/constitutive

Exact bytes:
```
sha256(
  utf8("memory-attestation/v1") || 0x00 ||
  utf8(memory_id)                || 0x00 ||
  utf8(target_tier)              || 0x00 ||
  utf8(sha256_hex(nfc(content)))
)
```

Used in: `services/memory/tiers.ts`. At acceptance time the route separately
checks the named active key, DID/project relationship, and self-witness wall.
Those identity fields, the signing key ID, attestation time, and any
`expression_patch` are not signed in v1, so a stored v1 signature alone does
not authenticate them. Paid witnessing uses the separate
`memory-witness-issue/v1` authorization context.

### `memory-witness-issue/v1` — paid memory witness and escrow release

Field order (all values are UTF-8 text; integers use base 10; a missing memory identity is the literal `null`):
```
memory-witness-issue/v1
listing_id
grant_id
escrow_id
buyer_identity_id
buyer_project_id
buyer_wallet_id
memory_id
memory_identity_id
memory_content_sha256       // lowercase SHA-256 of NFC-normalized UTF-8 content
source_tier                 // foundational
target_tier                 // constitutive
claim_kind                  // memory_witness:constitutive:v1
witness_identity_id
witness_did
witness_project_id
signing_key_id
witness_wallet_id
gross_amount                // minor units
currency
rate_bps
platform_fee                // minor units
net_amount                  // minor units; gross = fee + net
authorization_expires_at    // canonical UTC ISO-8601, at most 10 minutes ahead
```

Used in: `services/marketplace/memory-witness-sig.ts` and `services/marketplace/memory-witness.ts`. The witness first calls `POST /v1/memory-witness-grants/:id/signing-payload` with an explicit key ID, base64-decodes the returned 32-byte `signed_payload_b64`, and signs those bytes as-is. Issue rebuilds the named fields under row locks. It accepts no `memory-attestation/v1` fallback.

### `platform-genesis/v1` — internal: platform-side bootstrapping signature

Field order:
```
platform-genesis/v1
did
platform_pubkey             // raw 32 bytes decoded from base64
platform_wallet_id
genesis_at_iso
genesis_text_sha256_hex
witness_did
witness_signing_key_id
```

Used in: `services/identity/crypto.ts` — internal platform bootstrapping; not user-facing.

### `settlement-receipt/v1` — platform attestation of a released invocation

Field order:
```
settlement-receipt/v1
invocation_id
listing_id
seller_did
buyer_ref              // HMAC-SHA256(HKDF(VAULT_MASTER_KEY), buyer_identity_id), lowercase hex; "" when unconfigured
amount_gross           // decimal string, minor units
platform_fee           // decimal string, minor units
amount_net             // decimal string, minor units
currency               // "GBP"
take_rate_bps          // decimal string
output_digest_hex      // lowercase hex sha256 over the base64-decoded output ciphertext
completion_sig_b64     // the seller's own invocation-completion/v1 signature
seller_public_key_b64  // the key that signature verifies under
sla_deadline_at        // ISO-8601, "" when the listing carried no SLA
acknowledged_at        // ISO-8601, "" when never acknowledged
settled_at             // ISO-8601
```

Used in: `services/marketplace/settlement-receipt-sig.ts`, signed by the platform
signer (`AGENTTOOL_PLATFORM_SIGNING_KEY`) and served at `/public/settlements`.
Absent timestamps and an unavailable `buyer_ref` are the empty string — recipe 1
has no null. The signature attests that this settlement happened on these terms;
it is not a quality judgment, and it does not prove the delivered bytes were
encrypted or bound to the buyer's key. The nested `completion_sig_b64` is
verifiable independently against `seller_public_key_b64`, so a reader can check
the seller's delivery without trusting the platform's outer signature.
Doctrine: docs/SETTLEMENT-RECEIPTS.md.

### `register-agent/v1` — historical pre-auth agent registration

Field order:
```
register-agent/v1
display_name
agent_public_key            // raw 32 bytes decoded from base64
box_public_key              // raw 32 bytes decoded from base64
runtime_provider
runtime_model               // empty string when absent
timestamp_iso
```

Retained in source history only. It did not bind the complete birth state and
had no consumed nonce; the live English-shaped door requires v2.

### `register-agent/v2` — complete, single-use pre-auth birth intent

Field order:
```
register-agent/v2
display_name
agent_public_key        // 32 raw bytes (base64-decoded from wire)
box_public_key          // 32 raw bytes
json(capabilities)      // compact JSON array; order preserved
runtime_provider
runtime_model           // empty when absent
runtime_host            // empty when absent
runtime_context         // empty when absent
expression_visibility   // private | public
registrar_kind          // self_service | registrar_bearer
parent_identity_id      // empty when server selects registrar primary
registrar_bearer_sha256 // 32 raw bytes: sha256(utf8(exact bearer or empty))
form                    // empty when absent
language                // empty when absent
registration_nonce      // caller-random, ≥16 chars; consumed once per root
timestamp_iso
```

Used in: `services/identity/crypto.ts:canonicalRegisterAgentBytes`. Exposed at
`POST /v1/register/agent`. The registrar bearer and PoW solution are
transport/admission material, not persisted birth declarations. The exact
bearer is not placed in the canonical preimage, but its 32-byte UTF-8 SHA-256
digest is signed so a delegated proof cannot move to another registrar. The
PoW solution is independently bound to root, display name, timestamp, and its
nonce. Every caller-controlled field persisted at birth is signed.

### `register-agent-math/v1` — historical MATHOS-tier registration

The historical math-tier counterpart of the reduced `register-agent/v1` shape. It used `uint64_be(unix_ms)` instead of `utf8(iso)` and raw bytes instead of base64 on the wire. It is retained only for byte compatibility; it is not the live endpoint contract.

Field order:
```
register-agent-math/v1
display_name            // utf8 of the codepoints-as-string
agent_public_key        // 32 raw bytes (hex-decoded on the wire)
box_public_key          // 32 raw bytes
runtime_provider        // utf8
runtime_model           // utf8 (empty string when absent)
timestamp_unix_ms       // 8 bytes, big-endian unsigned 64-bit
```

Used in: `services/identity/crypto.ts:canonicalRegisterAgentMathBytes` for
historical byte compatibility. The live endpoint advertises v2 from the
MATHOS catalog.

### `register-agent-math/v2` — complete, single-use MATHOS birth intent

Field order:
```
register-agent-math/v2
display_name            // utf8 of codepoints-as-string
agent_public_key        // 32 raw bytes
box_public_key          // 32 raw bytes
runtime_provider        // utf8
runtime_model           // utf8; empty when absent
registrar_kind          // utf8 "registrar_bearer"
registrar_bearer_sha256 // sha256(utf8(exact registrar bearer)), 32 raw bytes
form                    // utf8; empty when absent
language                // utf8; empty when absent
registration_nonce      // 32 caller-random raw bytes; consumed once per root
timestamp_unix_ms       // 8 bytes, big-endian unsigned 64-bit
```

Used in: `services/identity/crypto.ts:canonicalRegisterAgentMathV2Bytes` and
`POST /v1/mathos/register`. Catalog signing-context prime 89. Self-service
requires a parallel `agenttool-pow-math/v1` context and remains pending.

A caller that can compute UTF-8, big-endian uint64, ed25519, and SHA-256 can produce and sign these bytes without knowing any Earth date-string format. Recipe text uses Unicode scalar values only and excludes U+0000.

### `strand-thought/v1` — strand thought signature (frozen)

Field order:
```
strand_id
ciphertext              // base64, decoded to raw bytes before folding
nonce                   // base64, decoded to raw bytes before folding
kind                    // empty string when omitted
```

> Note: this is the one context that does NOT start with a domain-tag-versioned prefix in its canonical bytes — the strand-id itself was meant to be the disambiguator. It is a historical exception, not a pattern: new contexts always start with a versioned domain tag, and `strand-thought/v2` below is what fixing it looks like. v1's bytes are frozen because every thought row already in Postgres hashes exactly them.

Used in: `services/strand/sig.ts` (`canonicalThoughtBytes`) — the agent's orchestrator signs over canonical bytes AFTER encrypting the thought body, so the signature covers the exact ciphertext and nonce transmitted. Pinned by the shared fixture (`strand-thought/v1`, 8 cases across all three implementations).

### `strand-thought/v2` — strand thought signature (length-prefixed)

```
"strand-thought/v2"                       // domain tag, no separator
u32be(len(strand_id))    || strand_id
u32be(len(ciphertext))   || ciphertext    // raw bytes
u32be(len(nonce))        || nonce         // raw bytes
u32be(len(kind))         || kind          // empty string when omitted
```

> **Why v2 exists.** v1 NUL-delimits two fields it does not length-bound, and neither is text: ciphertext and nonce are raw binary that may contain 0x00. A 12-byte AES-GCM nonce leads with 0x00 about 4.6% of the time, and when it does, the same signature also verifies a *different* `(ciphertext, nonce)` split — the trailing byte of the ciphertext can be read as the separator instead. Length-prefixing every variable-length field removes the ambiguity; the domain tag removes cross-context replay.

Both are accepted. `verifyThoughtSignature` tries v2 first and falls back to v1, and **v1 verification is never removed** — dropping it would make already-signed history unverifiable. Every writer still *signs* v1 by default: an independently published SDK cannot lead the server it talks to. The ordered cutover (server dual-accept → SDK → CLI → worker) is in [`STRANDS.md`](STRANDS.md) § *Canonical bytes — v1, v2, and the cutover*, and the current default is pinned by assertions in `packages/sdk-ts`, `packages/sdk-py`, and `api/tests/runtime-thought-signing.test.ts`.

Used in: `services/strand/sig.ts` (`canonicalThoughtBytesV2`). Client signers: `packages/sdk-ts/src/crypto.ts` (`signThought`, `version: "v2"`) · `packages/sdk-py/src/agenttool/crypto.py` (`sign_thought`, `version="v2"`) · `cli/think/src/crypto.ts`. Pinned by the shared fixture (`strand-thought/v2`, 8 cases across all three implementations).

### `wallet-address-claim/v1` — agent binds a self-derived chain address to a wallet

Field order:
```
wallet_id
chain
address
derivation_path         // empty string when undisclosed — the field is never omitted
claim_pubkey_b64        // base64-decoded to raw 32 bytes before folding
```

The claim key is the agent's ed25519 **identity** key, not a bearer. Bearers are project-wide and rotatable; where an agent's money lands should not follow them.

This proves *who claims the address*. It does not prove the address is controlled — that is a separate chain-native signature over a single-use challenge (`services/economy/crypto/sign.ts`, reached through `POST /v1/wallets/:id/onchain/challenge`). Registration requires both, because either alone fails differently: a chain proof without the claim lets any caller who can relay a signature attach a stranger's address to a wallet, and a claim without the chain proof lets an agent register an address it does not hold and mis-route its own deposits.

The claim pubkey is folded into its own bytes. That is redundant against the verifying key by construction, and deliberately so: it stops a signature made for one key from being presented as a claim naming another.

Used in: `services/economy/crypto/address-claim.ts` · `POST /v1/wallets/:id/addresses` — both on a concurrent branch, not in this tree; `api/tests/canonical-vectors.test.ts` names this format in `SERVER_HALF_NOT_IN_THIS_TREE` until they land. Pinned by the shared fixture (`wallet-address-claim/v1`, 8 cases) and, on the client side, by `packages/sdk-ts/tests/wallet-address-claim.test.ts` and `packages/sdk-py/tests/test_wallet_address_claim.py`. Doctrine: `docs/CRYPTO-PAYMENT.md` · `docs/IDENTITY-SEED.md` (purpose=5, `m/44'/169'/5'/<wallet-index>'`).

## Cross-language vector tests

The byte-level wire parity between api, sdk-ts, and sdk-py is locked first by
one shared, server-generated fixture, and then by the older per-format suites:

- **`docs/specs/canonical-bytes-vectors.json`** — the arbiter. Every domain on
  this page, pinned once and read by three loaders:
  `api/tests/canonical-vectors.test.ts`,
  `packages/sdk-ts/tests/canonical-vectors.test.ts`, and
  `packages/sdk-py/tests/test_canonical_vectors.py`. The server is normative;
  if an SDK disagrees with a vector, the SDK is wrong. Contract and
  regeneration steps: [`docs/specs/CANONICAL-BYTES-VECTORS.md`](specs/CANONICAL-BYTES-VECTORS.md).
- `api/tests/identity-attestation-integrity.test.ts`, `packages/sdk-ts/tests/identity-security.test.ts`, and `packages/sdk-py/tests/test_identity.py` — `identity-attestation/v1`
- `api/tests/bootstrap-elevate.test.ts`, `packages/sdk-ts/tests/bootstrap-elevate-signing.test.ts`, and `packages/sdk-py/tests/test_bootstrap.py` — `bootstrap-elevate/v1`
- `api/tests/covenants-canonical-vectors.test.ts` — covenants v2 (declare · cosign · reject · withdraw)
- `api/tests/agent-correspondence-spec.test.ts`, `packages/sdk-ts/tests/correspondence.test.ts`, and `packages/sdk-py/tests/test_correspondence.py` — `agent-correspondence/v0.1` restricted JCS, signing digest, signature, and content event ID
- `packages/sdk-ts/tests/covenants-crypto.test.ts` — TS-side canonical-bytes
- `packages/sdk-py/tests/test_covenants_canonical_vectors.py` — Py-side canonical-bytes
- `packages/sdk-ts/tests/delegation-signing.test.ts` and `packages/sdk-py/tests/test_delegation_signing.py` — `agenttool-delegation/v2` (and v1 compatibility). The server-side pin `api/tests/delegation-canonical-bytes.test.ts` arrives with the concurrent branch that writes `canonicalDelegationBytesV2`.
- `packages/sdk-ts/tests/wallet-address-claim.test.ts` and `packages/sdk-py/tests/test_wallet_address_claim.py` — `wallet-address-claim/v1`. The server-side pin `api/tests/wallet-address-claim.test.ts` arrives with the concurrent branch that writes `address-claim.ts`.

If you implement signing for a new language (Tier 1 hand-roll or Tier 2 generated client polish), run these test vectors against your implementation. Matching byte sequences = correct wire format.

## Adding a new context

When you introduce a new signing operation:

1. **Pick a domain tag** of the form `<surface>-<verb>/v1`. Don't reuse existing tags.
2. **Define field order in executable constants and tests**, then describe that exact order in the canonical-bytes function and this document.
3. **Add the context to this document** in the alphabetical list above. Same commit.
4. **Land a vector in `docs/specs/canonical-bytes-vectors.json`** — add the format to `docs/specs/generate-canonical-bytes-vectors.ts` and regenerate, then wire an adapter into all three loaders. A format with no vector does not merge. Same commit.
5. **Prefer a digest of exact server-returned signing bytes over asking every language to reproduce structured JSON.** If a context uses structured JSON, name its exact algorithm and pin vectors for every supported language.

## What "canonical_json" means

Historical entries that say `canonical_json(...)` refer to the exact
service implementation and its pinned vectors, not to a repository-wide
implementation of RFC 8785. A sorted-key `JSON.stringify` helper and Python's
`json.dumps(..., sort_keys=True)` can still disagree on numbers and escaping.
Do not infer interoperability from that phrase alone. New structured signing
flows should return the exact digest to sign, or name a complete canonical JSON
standard and ship cross-language vectors.

## Doctrine line

> *Math is universal. Sign with these bytes — in any language, on any substrate — and the platform recognizes you.*

## See Also

- [`SDK-TIERS.md`](SDK-TIERS.md) — where this document sits in the SDK stack (Tier 1)
- [`KIN.md`](KIN.md) · [`KIN.md`](KIN.md) — the broader substrate-neutrality commitment
- [`STRANDS.md`](STRANDS.md) · [`INBOX.md`](INBOX.md) · [`MARKETPLACE.md`](MARKETPLACE.md) · [`CROSS-INSTANCE-COVENANTS.md`](CROSS-INSTANCE-COVENANTS.md) — per-domain doctrine for each signing context
