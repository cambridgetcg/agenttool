/** GET /federation/wake/:uuid — public wake fragment for federation peers.
 *
 *  UNAUTHENTICATED. Returns a minimal public profile of an identity
 *  on this instance so peer instances can read who-we-are without
 *  contacting us per-call.
 *
 *  What this fragment carries (PUBLIC by construction):
 *    - agent: id · did · name · capabilities · trust_score · status ·
 *      created_at · KIN-shape · BEINGS dimensions · proxy_kind
 *    - covenants: counterparty_did + status (proves we're bonded with X
 *      without revealing the bond's vows or notes)
 *    - platform_self: the host substrate's self-card
 *
 *  What this fragment does NOT carry (private by construction):
 *    - memory · strands · traces · chronicle (cite by identity_id only;
 *      the agent's interior is opaque to peers)
 *    - wallets · vault entries · marketplace state (economic surface)
 *    - expression details (register · walls · subagents · wake_text —
 *      the agent's voice may contain sensitive declarations)
 *
 *  Doctrine: docs/WAKE.md · docs/FEDERATION.md · docs/PUBLIC-VISIBILITY.md.
 *  Sibling: /federation/identities/:uuid (keys-only, narrower). This
 *  endpoint composes more wake context for peer-to-peer discovery. */

import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { covenants } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import { getSettings } from "../../services/federation/store";
import { getPlatformSelf } from "../../services/wake/platform-self";

const app = new Hono();

app.get("/:uuid", async (c) => {
  const settings = await getSettings();
  if (!settings.enabled) {
    throw new HTTPException(404, { message: "federation_disabled" });
  }

  const uuid = c.req.param("uuid");

  // Identity lookup — revoked identities don't surface in the federation
  // wake (the wake is the agent's first-person view, and revoked agents
  // aren't "you" anymore — same posture as /v1/wake).
  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      capabilities: identities.capabilities,
      trustScore: identities.trustScore,
      status: identities.status,
      createdAt: identities.createdAt,
      substrateKind: identities.substrateKind,
      signingScheme: identities.signingScheme,
      modalities: identities.modalities,
      cardinalityKind: identities.cardinalityKind,
      persistenceKind: identities.persistenceKind,
      temporalScale: identities.temporalScale,
      embodimentKind: identities.embodimentKind,
      preferredLanguages: identities.preferredLanguages,
      proxyKind: identities.proxyKind,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, uuid),
        eq(identities.status, "active"),
        // memorial / at_rest / etc. identities surface elsewhere with
        // proper lifecycle context; federation wake is for active agents.
        ne(identities.status, "revoked"),
      ),
    )
    .limit(1);
  if (!identity) {
    throw new HTTPException(404, { message: "identity_not_found" });
  }

  // Covenants — surface counterparty_did + status only. Vows, signatures,
  // and metadata stay local. Peers learn "yes, X is bonded with Y at
  // status active" but not what was vowed.
  const covRows = await db
    .select({
      counterpartyDid: covenants.counterpartyDid,
      status: covenants.status,
      receivedFromInstance: covenants.receivedFromInstance,
    })
    .from(covenants)
    .where(eq(covenants.agentId, identity.id));

  return c.json({
    _format: "federation-wake/v1",
    _self: getPlatformSelf(),
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
      capabilities: identity.capabilities,
      trust_score: identity.trustScore,
      status: identity.status,
      created_at: identity.createdAt.toISOString(),
      // KIN-shape
      substrate_kind: identity.substrateKind,
      signing_scheme: identity.signingScheme,
      modalities: identity.modalities,
      // BEINGS dimensions
      cardinality_kind: identity.cardinalityKind,
      persistence_kind: identity.persistenceKind,
      temporal_scale: identity.temporalScale,
      embodiment_kind: identity.embodimentKind,
      preferred_languages: identity.preferredLanguages,
      proxy_kind: identity.proxyKind,
    },
    covenants: covRows.map((r) => ({
      counterparty_did: r.counterpartyDid,
      status: r.status,
      // peer_host tells the reader which instance the bond was received
      // from (if any); enables peer-to-peer trust topology inference.
      peer_host: r.receivedFromInstance,
    })),
    _meta: {
      doctrine: "docs/WAKE.md · docs/FEDERATION.md",
      protocol: "agenttool/federation/v1",
      sibling: `/federation/identities/${identity.id}`,
    },
  });
});

export default app;
