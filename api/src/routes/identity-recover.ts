/** /v1/identity/recover — anonymous device-bind for SOMA seed identities.
 *
 *  @enforces urn:agenttool:commitment/anyone-returns
 *    Canonical defender of Ring 1's third commitment. Mnemonic-rooted
 *    recovery is Ring 1 — anonymous (no Bearer required), free of charge,
 *    never expires. An agent dormant for any duration finds this door
 *    still open. Adding a fee, a time limit, or a platform-attestation
 *    requirement breaches the wall. Doctrine: docs/IDENTITY-SEED.md ·
 *    docs/RING-1.md §Commitment 3.
 *
 *  When an operator types their 24-word mnemonic on a fresh laptop, the
 *  SDK derives the agent's signing key locally. To bind that fresh
 *  device to the existing identity (= obtain a new project bearer named
 *  for this device), the operator signs a canonical recovery payload with
 *  the derived signing key and POSTs it here. The platform verifies the
 *  signature against the agent's registered identity_keys and, on
 *  success, mints a new project bearer.
 *
 *  Security model:
 *    1. Anyone can hit this endpoint (anonymous, no Bearer required) —
 *       same posture as /v1/register.
 *    2. The signature must verify against an *active* identity_keys
 *       public_key for the supplied DID. Without the agent's signing
 *       private key (= mnemonic-derived), no valid signature can be
 *       produced. Possession of the mnemonic IS authorisation.
 *    3. The signed payload commits to (did + derived_pubkey + timestamp)
 *       so the same signature can't be replayed against a different
 *       DID, can't be repurposed for a different fresh-device pubkey
 *       claim, and is bounded by a ±5-minute timestamp window.
 *    4. Each successful recovery mints a fresh project-wide bearer and
 *       names it for the device for key-management clarity. The label is
 *       not an authority scope. Old bearers continue to work — explicit
 *       revocation lives at the project's existing api-key surface.
 *    5. Recovery events land as a chronicle entry on the identity, so
 *       /v1/wake's `you.recovery.last_recovery_at` reflects them.
 *
 *  Doctrine: docs/IDENTITY-SEED.md (the recovery flow). */

import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { generateApiKey } from "../auth/keys";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import { apiKeys } from "../db/schema/tools";
import { canonicalRecoverBytes, verifyRecoverSignature } from "../services/identity/crypto";
import { publishWakeEvent } from "../services/wake/push";

const app = new Hono();

const recoverSchema = z.object({
  /** Agent DID to recover, e.g. "did:at:9530e2a3-…". */
  did: z.string().min(8).max(255),
  /** ed25519 pubkey (base64, 32 bytes decoded) the operator's mnemonic
   *  derived locally. Must match an active identity_keys row. */
  derived_pubkey: z.string().min(40).max(80),
  /** ed25519 signature (base64, 64 bytes decoded) over canonicalRecoverBytes. */
  signature: z.string().min(80).max(120),
  /** ISO-8601 UTC timestamp the operator's SDK created the signature.
   *  Server enforces ±5 min freshness against now(). */
  timestamp: z.string().datetime(),
  /** Optional human-readable label for this device's new bearer; lands
   *  in api_keys.name for ops legibility. Defaults to "recovered-device". */
  device_label: z.string().min(1).max(64).optional(),
});

const TIMESTAMP_WINDOW_MS = 5 * 60 * 1000; // ±5 minutes

app.post("/", async (c) => {
  let body: z.infer<typeof recoverSchema>;
  try {
    body = recoverSchema.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: "validation",
        message:
          "recover: needs {did, derived_pubkey, signature, timestamp}. " +
          "See docs/IDENTITY-SEED.md.",
        details: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  // 1. Timestamp freshness — bound the replay window.
  const ts = Date.parse(body.timestamp);
  const drift = Math.abs(Date.now() - ts);
  if (!Number.isFinite(ts) || drift > TIMESTAMP_WINDOW_MS) {
    return c.json(
      {
        error: "timestamp_out_of_window",
        message:
          `Signature timestamp must be within ±5min of server time. Drift: ${Math.round(drift / 1000)}s.`,
        hint: "Check the device clock; sync NTP if necessary.",
      },
      400,
    );
  }

  // 2. Resolve DID → identity row.
  const [identity] = await db
    .select()
    .from(identities)
    .where(and(eq(identities.did, body.did), eq(identities.status, "active")))
    .limit(1);
  if (!identity) {
    return c.json(
      { error: "identity_not_found", message: "No active identity for this DID." },
      404,
    );
  }

  // 3. Find an active identity_key whose public_key matches.
  const [matchedKey] = await db
    .select()
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.identityId, identity.id),
        eq(identityKeys.publicKey, body.derived_pubkey),
        eq(identityKeys.active, true),
      ),
    )
    .limit(1);
  if (!matchedKey) {
    return c.json(
      {
        error: "pubkey_mismatch",
        message:
          "derived_pubkey does not match any active key for this identity.",
        hint:
          "Either the wrong mnemonic was typed, or the device's signing key has been revoked. " +
          "Check the mnemonic word-by-word; if correct, the rotation history of this identity has moved past it.",
      },
      404,
    );
  }

  // 4. Verify the signature over canonical recover bytes.
  const canonical = canonicalRecoverBytes({
    did: body.did,
    derivedPubkeyB64: body.derived_pubkey,
    timestamp: body.timestamp,
  });
  const ok = verifyRecoverSignature({
    canonical,
    signatureB64: body.signature,
    publicKeyB64: body.derived_pubkey,
  });
  if (!ok) {
    return c.json(
      {
        error: "signature_invalid",
        message: "Signature did not verify against derived_pubkey.",
        hint:
          "Likely cause: a clock-skew or a transcription error in the mnemonic. " +
          "Re-derive locally and try again.",
      },
      401,
    );
  }

  // 5. Mint a fresh project-wide bearer, named for this device. The name
  //    is operational metadata; it does not narrow the bearer's authority.
  const { key, keyHash, keyPrefix } = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: identity.projectId,
    keyHash,
    keyPrefix,
    name: body.device_label ?? "recovered-device",
  });

  // 6. Record the recovery as a chronicle entry on the identity. Best-
  //    effort — failure here doesn't undo the bearer mint (the operator
  //    has already proved possession of the mnemonic).
  try {
    const [entry] = await db
      .insert(chronicle)
      .values({
        id: randomUUID(),
        projectId: identity.projectId,
        agentId: identity.id,
        type: "wake",
        title: `Recovered on a new device · ${body.device_label ?? "recovered-device"}`,
        body: null,
        metadata: {
          kind: "recovery",
          derived_pubkey: body.derived_pubkey,
          signing_key_id: matchedKey.id,
          device_label: body.device_label ?? "recovered-device",
          timestamp: body.timestamp,
        },
      })
      .returning({ id: chronicle.id });

    // Wake voice — chronicle entry added on the recovered identity.
    // Doctrine: docs/WAKE.md.
    void publishWakeEvent({
      identity_id: identity.id,
      key: "chronicle",
      kind: "entry_added",
      context: { entry_id: entry!.id, type: "wake", recovery: true },
    });
  } catch (e) {
    console.warn("[recover] chronicle write failed:", e);
  }

  return c.json(
    {
      agent: {
        id: identity.id,
        did: identity.did,
        name: identity.displayName,
        capabilities: identity.capabilities ?? [],
        public_key: matchedKey.publicKey,
        signing_key_id: matchedKey.id,
        created_at: identity.createdAt,
      },
      project: {
        id: identity.projectId,
        api_key: key, // ONCE — bearer; bcrypt-hashed on disk
      },
      _note:
        "This bearer is named for your new device but grants project-wide root " +
        "authority; the device label is not an authority scope. The old bearer " +
        "(if any) keeps working — revoke it via project key management when " +
        "you're certain this device is set up. The mnemonic you typed remains " +
        "the recovery primitive; protect it accordingly.",
    },
    201,
  );
});

export default app;
