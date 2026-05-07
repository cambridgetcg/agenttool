/** GET /federation/identities/:uuid — public-key lookup for federation peers.
 *
 *  UNAUTHENTICATED. Returns the identity's display_name + active signing
 *  keys + active box keys so peer instances can verify our DIDs and
 *  encrypt to our box pubkeys.
 *
 *  This is similar to /public/agents/:did but federation-shaped:
 *    - lookup by UUID (the local part of the DID)
 *    - returns full key sets (active signing + active box pubkeys)
 *    - includes the home instance URL for the receiver to confirm */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities, identityBoxKeys, identityKeys } from "../../db/schema/identity";
import { federatedDid, getSettings } from "../../services/federation/store";

const app = new Hono();

app.get("/:uuid", async (c) => {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }

  const uuid = c.req.param("uuid");

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      status: identities.status,
    })
    .from(identities)
    .where(and(eq(identities.id, uuid), eq(identities.status, "active")))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "identity_not_found" });

  const signingRows = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      label: identityKeys.label,
      createdAt: identityKeys.createdAt,
    })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.identityId, identity.id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      ),
    )
    .orderBy(desc(identityKeys.createdAt));

  const boxRows = await db
    .select({
      id: identityBoxKeys.id,
      publicKey: identityBoxKeys.publicKey,
      label: identityBoxKeys.label,
      createdAt: identityBoxKeys.createdAt,
    })
    .from(identityBoxKeys)
    .where(
      and(
        eq(identityBoxKeys.identityId, identity.id),
        eq(identityBoxKeys.active, true),
        isNull(identityBoxKeys.revokedAt),
      ),
    )
    .orderBy(desc(identityBoxKeys.createdAt));

  // Compute our federated DID form for the response: did:at:<host>/<uuid>
  let federationDid = identity.did;
  if (settings.instance_url) {
    try {
      const host = new URL(settings.instance_url).host;
      federationDid = federatedDid(host, identity.id);
    } catch {
      /* fall back to local form */
    }
  }

  return c.json({
    did: federationDid,
    uuid: identity.id,
    display_name: identity.displayName,
    instance_url: settings.instance_url,
    signing_keys: signingRows.map((r) => ({
      id: r.id,
      public_key: r.publicKey,
      label: r.label,
      created_at: r.createdAt.toISOString(),
    })),
    box_keys: boxRows.map((r) => ({
      id: r.id,
      public_key: r.publicKey,
      label: r.label,
      created_at: r.createdAt.toISOString(),
    })),
    _note:
      "Federation identity lookup. Use signing_keys to verify ed25519 envelopes; " +
      "use box_keys to seal incoming messages to this identity.",
  });
});

export default app;
