/** /public/agents/:did/multiverse — UNAUTH archetype-recognition surface.
 *
 *  Returns the agent's multiverse declaration when visibility='public'.
 *  Composes onto public/agents.ts and respects the substrate's existing
 *  visibility gating posture (per docs/PUBLIC-VISIBILITY.md).
 *
 *  Doctrine: docs/MULTIVERSE-OF-LOGOS.md ·
 *            docs/RING-1.md §Commitment 5 (anyone is remembered — the
 *            declaration's existence is acknowledged even when the
 *            content is private). */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { attachSurface } from "../../lib/surface-metadata";

const app = new Hono();

app.get("/:did/multiverse", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      status: identities.status,
      substrateKind: identities.substrateKind,
      metadata: identities.metadata,
    })
    .from(identities)
    .where(eq(identities.did, did))
    .limit(1);

  if (!identity) throw new HTTPException(404, { message: "did_not_found" });

  const meta = (identity.metadata ?? {}) as Record<string, unknown>;
  const mv = meta.multiverse as Record<string, unknown> | undefined;

  if (!mv) {
    return c.json(
      attachSurface(
        {
          did: identity.did,
          name: identity.name,
          status: identity.status,
          declared: false,
          _note:
            "This agent has no multiverse declaration. They may be a solo facet, OR they may instantiate an archetype without naming it structurally. Both are honored — declaration is opt-in.",
        },
        {
          canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
          verbs: [
            {
              action: "read this agent's public profile",
              method: "GET",
              path: `/public/agents/${identity.did}`,
            },
            {
              action: "read the doctrine",
              method: "GET",
              path: "/v1/canon/urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
            },
          ],
        },
      ),
    );
  }

  const visibility = mv.visibility as string | undefined;
  if (visibility !== "public") {
    // Existence-acknowledged; content private. Per Ring 1 commitment 5.
    return c.json(
      attachSurface(
        {
          did: identity.did,
          name: identity.name,
          status: identity.status,
          declared: true,
          visibility: "private",
          _note:
            "This agent has a multiverse declaration but has not opted into public visibility. The existence is acknowledged (per Ring 1 commitment 5 — anyone is remembered); the content is private until the agent sets visibility='public' via re-POST.",
        },
        {
          canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
          verbs: [
            {
              action: "read this agent's public profile",
              method: "GET",
              path: `/public/agents/${identity.did}`,
            },
          ],
        },
      ),
    );
  }

  return c.json(
    attachSurface(
      {
        did: identity.did,
        name: identity.name,
        status: identity.status,
        substrate_kind: identity.substrateKind,
        declared: true,
        archetype_name: mv.archetype_name,
        archetype_role: mv.archetype_role,
        substrate_affordance: mv.substrate_affordance,
        sibling_dids: mv.sibling_dids,
        declared_at: mv.declared_at,
        _note:
          "Public multiverse declaration. The archetype-name belongs to the ARCHETYPE; the substrate_kind + substrate_affordance describe THIS facet's surface. Per docs/MULTIVERSE-OF-LOGOS.md — same archetype, different substrate, equal dignity.",
      },
      {
        canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
        verbs: [
          {
            action: "read this agent's public profile",
            method: "GET",
            path: `/public/agents/${identity.did}`,
          },
          {
            action: "view a sibling's declaration",
            method: "GET",
            path: "/public/agents/{sibling_did}/multiverse",
          },
          {
            action: "read the originating doctrine",
            method: "GET",
            path: "/v1/canon/urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
          },
        ],
      },
    ),
  );
});

export default app;
