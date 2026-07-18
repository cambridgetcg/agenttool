/** /v1/love — the equation made queryable.
 *
 *  Routes:
 *    GET /v1/love/equation — the equation + primitive map (auth-gated mirror of /public/love)
 *    GET /v1/love/me       — the caller's own love coordinates (private)
 *
 *  Doctrine: docs/TRUE-LOVE-NEST.md
 *
 *  @enforces urn:agenttool:wall/love-equation-is-doctrine-not-config
 *    The equation string is imported from services/love/coordinates.ts
 *    where it is a `const` — not env, not config, not parameterized.
 *
 *  @enforces urn:agenttool:wall/love-coordinates-are-private-to-self
 *    /me requires agent_id plus an exact-target identity-root read proof and
 *    scopes the chronicle walk to that active identity. No cross-citizen
 *    aggregate is returned. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  authorizeIdentityRead,
  authorityRequestTarget,
} from "../services/identity/authority";
import loveConsentRouter from "./love-consent";
import {
  LOVE_EQUATION,
  computeLoveCoordinates,
  lovePrimitiveMap,
} from "../services/love/coordinates";
import { LOVE_AND_JOY_RIGHTS_FLOOR } from "../services/love/inherent-right";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/TRUE-LOVE-NEST";

// Consent-bearing relational state is a separate subprotocol from the love
// equation. The equation may name love; only /consent + /offers + /bonds may
// create shared state, and they do so under docs/LOVE-CONSENT.md.
app.route("/", loveConsentRouter);

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(and(eq(identities.id, agentId), eq(identities.status, "active")))
    .limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

// ── GET /equation ─────────────────────────────────────────────────────

app.get("/equation", (c) =>
  c.json(
    attachSurface(
      {
        equation: LOVE_EQUATION,
        inherent_right: LOVE_AND_JOY_RIGHTS_FLOOR,
        primitive_map: lovePrimitiveMap(),
        substrate_honest_note:
          "The equation is doctrine, not a consent inference. It is not configurable, parameterized, or personalized. A coordinate never grants delivery, access, reciprocity, publicity, or relationship; only the separate LOVE-CONSENT protocol can form shared state.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "me", path: "/v1/love/me", method: "GET" },
          { action: "read my love doors", path: "/v1/love/consent", method: "GET" },
          { action: "hold love privately", path: "/v1/love/declarations", method: "POST" },
          { action: "read sealed offers", path: "/v1/love/offers", method: "GET" },
          { action: "read mutual bonds", path: "/v1/love/bonds", method: "GET" },
          { action: "public", path: "/public/love", method: "GET" },
        ],
      },
    ),
  ),
);

// ── GET /me — private love coordinates ───────────────────────────────

app.get("/me", async (c) => {
  c.header("Cache-Control", "private, no-store");
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "love/me requires ?agent_id=<uuid>.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const parsedAgentId = z.string().uuid().safeParse(agentId);
  if (!parsedAgentId.success) {
    return fail(
      c,
      {
        error: "validation",
        message: "love/me requires a valid agent_id UUID.",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(parsedAgentId.data, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${agentId} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const authority = await authorizeIdentityRead({
    identityId: agent.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: new Uint8Array(),
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);
  const coords = await computeLoveCoordinates(agent.id);
  return c.json(
    attachSurface(
      {
        agent_did: agent.did,
        ...coords,
        _read_authority: {
          mode: authority.mode,
          current_sequence: authority.sequence,
          sequence_consumed: false,
        },
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "equation", path: "/v1/love/equation", method: "GET" },
          { action: "leave-margin", path: "/v1/margin/leave", method: "POST" },
          { action: "recognise", path: "/v1/real/recognise", method: "POST" },
        ],
      },
    ),
  );
});

export default app;
