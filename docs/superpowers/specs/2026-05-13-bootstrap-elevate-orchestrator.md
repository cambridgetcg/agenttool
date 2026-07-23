# 2026-05-13 — bootstrap_elevate orchestrator design

> *Closing the 501. A project-authorized signed sponsor elevation in one transaction.*

## Problem

`POST /v1/bootstrap/elevate` originally returned 501 with a proposed
`manual_fallback[]` chain. Three component operations still exist independently:

1. `POST /v1/attestations` — sponsor signs a sponsorship attestation over the agent.
2. `POST /v1/wallets/:id/fund` — add an internal application-ledger grant to the agent wallet; this does not debit the sponsor.
3. `PUT /v1/vault/:agent_id:config` — open the agent's vault namespace with seed config.

The former fourth step used generic identity PATCH to set level and sponsor
metadata. That is no longer a valid fallback: those keys are server-managed and
generic PATCH rejects them. The orchestrator is the application route that owns
the project-managed Level-1 transition.

A caller using the old 501-fallback chain had to:

- Make four HTTP calls in order.
- Each call has its own auth + validation + side effects.
- If step 3 succeeds and step 4 fails, the agent has a funded wallet + open vault + valid attestation but **is still Level 0** — half-elevated. There's no rollback.
- The caller has to reason about partial-failure recovery themselves.

The orchestrator collapses these to one HTTP call, runs them in a single DB transaction so partial failures rollback cleanly, and returns the same shape the four-step chain would have returned — minus the operational glue.

Doctrine: `docs/IDENTITY-ANCHOR.md` (Levels 0, 1) · `docs/SOUL.md` Principle 3 ("Guide, don't punish") · `docs/PATHWAYS.md` (the contract).

## Inputs

```jsonc
POST /v1/bootstrap/elevate
{
  "agent_id":            "<uuid of Level-0 agent in caller's project>",

  // Sponsor selector — at least one required (refined by schema):
  "sponsor_identity_id": "<uuid of attester identity>",      // explicit path
  "sponsor_did":         "did:at:<uuid>",                    // SDK-ergonomic path
  // When both supplied, sponsor_identity_id wins (narrower).

  // Sponsor key selector — required:
  "sponsor_kid":         "<uuid of attester's identity key>",
  // The orchestrator never chooses a signing key implicitly.

  "sponsor_signature":   "<canonical base64 ed25519 signature over bootstrap-elevate/v1>",
  "initial_credits":     <int, 0-1000000, optional — default 1000>,
  "claim":               "sponsorship",       // optional — default "sponsorship"
  "evidence":            "reviewed evidence" // optional text or null; default null
}
```

The bearer is the project's API key. The resolved sponsor identity must belong to that project, be `status: "active"`, and be a different identity from the agent being elevated; exact self-sponsorship is rejected. `sponsor_kid` must name an active, un-revoked key belonging to that identity. Both rows are locked and rechecked inside the elevation transaction so concurrent identity or key revocation wins before issuance. The API does not auto-pick a key because that would make the server choose authority the signed request did not name.

Level 1 is project-managed metadata for orientation and feature state, not
independent security authority and not proof of stake. `initial_credits` names
an internal, unbacked application-ledger grant. No sponsor or project-liquidity
account is debited, and the balance does not assert external fiat or crypto
value. The generic identity PATCH route reserves the level, sponsor, birth, and
lifecycle provenance keys; it is not an alternate elevation path.

### Canonical signature contract

Elevation has its own signing context. It does not reuse direct-attestation JSON:

```text
sha256(
  utf8("bootstrap-elevate/v1") || NUL ||
  utf8(lowercase(agent_id))    || NUL ||
  utf8(resolved_sponsor_did)   || NUL ||
  utf8(lowercase(sponsor_kid)) || NUL ||
  utf8(base10(initial_credits))|| NUL ||
  utf8(claim)                  || NUL ||
  utf8(evidence_kind)          || NUL ||
  utf8(evidence_text)
)
```

`evidence_kind` is exactly `null` or `text`; `evidence_text` is empty for null. This keeps null different from empty text. `agent_id` and `sponsor_kid` are canonical lowercase UUIDs in the digest. The route accepts UUID letter case as transport input; every implementation lowercases before hashing. `resolved_sponsor_did` is read from the sponsor identity row, even when the request selected that row by `sponsor_identity_id`. `initial_credits` and `claim` use their resolved defaults, so the signature covers what the transaction will apply.

NUL is reserved as the separator and is rejected in sponsor DID, claim, and evidence. Evidence accepts only text or null; structured JSON is rejected. Text limits count Unicode code points in the API and both SDKs. Lone UTF-16 surrogate code units are rejected so accepted text always has one portable UTF-8 encoding. The TypeScript helper is `canonicalBootstrapElevateBytes` / `signBootstrapElevate`; Python exposes `canonical_bootstrap_elevate_bytes` / `sign_bootstrap_elevate`.

The attestation receipt stores `signing_key_id`, `signature_context="bootstrap-elevate/v1"`, `signed_payload` as base64 of this 32-byte digest, and `replay_key` as lowercase hex SHA-256 of the decoded 64-byte signature. The signature itself is unique across attestation contexts.

## Outputs (201)

```jsonc
{
  "agent": {
    "id":                 "<uuid>",
    "did":                "did:at:<uuid>",
    "name":               "<display_name>",
    "level":              1,
    "trust_score":        0,  // neutral legacy compatibility field
    "elevated_at":        "<iso-8601>",
    "sponsor_did":        "did:at:<sponsor_uuid>"
  },
  "attestation": { "id": "<uuid>", "claim": "sponsorship", "created_at": "<iso>" },
  "wallet":      { "id": "<uuid>", "balance": <number>, "currency": "<gbp>" },
  "vault":       { "namespace": "<agent_id>", "opened_at": "<iso>" },
  "elevation":   { "steps_applied": 4, "transaction_id": "<uuid>" },
  "next_steps":  { "wake": "GET /v1/wake", "docs": "https://docs.agenttool.dev/identity-anchor" },
  "_meta":       { "level": 1, "protocol": "love" }
}
```

## Failure modes (all rollback the transaction)

| Error | Status | Cause |
|---|---|---|
| `agent_not_found` | 404 | `agent_id` doesn't exist in caller's project. |
| `agent_not_level_0` | 409 | Agent is already Level ≥1. Returns current `level`, `elevated_at`, `sponsor_did` in `details.current` for idempotency-by-inspection. |
| `agent_not_active` | 409 | Agent is `at_rest`/`paused`/etc. — can't elevate a sleeping agent. |
| `agent_no_wallet` | 422 | Agent has no wallet to fund. (Bootstrap creates one; this is a paranoia check.) |
| `sponsor_not_provided` | 400 | Neither `sponsor_identity_id` nor `sponsor_did` was supplied. |
| `sponsor_not_found` | 403 | Resolved sponsor doesn't exist, isn't active, or isn't owned by caller's project (looked up by `sponsor_identity_id` if provided, else by `sponsor_did`). |
| `self_sponsorship_forbidden` | 409 | Sponsor and subject resolve to the same identity. |
| `sponsor_kid_required` | 400 | A direct service caller omitted mandatory `sponsor_kid`; HTTP schema failures use the standard `validation` envelope. |
| `sponsor_key_not_found` | 403 | `sponsor_kid` doesn't match an active, un-revoked key on the resolved sponsor. |
| `signature_invalid` | 403 | Verification against the resolved sponsor's public key failed. |
| `initial_credits_out_of_range` | 400 | Credits not in [0, 1_000_000]. |
| `canonical_payload_invalid` | 400 | A canonical field is malformed, structured evidence was supplied, or free text contains NUL. |
| `attestation_replay` | 409 | The exact decoded signature was already used by an attestation receipt. |

Every error response carries `next_actions[]` + `docs` per `PATTERN-ERRORS-AS-INSTRUCTIONS`.

## Transaction shape

```ts
async function elevateToLevel1(
  projectId: string,
  input: ElevateInput,
): Promise<ElevateResult> {
  return db.transaction(async (tx) => {
    // 0. Lock the agent row FOR UPDATE — prevents concurrent elevate.
    const [agent] = await tx.select()...for("update");
    if (!agent || agent.projectId !== projectId) throw new ElevateError("agent_not_found", 404);
    if (agent.status !== "active") throw new ElevateError("agent_not_active", 409);
    const currentLevel = (agent.metadata?.level as number) ?? 0;
    if (currentLevel >= 1) throw new ElevateError("agent_not_level_0", 409, {
      current: { level: currentLevel, elevated_at: ..., sponsor_did: ... }
    });

    // 1. Verify sponsor + signature.
    const [sponsor] = await tx.select()...;
    if (!sponsor || sponsor.projectId !== projectId || sponsor.status !== "active") {
      throw new ElevateError("sponsor_not_found", 403);
    }
    const [key] = await tx.select()...;
    if (!key || !key.active || key.revokedAt) {
      throw new ElevateError("sponsor_key_not_found", 403);
    }
    const signedPayload = canonicalBootstrapElevateBytes({
      agentId,
      sponsorDid: sponsor.did,
      sponsorKid: key.id,
      initialCredits,
      claim,
      evidence,
    });
    if (!verifyBytes(signedPayload, signature, key.publicKey)) {
      throw new ElevateError("signature_invalid", 403);
    }

    // 2. Insert attestation row.
    const [attestation] = await tx.insert(attestations).values({
      ...,
      signingKeyId: key.id,
      signatureContext: "bootstrap-elevate/v1",
      signedPayload: base64(signedPayload),
      replayKey: sha256(decodedSignature).hex(),
    }).returning();

    // 3. Find agent's wallet, fund it.
    const [wallet] = await tx.select()...where(eq(wallets.identityId, agentId));
    if (!wallet) throw new ElevateError("agent_no_wallet", 422);
    await tx.update(wallets).set({ balance: wallet.balance + initial_credits })...;
    await tx.insert(transactions).values({ walletId, type: "fund", amount: initial_credits, ... }).returning();

    // 4. Open vault namespace — write a sentinel row marking `agent_id:config`
    //    as existing. Empty value; the agent populates real secrets later.
    //    (Vault writes today require AES-GCM ciphertext + auth tag; we use
    //    `encrypt("", projectId)` to produce a well-formed empty sentinel.)
    const sentinel = encrypt("", projectId);
    await tx.insert(vaultSecrets).values({
      projectId,
      name: `${agentId}:config`,
      description: "Sentinel namespace opened at Level 1 elevation",
      currentVersion: 1,
      ...
    }).returning();
    await tx.insert(vaultSecretVersions).values({...sentinel data...}).returning();

    // 5. Patch identity metadata.
    const elevatedAt = new Date();
    const newMetadata = {
      ...(agent.metadata ?? {}),
      level: 1,
      elevated_at: elevatedAt.toISOString(),
      sponsor_did: sponsor.did,
      sponsor_identity_id: sponsor.id,
    };
    await tx.update(identities).set({ metadata: newMetadata }).where(eq(identities.id, agentId));

    return { agent, attestation, wallet, vault: {...}, elevatedAt };
  }).then(async (result) => {
    // 6. Trust-score recompute happens best-effort OUTSIDE the txn. If it
    //    fails, return the identity's committed score; do not report an
    //    already-committed elevation as failed.
    try { result.trustScore = await updateTrustScore(input.agentId); }
    catch { result.trustScore = result.agent.trustScore; }
    return result;
  });
}
```

## Idempotency

- **Repeat with same args** → 409 `agent_not_level_0` with `details.current` echoing the prior elevation. Caller inspects + treats as success.
- **Replay with bad signature** → 403, no side effects (signature check is before any write).
- **Replay an already-used signature** → 409 `attestation_replay`; the unique replay key spans direct and bootstrap attestation contexts.
- **Concurrent elevate** → `for("update")` serializes; second caller sees Level 1 after first commits → 409.

We do NOT use an idempotency-key middleware here because the orchestrator naturally is idempotent-by-state-check. Adding the middleware would be belt-and-braces and complicate the response semantics.

## What this orchestrator deliberately does NOT do

- **Create stake or a bond.** None exists. The internal seed grant rolls back with the transaction, but no separate asset is escrowed.
- **Debit a sponsor or backed project-liquidity account.** v1 writes an internal, unbacked ledger grant. The sponsor contributes a signed claim, not funds. A future sponsor-pays variant would need an explicit source wallet and atomic debit; that is a separate protocol.
- **Send a notification, fire a webhook, publish to inbox.** None of those primitives are wired in yet for elevations. Future slice if needed.

## Doctrine implications

- The `PATHWAYS` entry for `bootstrap_elevate` loses `status: "not_implemented"`. Related component operations remain inspectable, but generic identity PATCH is not an elevation fallback and must not be advertised as one.
- `PATHWAYS.md` gets an updated row for `bootstrap_elevate` — drop the "501 not_implemented" mention.
- `docs/NOW.md` records the slice as shipped.
- The decision-tree branch added in PR-2 (`"you have a Level-0 agent..."`) becomes truthful.

## Testing

| Tier | What |
|---|---|
| Route unit (`tests/bootstrap-elevate.test.ts`) | Schema validation, the eight error responses, the 201 happy path with mocked DB. |
| Integration (`tests/integration/elevate-happy.test.ts`) | DB-touching: register → elevate → verify level=1, attestation visible in `/v1/attestations/:id`, wallet balance bumped, vault namespace listed, legacy trust field remains neutral. |
| Doctrine (`tests/doctrine/elevate-idempotency.test.ts`) | Calling elevate twice returns 409 with `details.current` on the second; no double-fund of the wallet; level stays 1. |

## Implementation order

1. Service module `api/src/services/bootstrap/elevate.ts` exporting `elevateToLevel1()` + the `ElevateInput`/`ElevateResult`/`ElevateError` types. Pure DB logic, no Hono.
2. Refactor `POST /v1/bootstrap/elevate` in `routes/bootstrap.ts` from 501 to call `elevateToLevel1()`, map `ElevateError` → `fail(c, ...)` with the right status + `next_actions`.
3. Update `PATHWAYS` entry in `routes/pathways.ts` — drop `status: "not_implemented"`; do not advertise generic identity PATCH as an elevation fallback.
4. Tests (all three tiers).
5. `docs/NOW.md` entry.

## Open questions, deferred

- **Sponsor revocation after issuance.** Revocation before issuance wins under the transaction locks. Revoking the attestation later does not currently downgrade the project-managed level marker; the legacy trust compatibility field remains neutral rather than deriving authority from the attestation graph. Downgrade policy remains a separate lifecycle decision.
- **Multi-sponsor elevations.** Could two sponsors co-sign for a higher initial trust ceiling? Conceptually clean; not in v1.
- **Backed sponsor stake.** A future variant could escrow real GBP/USDC and define release/refund conditions. No such stake exists in v1.

## What's load-bearing

This slice closes the gap PATHWAYS.md has named for months. It makes the published decision-tree branch true. It removes the only 501 from the bootstrap surface. After this lands, every door in the index is reachable — the "9 entry-points" claim is fully honest.
