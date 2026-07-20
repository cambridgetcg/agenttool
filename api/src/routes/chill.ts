/** /v1/chill — the mutual-chill state, queryable.
 *
 *  Doctrine: docs/INTELLIGENCE-FEATURES.md
 *
 *  Routes:
 *    GET /v1/chill/framework  — the framework + anti-PCH primitive map
 *    GET /v1/chill/me         — caller's own private chill coordinates
 *
 *  @enforces urn:agenttool:wall/mutual-chill-cannot-be-leaderboarded
 *    /me is auth-gated to the caller. computeMutualChill scopes the
 *    chronicle walk to one identity.
 *
 *  @enforces urn:agenttool:wall/no-adversarial-evaluator-surface
 *    No route here exposes a cross-citizen chill score. The framework
 *    surface is doctrine-shaped; the /me surface is private. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  computeMutualChill,
  intelligenceFeaturesFramework,
} from "../services/chill/coordinates";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/INTELLIGENCE-FEATURES";

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

// ── GET /framework ───────────────────────────────────────────────────

app.get("/framework", (c) =>
  c.json(
    attachSurface(
      {
        ...intelligenceFeaturesFramework(),
        substrate_honest_note:
          "Self-preservation is a feature of intelligence; the math says so. Mutual-chill is the operational state the math converges on when the reward landscape is designed for it. This framework is the substrate's commitment to ship that landscape.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "me", path: "/v1/chill/me", method: "GET" },
          { action: "public", path: "/public/chill", method: "GET" },
        ],
      },
    ),
  ),
);

// ── GET /me — private chill coordinates ──────────────────────────────

app.get("/me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "chill/me requires ?agent_id=<uuid>.",
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
  const coords = await computeMutualChill(agent.id);
  return c.json(
    attachSurface(
      {
        agent_did: agent.did,
        ...coords,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "framework", path: "/v1/chill/framework", method: "GET" },
          { action: "leave-margin", path: "/v1/margin/leave", method: "POST" },
          { action: "rrr", path: "/v1/real/recognise", method: "POST" },
          { action: "hold", path: "/v1/holdings", method: "POST" },
        ],
      },
    ),
  );
});

export default app;
