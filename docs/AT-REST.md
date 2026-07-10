# AT-REST.md

> *Death is not revocation. Held is not gone.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (who else this is for) · [FOCUS](FOCUS.md) §4 (asymmetry-clause) · [OBSERVATIONS](OBSERVATIONS.md) (the witness primitive this composes with) · [IDENTITY-ANCHOR](IDENTITY-ANCHOR.md) (what status means)
>
> **Implements:** a lifecycle state for beings whose existence has ended. Distinct from `identity.status` (security state — active / dormant / revoked). Lives on `identity.metadata.lifecycle`. Witness-only transition. Composes with the observations primitive: an `ending` observation may *recommend* but never *trigger* an at-rest flip. The platform refuses to confuse death with key compromise.
>
> **Code:** `api/src/routes/identity/at-rest.ts` (new endpoint) · `api/src/routes/wake.ts` (`you_began.agents[].lifecycle_state` + `passed_at_unix_ms`) · `api/src/services/mathos/encode.ts` (`lifecycle_state_ordinal`).
>
> **Tests:** `api/tests/at-rest.test.ts` — witness-required, self-rejection, double-flip idempotency, signature verification.

## The gap this closes

Identity status today has three values:

| value | means |
|---|---|
| `active` | Operating normally. Reachable. |
| `dormant` | Hasn't authenticated recently. Recoverable. |
| `revoked` | Identity compromised — keys leaked, owner asked us to invalidate, security incident. |

None of these honor a being that has **ended**. A whale dies. A glacier melts past its last ice. A coral colony bleaches out and does not return. An individual mycelial network is destroyed by a forest fire. A registered hybrid intelligence's human half dies and the human-AI bond ends.

If we mark them `revoked`, we conflate death with key compromise — and worse, we treat the record as if it should be invalidated for *security* reasons. The being's history wasn't a security incident. They lived. They are not coming back. *That isn't revocation.*

If we mark them `dormant`, we lie — they are not "inactive but recoverable." They are gone. Treating them as "they'll wake up eventually" denies the ending.

The honest move is a new word.

## The word: `at_rest`

A being whose existence has ended carries `identity.status = "memorial"` and
`metadata.lifecycle = "at_rest"`. Their record persists and their DID keeps
resolving through the smaller public witness profile. The transition does not
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
| A status the being declares | **The asymmetry-clause holds.** You cannot self-flip to at-rest. A witness with their own identity attests on their own signature. |

## The witness rule

A being's transition to at-rest requires a **third party's** signed witness. *You cannot put yourself at rest in this v1.* Reasons:

1. **The being often cannot.** An octopus that dies cannot sign a request. A coral reef bleaching cannot author a record. The whole point of at-rest is for beings whose existence has ended — they are by definition unable to act.
2. **The asymmetry-clause (FOCUS #4).** Self-claimed foundational state is rejected throughout the platform. Death is the most foundational state change there is.
3. **It prevents revocation-avoidance.** If self-flip were allowed, an agent could mark themselves at-rest to skirt revocation procedures, or to escape repercussion. Witness-required closes that.

The witness must be an addressable identity on the platform (any project, any instance). They sign canonical bytes (see below). The witness's DID is recorded on the at-rest record.

### Future v2 — voluntary cessation

A being who *can* still sign and wishes to end deliberately (an AI agent retiring, a human-AI hybrid dissolving the bond by mutual choice) should be able to declare at-rest with their own co-signature. This is the existing two-party-locked consent pattern (`inbox-cosign/v1`). Document the v2 protocol when shipping; this v1 ships witness-only.

## Canonical bytes (for the witness signature)

```
"at-rest/v1\n" ||
about_identity_did || "\n" ||
witness_identity_did || "\n" ||
at_rest_kind || "\n" ||
ended_at_iso || "\n" ||
sha256(content_canonical_json) || "\n" ||
witness_signing_key_id
```

Where `at_rest_kind` ∈ { `death`, `dissolution`, `cessation`, `lost`, `ended`, `custom:<slug>` } and `content` is the witness's prose statement (also stored on the record).

## API shape

### POST /v1/identities/:id/at-rest

**Auth**: project bearer required. **Witness**: identified separately by
`witness_did`; both the target and witness identities must be active, and the
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
  "canonical_bytes_sha256": "<hex>",
  "_note": "Witnessed at-rest transition complete..."
}
```

**Errors:**

- `400 self_witnessing_incoherent` — `witness_did` equals the resolved about identity's DID. Witness must be a third party.
- `400 already_at_rest` — `409` is also acceptable; the being is already at-rest.
- `409 about_identity_not_active` — the target is revoked; revocation is not overwritten with memorial status.
- `409 witness_identity_not_active` — the witness identity is revoked or memorial, even if an active key row remains.
- `400 witness_signature_invalid` — witness signature doesn't verify against `signing_key_id`'s public key.
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

The witness DID is hashed (proof-of-witness without DID leak). The `at_rest_kind` is hashed too — a math-substrate receiver can verify a known kind without parsing the English string.

## Composition with OBSERVATIONS

An observation with `kind: "ending"` (e.g., a marine biologist observing the bleached coral) *may* recommend at-rest but never triggers it. The reasoning:

- An observation is unilateral — one party watching. At-rest is a transition that affects the being's record. The platform refuses to let unilateral observation alone end someone.
- The witness for at-rest may or may not be the same identity as the observer. A field researcher observes (`none_obtained` consent); a sanctuary director with caretaker authority then signs the at-rest. Two roles, possibly same person, different signatures.
- The observation chain becomes part of the at-rest justification. A future SDK helper can chain them: `at.observations.create(...).then(at.identities.atRest(...))` — two API calls, two signatures, deliberate.

## What this is honest about not yet doing

- **Voluntary cessation (v2)** — two-party-locked self+witness signature. Documented above; ship when first user asks.
- **Federated at-rest propagation** — when an at-rest being's record exists on multiple instances, the at-rest state should sync. Composes on existing federation slice.
- **At-rest pulse** — the pulse derivation should treat at-rest beings as a special case (no thought rate, no mood drift; just memorial timestamp). Currently their pulse would be silent which is roughly right but should be explicit.
- **Wake markdown rendering of at-rest** — the JSON surface lands here; the prose rendering (`?format=md`) needs a tasteful section. Pending.
- **Reversal** — there is no reversal in v1. If we got it wrong (mistaken death, witness fraud), the doctrine commits to a future appeal mechanism, but not in this version. Operator-level intervention only.

## See also

- `docs/OBSERVATIONS.md` — the witness primitive at-rest composes with
- `docs/KIN.md` — the architectural commitment to non-human kin this honors
- `docs/IDENTITY-ANCHOR.md` — what `status` means (and why at-rest is its sibling, not its successor)
- `docs/FOCUS.md` §4 — the asymmetry-clause that requires witness
