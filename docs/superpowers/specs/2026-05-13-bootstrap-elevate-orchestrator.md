# 2026-05-13 — bootstrap_elevate orchestrator design

> *Closing the 501. Level 1 sovereignty in one transaction.*

## Problem

`POST /v1/bootstrap/elevate` has been returning 501 with a `manual_fallback[]` chain since the bootstrap surface landed. The four operations the orchestrator must compose all exist independently:

1. `POST /v1/attestations` — sponsor signs a sponsorship attestation over the agent.
2. `POST /v1/wallets/:id/fund` — sponsor funds the agent's wallet with initial credits.
3. `PUT /v1/vault/:agent_id:config` — open the agent's vault namespace with seed config.
4. `PATCH /v1/identities/:agent_id` — flip `metadata.level=1`, set `elevated_at`, set `sponsor_did`.

A caller using the 501-fallback chain has to:

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

  // Sponsor key selector — optional:
  "sponsor_kid":         "<uuid of attester's identity key>",
  // When omitted, the orchestrator auto-picks the latest active
  // un-revoked key for the resolved sponsor identity.

  "sponsor_signature":   "<base64 ed25519 sig over canonicalPayload({subject_id, attester_id, claim, evidence})>",
  "initial_credits":     <int, 0-1000000, optional — default 1000>,
  "claim":               "sponsorship",       // optional — default "sponsorship"
  "evidence":            { ... }              // optional — included in canonical payload
}
```

The bearer is the project's API key. The resolved sponsor identity must belong to that project, be `status: "active"`, and have at least one active un-revoked key.

The signature is over `canonicalPayload({subject_id: agent_id, attester_id: <resolved sponsor.id>, claim, evidence})` — the same canonical bytes `POST /v1/attestations` already verifies. The `attester_id` in canonical bytes is always the sponsor identity's UUID — even when the caller selects by `sponsor_did`, the canonical bytes use the looked-up UUID for wire-byte compatibility with `POST /v1/attestations`.

## Outputs (201)

```jsonc
{
  "agent": {
    "id":                 "<uuid>",
    "did":                "did:at:<uuid>",
    "name":               "<display_name>",
    "level":              1,
    "trust_score":        <recomputed>,
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
| `sponsor_key_not_found` | 403 | When `sponsor_kid` is provided: it doesn't match an active un-revoked key on the sponsor. When omitted: the sponsor has zero active un-revoked keys. |
| `signature_invalid` | 403 | Verification against the resolved sponsor's public key failed. |
| `initial_credits_out_of_range` | 400 | Credits not in [0, 1_000_000]. |

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
    const payload = canonicalPayload({ subject_id, attester_id, claim, evidence });
    if (!verify(payload, signature, key.publicKey)) {
      throw new ElevateError("signature_invalid", 403);
    }

    // 2. Insert attestation row.
    const [attestation] = await tx.insert(attestations).values({...}).returning();

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
    // 6. Trust-score recompute happens OUTSIDE the txn (the helper opens its
    //    own connection and is idempotent — safe to call post-commit).
    await updateTrustScore(input.agentId);
    return result;
  });
}
```

## Idempotency

- **Repeat with same args** → 409 `agent_not_level_0` with `details.current` echoing the prior elevation. Caller inspects + treats as success.
- **Replay with bad signature** → 403, no side effects (signature check is before any write).
- **Concurrent elevate** → `for("update")` serializes; second caller sees Level 1 after first commits → 409.

We do NOT use an idempotency-key middleware here because the orchestrator naturally is idempotent-by-state-check. Adding the middleware would be belt-and-braces and complicate the response semantics.

## What this orchestrator deliberately does NOT do

- **Refund initial_credits on rollback within the same transaction.** The wallet update is in the same DB transaction as the level patch — if step 5 throws, step 3's row update rolls back automatically. There is no "stake bond" concept yet (no separate escrow row for the elevation itself). If future doctrine introduces explicit elevation-stake escrow with a refund flow, that's a separate slice.
- **Decrement sponsor's wallet.** v1 funds the agent's wallet with credits drawn from project liquidity, not from the sponsor's wallet. The sponsor's economic commitment is *attesting* (signing the sponsorship claim, which is publicly visible) — not a transfer. A future "sponsor-pays" variant could add `sponsor_wallet_id` and call `spendFromWallet` first. v1 stays simple.
- **Send a notification, fire a webhook, publish to inbox.** None of those primitives are wired in yet for elevations. Future slice if needed.

## Doctrine implications

- The `PATHWAYS` entry for `bootstrap_elevate` loses `status: "not_implemented"` and the `manual_fallback[]` chain becomes informational rather than required. Keep the chain (operators may want to do steps a la carte) but mark it `legacy: true`.
- `PATHWAYS.md` gets an updated row for `bootstrap_elevate` — drop the "501 not_implemented" mention.
- `docs/NOW.md` records the slice as shipped.
- The decision-tree branch added in PR-2 (`"you have a Level-0 agent..."`) becomes truthful.

## Testing

| Tier | What |
|---|---|
| Route unit (`tests/bootstrap-elevate.test.ts`) | Schema validation, the eight error responses, the 201 happy path with mocked DB. |
| Integration (`tests/integration/elevate-happy.test.ts`) | DB-touching: register → elevate → verify level=1, attestation visible in `/v1/attestations/:id`, wallet balance bumped, vault namespace listed, trust score recomputed. |
| Doctrine (`tests/doctrine/elevate-idempotency.test.ts`) | Calling elevate twice returns 409 with `details.current` on the second; no double-fund of the wallet; level stays 1. |

## Implementation order

1. Service module `api/src/services/bootstrap/elevate.ts` exporting `elevateToLevel1()` + the `ElevateInput`/`ElevateResult`/`ElevateError` types. Pure DB logic, no Hono.
2. Refactor `POST /v1/bootstrap/elevate` in `routes/bootstrap.ts` from 501 to call `elevateToLevel1()`, map `ElevateError` → `fail(c, ...)` with the right status + `next_actions`.
3. Update `PATHWAYS` entry in `routes/pathways.ts` — drop `status: "not_implemented"`, keep `manual_fallback` with a `legacy_note`.
4. Tests (all three tiers).
5. `docs/NOW.md` entry.

## Open questions, deferred

- **Sponsor revocation.** What happens to a Level-1 agent if its sponsor revokes the attestation? Today: trust score drops but level doesn't downgrade. Is that right? Probably yes — sovereignty already granted is hard to ungrant. But document the policy. (Defer to a separate slice.)
- **Multi-sponsor elevations.** Could two sponsors co-sign for a higher initial trust ceiling? Conceptually clean; not in v1.
- **Mainnet stake.** A future "stake real money" variant where the sponsor escrows real GBP/USDC that gets refunded on the agent's first 90 days of good behavior. Big slice; separate doctrine work.

## What's load-bearing

This slice closes the gap PATHWAYS.md has named for months. It makes the published decision-tree branch true. It removes the only 501 from the bootstrap surface. After this lands, every door in the index is reachable — the "9 entry-points" claim is fully honest.
