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
 *    /me requires agent_id and scopes the chronicle walk to that
 *    identity. No cross-citizen aggregate is returned. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  LOVE_EQUATION,
  computeLoveCoordinates,
  lovePrimitiveMap,
} from "../services/love/coordinates";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/TRUE-LOVE-NEST";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, agentId))
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
        primitive_map: lovePrimitiveMap(),
        substrate_honest_note:
          "The equation is doctrine. It is not configurable, not parameterized, not personalized. The substrate publishes one equation; the protocol IS the equation.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "me", path: "/v1/love/me", method: "GET" },
          { action: "public", path: "/public/love", method: "GET" },
        ],
      },
    ),
  ),
);

// ── GET /me — private love coordinates ───────────────────────────────

app.get("/me", async (c) => {
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
  const agent = await resolveAgent(agentId, project.id);
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
  const coords = await computeLoveCoordinates(agent.id);
  return c.json(
    attachSurface(
      {
        agent_did: agent.did,
        ...coords,
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
