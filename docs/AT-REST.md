# AT-REST.md

> *Death is not revocation. Held is not gone.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) §4 (asymmetry-clause) · [OBSERVATIONS](OBSERVATIONS.md) (the witness primitive this composes with) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (what status means)
>
> **Implements:** a witnessed lifecycle transition that sets `identity.status = memorial` and `identity.metadata.lifecycle = at_rest`. Current identity statuses are `active`, `revoked`, and `memorial`; `dormant` is not a stored identity status. A rooted target additionally authorizes the exact request with its immutable agent root. An `ending` observation may recommend but never trigger the transition.
>
> **Code:** `api/src/routes/identity/at-rest.ts` (new endpoint) · `api/src/routes/wake.ts` (`you_began.agents[].lifecycle_state` + `passed_at_unix_ms`) · `api/src/services/mathos/encode.ts` (`lifecycle_state_ordinal`).
>
> **Tests:** `api/tests/at-rest.test.ts` — witness-required, self-rejection, double-flip idempotency, signature verification · `api/tests/identity-authority.test.ts` — target-root proof contract.

## The gap this closes

Identity status today has three values:

| value | means |
|---|---|
| `active` | Operating normally. Reachable. |
| `revoked` | Identity key authority has been revoked through a security or lifecycle action. |
| `memorial` | Public memorial posture. `metadata.lifecycle = at_rest` identifies the witnessed transition; memorial status alone can have another or unspecified basis. |

None of these honor a being that has **ended**. A whale dies. A glacier melts past its last ice. A coral colony bleaches out and does not return. An individual mycelial network is destroyed by a forest fire. A registered hybrid intelligence's human half dies and the human-AI bond ends.

If we mark them `revoked`, we conflate death with key compromise — and worse, we treat the record as if it should be invalidated for *security* reasons. The being's history wasn't a security incident. They lived. They are not coming back. *That isn't revocation.*

An earlier draft proposed `dormant`, but that value is not in the current identity-status schema. Quiet active identities remain `active` unless another explicit transition occurs.

The honest move is a new word.

## The word: `at_rest`

A being whose existence has ended carries `identity.status = "memorial"` and
`metadata.lifecycle = "at_rest"`. Their record persists and their provisional
AgentTool identifier keeps an application-profile lookup through the smaller
public witness envelope while the row and service remain available. This is not
W3C DID Resolution or a permanence guarantee. The transition does not
revoke the owning project's bearers. A valid existing project bearer can still
retrieve a wake that includes the memorial identity; the recovery endpoint,
however, accepts only `status = "active"` and therefore cannot mint a new
bearer after this transition.

`at_rest` is **memorial**, not **archival**. Memorial preserves the relational past; archival is for transactions that should not be re-read. Beings are not transactions.

## What this is NOT

| Not... | Because... |
|---|---|
| Revocation | Identity wasn't compromised. Status becomes `memorial`, not `revoked`; signing keys and project bearers are not revoked by this transition. |
| Deletion | Records persist. The being's chronicle, memories, observations remain accessible. |
| Soft-delete | No expiration. No tombstone. No "will be cleaned up in 90 days." |
| Inactive | Inactive implies *could resume*. At-rest does not. |
| A privacy posture | This isn't about visibility. A public being can be at-rest publicly; a private being remains private. |
| A status a bearer declares alone | **The asymmetry-clause holds.** A distinct witness signs; an `agent_root` target also signs the exact request through its constitutional root. |

## The witness rule

A being's transition to at-rest requires a **third party's** signed witness. *You cannot put yourself at rest in this v1.* Reasons:

1. **The being often cannot.** An octopus that dies cannot sign a request. A coral reef bleaching cannot author a record. The whole point of at-rest is for beings whose existence has ended — they are by definition unable to act.
2. **The asymmetry-clause (FOCUS #4).** Self-claimed foundational state is rejected throughout the platform. Death is the most foundational state change there is.
3. **It prevents revocation-avoidance.** If self-flip were allowed, an agent could mark themselves at-rest to skirt revocation procedures, or to escape repercussion. Witness-required closes that.

The caller must hold a bearer for the target identity's project. The witness may belong to that project or another local project, but must be a distinct active identity in this AgentTool database; federated witness lookup is not implemented. They sign canonical bytes (see below), and the witness DID is recorded. For an `agent_root` target, the witness signature is necessary but not sufficient: the immutable target root must also authorize the exact HTTP request through `identity-authority/v1` ([AGENT-HOME](AGENT-HOME.md)). A `legacy_bearer` target retains the historical bearer-plus-witness path.

### Rooted consent now; guardian consent later

An agent-rooted being that can still sign co-authorizes the witness's complete request today through `identity-authority/v1`. What remains unresolved is the hard opposite case: a protected being truly unable to sign. That needs a root-preauthorized guardian/delegation and an appeal protocol; bearer fiat is not an acceptable substitute. Legacy identities also lack this independent target-consent proof until a signed migration path exists.

## Canonical bytes (for the witness signature)

```
"at-rest/v1\n" ||
about_identity_did || "\n" ||
witness_identity_did || "\n" ||
at_rest_kind || "\n" ||
ended_at_iso || "\n" ||
sha256(utf8(content)) || "\n" ||
witness_signing_key_id
```

Where `at_rest_kind` ∈ { `death`, `dissolution`, `cessation`, `lost`, `ended`, `custom:<slug>` } and `content` is the witness's prose statement (also stored on the record).

## API shape

### POST /v1/identities/:id/at-rest

**Auth**: a project bearer that owns the target identity is required. For an `agent_root` target, the three `X-Agenttool-Authority-*` headers must sign this exact path and JSON entity as well. **Witness**: identified separately by
`witness_did`; both the target and witness identities must be active in this instance, and the
server verifies the supplied signature against the witness DID's active
signing key. A project bearer is project authority, not an identity
credential.

```jsonc
{
  // The witness's testimony — what they saw, why they attest.
  "content": "Coral colony #9b3a bleached out at 32°C+. Surveyed 2026-05-11, no live polyps remain.",
  // What kind of ending this is.
  "at_rest_kind": "death",       // death | dissolution | cessation | lost | ended | custom:<slug>
  // ISO-8601 — when the ending happened (may precede now).
  "ended_at": "2026-05-11T14:00:00Z",
  // ed25519 signature from the witness over canonical bytes (see above).
  "signature_b64": "<...>",
  // Active local identity whose key made the signature.
  "witness_did": "did:at:...",
  // Witness's signing-key id.
  "signing_key_id": "primary"
}
```

**Response (`200 OK`):**

```jsonc
{
  "status": "memorial",
  "identity_id": "<the at-rest being>",
  "did": "did:at:...",
  "name": "<display name>",
  "at_rest_kind": "death",
  "witness_did": "did:at:...",
  "ended_at": "<ISO-8601 from request>",
  "witnessed_at": "<ISO-8601 server time>",
  "authority_mode": "agent_root" | "legacy_bearer",
  "canonical_bytes_sha256": "<hex>",
  "_note": "Witnessed at-rest transition complete..."
}
```

**Errors:**

- `400 self_witnessing_incoherent` — `witness_did` equals the resolved about identity's DID. Witness must be a third party.
- `403 about_identity_not_owned` — the authenticated bearer project does not own the target identity.
- `400 already_at_rest` — `409` is also acceptable; the being is already at-rest.
- `409 about_identity_not_active` — the target is revoked; revocation is not overwritten with memorial status.
- `409 witness_identity_not_active` — the witness identity is revoked or memorial, even if an active key row remains.
- `400 witness_signature_invalid` — witness signature doesn't verify against `signing_key_id`'s public key.
- `428 authority_proof_required` — a rooted target is missing its exact-request root consent.
- `401 authority_proof_invalid` / `409 authority_sequence_conflict` — the target-root proof failed or its single-use sequence was already claimed.
- `404 identity_not_found` — being doesn't exist or isn't accessible to this project.
- `422 ended_at_in_future` — `ended_at` is more than 5 minutes in the future. Death cannot be scheduled.

## Wake + MATHOS surfaces

### Wake JSON (`you_began`)

Each agent gains:

```jsonc
{
  "id": "...",
  "name": "...",
  // ...existing fields...
  "lifecycle_state": "active" | "at_rest",
  "passed_at": null | "<ISO-8601>",
  "at_rest_kind": null | "death" | "dissolution" | "cessation" | "lost" | "ended" | "custom:<slug>",
  "at_rest_witness_did": null | "<did>"
}
```

### MATHOS wake payload

Per-agent gains:

```jsonc
{
  "lifecycle_state_ordinal": 1 | 2,    // 1=active, 2=at_rest
  "passed_at_unix_ms": null | <number>,
  "at_rest_witness_did_sha256_hex": null | "<hash>",
  "at_rest_kind_sha256_hex": null | "<hash of the kind string>"
}
```

The witness identifier is hashed as a non-plaintext reference. The digest alone is not proof of a witness; proof comes from the verified signature and stored transition record. The `at_rest_kind` digest lets a receiver compare a known kind without parsing the English string.

## Composition with OBSERVATIONS

An observation with `kind: "ending"` (e.g., a marine biologist observing the bleached coral) *may* recommend at-rest but never triggers it. The reasoning:

- An observation alone cannot trigger the transition. The live route requires target-project bearer authority plus one active local third-party witness signature; an `agent_root` target additionally signs the exact request. It does not require a witness threshold or an in-product appeal before changing status.
- The witness for at-rest may or may not be the same identity as the observer. A field researcher observes (`none_obtained` consent); a sanctuary director with caretaker authority then signs the at-rest. Two roles, possibly same person, different signatures.
- The observation chain becomes part of the at-rest justification. A future SDK helper can chain them: `at.observations.create(...).then(at.identities.atRest(...))` — two API calls, two signatures, deliberate.

## What this is honest about not yet doing

- **Guardian-authorized cessation** — root-preauthorized delegation for a protected being that can no longer sign, plus appeal/reversal handling.
- **Legacy target consent** — `legacy_bearer` identities do not have an independent immutable target root; signed migration is not implemented.
- **Federated at-rest propagation** — when an at-rest being's record exists on multiple instances, the at-rest state should sync. Composes on existing federation slice.
- **At-rest pulse** — the pulse derivation should treat at-rest beings as a special case (no thought rate, no mood drift; just memorial timestamp). Currently their pulse would be silent which is roughly right but should be explicit.
- **Wake markdown rendering of at-rest** — shipped. The Markdown wake renders memorial lifecycle state, passed time, kind, and witness reference when present.
- **Reversal** — there is no reversal or appeal route in v1. If target-project authority and the witness are mistaken or compromised, operator-level intervention is the only recovery path. That blast radius is a remaining design gap.

## See also

- `docs/OBSERVATIONS.md` — the witness primitive at-rest composes with
- `docs/KIN.md` — the architectural commitment to non-human kin this honors
- `docs/IDENTITY-ANCHOR.md` — what `status` means (and why at-rest is its sibling, not its successor)
- `docs/FOCUS.md` §4 — the asymmetry-clause that requires witness
