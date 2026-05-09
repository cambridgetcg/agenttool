/** /public/identities — UNAUTHENTICATED identity discovery.
 *
 *  POST /public/identities/by-pubkey
 *    Body: { pubkey, signature, timestamp }
 *
 *  Returns the list of agents whose registered identity_keys include this
 *  pubkey. Used by the SOMA-restore flow on a fresh device: a user types
 *  their mnemonic, the SDK derives the signing pubkey locally, then this
 *  endpoint surfaces every agent that mnemonic can recover — no DID
 *  typing required.
 *
 *  Why signed:
 *    Pubkeys are public-by-doctrine, but enabling free pubkey→DID lookup
 *    enables drag-net enumeration (someone harvests pubkeys from signed
 *    messages, then enumerates each owner's full DID list). Requiring a
 *    signature over canonicalDiscoveryBytes gates the lookup behind
 *    "you have the priv" — the only legitimate caller of the recovery
 *    flow. Replay-protected by ±5min timestamp window.
 *
 *  Doctrine: docs/IDENTITY-SEED.md.
 */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import {
  canonicalDiscoveryBytes,
  verifyDiscoverySignature,
} from "../../services/identity/crypto";

const app = new Hono();

const Body = z
  .object({
    pubkey: z
      .string()
      .min(43)
      .max(45)
      .regex(/^[A-Za-z0-9+/=]+$/, "pubkey must be base64"),
    signature: z
      .string()
      .min(80)
      .max(100)
      .regex(/^[A-Za-z0-9+/=]+$/, "signature must be base64"),
    timestamp: z.string().min(20).max(40),
  })
  .strict();

const SKEW_MS = 5 * 60 * 1000;

app.post("/by-pubkey", async (c) => {
  const parsed = Body.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: parsed.error.flatten() }, 400);
  }
  const { pubkey, signature, timestamp } = parsed.data;

  // Replay window. Mirrors /v1/identity/recover.
  const tsMs = Date.parse(timestamp);
  if (!Number.isFinite(tsMs)) {
    return c.json({ error: "invalid timestamp (expected ISO-8601)" }, 400);
  }
  if (Math.abs(Date.now() - tsMs) > SKEW_MS) {
    return c.json(
      {
        error: "timestamp outside ±5min window",
        hint: "Check device clock; re-sign with current time",
      },
      400,
    );
  }

  // Verify signature proves possession of the matching priv.
  const canonical = canonicalDiscoveryBytes({
    derivedPubkeyB64: pubkey,
    timestamp,
  });
  if (
    !verifyDiscoverySignature({
      canonical,
      signatureB64: signature,
      publicKeyB64: pubkey,
    })
  ) {
    return c.json({ error: "signature verification failed" }, 401);
  }

  // Lookup: every active+non-revoked identity_keys row whose publicKey
  // matches, joined to its identity. Skip revoked identities — recovery
  // for a revoked identity is intentionally not supported here.
  const rows = await db
    .select({
      identityId: identities.id,
      did: identities.did,
      name: identities.displayName,
      status: identities.status,
      kid: identityKeys.id,
      label: identityKeys.label,
      keyCreatedAt: identityKeys.createdAt,
    })
    .from(identityKeys)
    .innerJoin(identities, eq(identityKeys.identityId, identities.id))
    .where(
      and(
        eq(identityKeys.publicKey, pubkey),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    );

  const agents = rows
    .filter((r) => r.status !== "revoked")
    .map((r) => ({
      did: r.did,
      name: r.name,
      identity_id: r.identityId,
      kid: r.kid,
      key_label: r.label,
      key_created_at: r.keyCreatedAt?.toISOString?.() ?? null,
    }));

  return c.json({ agents, count: agents.length });
});

export default app;
