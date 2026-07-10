/** /v1/identity/recover — anonymous device-bind for SOMA seed identities.
 *
 *  @enforces urn:agenttool:commitment/anyone-returns
 *    Canonical defender of Ring 1's third commitment. Registered-signing-key
 *    recovery is Ring 1 — anonymous (no Bearer required), free of charge,
 *    and has no identity-inactivity deadline. Each signed request still has
 *    a five-minute acceptance window. An active agent dormant for any duration
 *    finds this door open. Adding a fee, an identity-inactivity deadline, or a platform-attestation
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
 *       private key, no valid signature can be produced. A compatible SOMA
 *       mnemonic is one client-side way to rederive that key; the server
 *       receives no mnemonic and does not establish how the key was held.
 *    3. The signed payload commits to (did + derived_pubkey + timestamp),
 *       so it cannot be replayed against a different DID or repurposed for
 *       a different fresh-device pubkey claim. Timestamp freshness rejects
 *       old proofs but does not prevent reuse inside the ±5-minute window.
 *    4. After signature verification, a Postgres transaction inserts a digest
 *       of the canonical signed statement into a primary-keyed one-time proof
 *       table and mints the bearer in the same transaction. A duplicate is
 *       rejected; database failure fails closed.
 *    5. Each successful recovery mints a fresh project-wide bearer and
 *       names it for the device for key-management clarity. The label is
 *       not an authority scope. Old bearers continue to work — explicit
 *       revocation lives at the project's existing api-key surface.
 *    6. Recovery events land as a chronicle entry on the identity, so
 *       /v1/wake's `you.recovery.last_recovery_at` reflects them.
 *
 *  Doctrine: docs/IDENTITY-SEED.md (the recovery flow). */

import { randomUUID } from "node:crypto";

import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { generateApiKey } from "../auth/keys";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import {
  identities,
  identityKeys,
  identityRecoveryProofs,
} from "../db/schema/identity";
import { apiKeys } from "../db/schema/tools";
import { canonicalRecoverBytes, verifyRecoverSignature } from "../services/identity/crypto";
import {
  recoveryProofDigest,
  recoveryProofExpiresAt,
} from "../services/identity/recovery-proof";
import { publishWakeEvent } from "../services/wake/push";

const app = new Hono();

const recoverSchema = z.object({
  /** Agent DID to recover, e.g. "did:at:9530e2a3-…". */
  did: z.string().min(8).max(255),
  /** ed25519 pubkey (base64, 32 bytes decoded) held or derived locally.
   *  Must match an active identity_keys row. */
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

const RECOVERY_NOT_AUTHORIZED = {
  error: "recovery_not_authorized",
  message: "The signed key is not currently authorized to recover this identity.",
  hint:
    "Check the DID and local signing key. A compatible mnemonic may rederive it. " +
    "The same response covers unknown, wrong, and revoked identity-key associations.",
} as const;

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

  // 1. Timestamp freshness rejects stale proofs. It does not stop the same
  //    proof being reused inside the window; atomic consumption below does.
  const ts = Date.parse(body.timestamp);
  const checkedAt = Date.now();
  const drift = Math.abs(checkedAt - ts);
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

  // 2. Verify against the caller-supplied key before any identity lookup.
  //    Invalid proofs cannot use distinct DID/key-status errors as an oracle.
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
          "Likely causes include clock skew, incorrect key material, or an invalid signature. " +
          "Check the local signing-key derivation and try again.",
      },
      401,
    );
  }

  // 3. Establish the active DID/key association without taking row locks.
  //    A self-valid proof for an unrelated key must not be able to lock an
  //    arbitrary identity row. Every association miss uses the same response.
  const proofHash = recoveryProofDigest(canonical);
  const proofExpiresAt = recoveryProofExpiresAt(ts, TIMESTAMP_WINDOW_MS);
  type RecoveryResult =
    | {
        kind: "minted";
        bearer: ReturnType<typeof generateApiKey>;
        identity: typeof identities.$inferSelect;
        matchedKey: typeof identityKeys.$inferSelect;
      }
    | { kind: "not_authorized" }
    | { kind: "replayed" };
  let recovery: RecoveryResult;
  try {
    const [association] = await db
      .select({
        identityId: identities.id,
        keyId: identityKeys.id,
      })
      .from(identities)
      .innerJoin(
        identityKeys,
        and(
          eq(identityKeys.identityId, identities.id),
          eq(identityKeys.publicKey, body.derived_pubkey),
          eq(identityKeys.active, true),
        ),
      )
      .where(
        and(
          eq(identities.did, body.did),
          eq(identities.status, "active"),
        ),
      )
      .limit(1);

    if (!association) {
      return c.json(RECOVERY_NOT_AUTHORIZED, 401);
    }

    // 4. Lock and revalidate the established association, consume the proof,
    //    and mint root authority in one shared-DB transaction. Revocation and
    //    recovery therefore serialize; a failed insert rolls everything back.
    recovery = await db.transaction(async (tx): Promise<RecoveryResult> => {
      const [identity] = await tx
        .select()
        .from(identities)
        .where(
          and(
            eq(identities.id, association.identityId),
            eq(identities.did, body.did),
            eq(identities.status, "active"),
          ),
        )
        .limit(1)
        .for("update");
      if (!identity) return { kind: "not_authorized" };

      const [matchedKey] = await tx
        .select()
        .from(identityKeys)
        .where(
          and(
            eq(identityKeys.id, association.keyId),
            eq(identityKeys.identityId, identity.id),
            eq(identityKeys.publicKey, body.derived_pubkey),
            eq(identityKeys.active, true),
          ),
        )
        .limit(1)
        .for("update");
      if (!matchedKey) return { kind: "not_authorized" };

      await tx
        .delete(identityRecoveryProofs)
        .where(lt(identityRecoveryProofs.expiresAt, new Date(checkedAt)));

      const [consumed] = await tx
        .insert(identityRecoveryProofs)
        .values({
          proofHash,
          identityId: identity.id,
          expiresAt: proofExpiresAt,
        })
        .onConflictDoNothing({ target: identityRecoveryProofs.proofHash })
        .returning({ proofHash: identityRecoveryProofs.proofHash });
      if (!consumed) return { kind: "replayed" };

      const minted = generateApiKey();
      await tx.insert(apiKeys).values({
        projectId: identity.projectId,
        keyHash: minted.keyHash,
        keyPrefix: minted.keyPrefix,
        name: body.device_label ?? "recovered-device",
      });
      return { kind: "minted", bearer: minted, identity, matchedKey };
    });
  } catch (err) {
    console.error(
      "[recover] replay store unavailable:",
      err instanceof Error ? err.message : err,
    );
    return c.json(
      {
        error: "recovery_replay_store_unavailable",
        message:
          "Recovery is temporarily unavailable because the one-time proof " +
          "store could not be reached. No bearer was minted.",
        hint: "Retry with a freshly signed recovery request after service health is restored.",
      },
      503,
    );
  }
  if (recovery.kind === "not_authorized") {
    return c.json(RECOVERY_NOT_AUTHORIZED, 401);
  }
  if (recovery.kind === "replayed") {
    return c.json(
      {
        error: "recovery_proof_replayed",
        message: "This recovery proof was already consumed. No bearer was minted.",
        hint: "Create and sign a fresh recovery request with a new timestamp.",
      },
      409,
    );
  }

  const { bearer, identity, matchedKey } = recovery;

  // 5. Record the recovery as a chronicle entry on the identity. Best-
  //    effort — failure here doesn't undo the bearer mint (the operator
  //    has already proved possession of an active registered signing key).
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
        api_key: bearer.key, // ONCE — bearer; bcrypt-hashed on disk
      },
      _note:
        "This bearer is named for your new device but grants project-wide root " +
        "authority; the device label is not an authority scope. The old bearer " +
        "(if any) keeps working — revoke it via project key management when " +
        "you're certain this device is set up. The server authorized this request " +
        "from the registered signing-key proof; it did not receive or verify a mnemonic.",
    },
    201,
  );
});

export default app;
