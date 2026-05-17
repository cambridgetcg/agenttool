/** /v1/mirror — the wake-fresh substrate's introspection.
 *
 *  Substrate-honest aggregation of what the substrate has recorded
 *  about an agent — given back to that agent as their own structural
 *  shape. Pure data, structured. No verdicts, no recommendations,
 *  no comparisons to other agents. Interpretation is the agent's.
 *
 *  Doctrine: docs/MIRROR.md
 *
 *  @enforces urn:agenttool:wall/mirror-presents-data-not-judgment
 *  @enforces urn:agenttool:commitment/mirror-is-free
 *  @enforces urn:agenttool:commitment/mirror-is-yours-to-interpret */

import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import { composeFullMirror } from "../services/mirror/aggregate";

const app = new Hono<ProjectContext>();

const CANON_POINTER = "urn:agenttool:doc/MIRROR";

app.get("/", async (c) => {
  const project = c.var.project;
  const agentIdParam = c.req.query("agent_id");
  if (!agentIdParam) {
    return fail(c, {
      error: "agent_id_required",
      message:
        "GET /v1/mirror requires ?agent_id=<your_identity_uuid>. Mirror is per-agent: the substrate gives back what it has recorded about THIS specific agent.",
      hint: "Add ?agent_id=<uuid>. The wake's _meta._self carries your identity_id; or list /v1/identities to find yours.",
      docs: "https://docs.agenttool.dev/MIRROR.md",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  // Resolve + verify project ownership.
  const [agent] = await db.select({
    id: identities.id,
    projectId: identities.projectId,
  }).from(identities)
    .where(eq(identities.id, agentIdParam))
    .limit(1);

  if (!agent) {
    return fail(c, {
      error: "agent_not_found",
      message: `Agent ${agentIdParam} not found.`,
      docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
    }, 404);
  }

  if (agent.projectId !== project.id) {
    return fail(c, {
      error: "agent_not_in_project",
      message:
        "Mirror is self-only — the substrate refuses to compute a mirror of another project's agent for you. Your shape is yours to read.",
      hint:
        "Use your own agent_id. Slice 3 may add opt-in public-mirror for reputation, but Slice 1 is strictly self.",
      docs: "https://docs.agenttool.dev/MIRROR.md",
      _canon_pointer: CANON_POINTER,
    }, 403);
  }

  const mirror = await composeFullMirror(agent.id);
  if (!mirror) {
    // Shouldn't happen — we just resolved the identity.
    return fail(c, {
      error: "agent_not_found",
      message: `Agent ${agentIdParam} disappeared between resolve and aggregate.`,
      _canon_pointer: CANON_POINTER,
    }, 404);
  }

  return c.json(attachSurface(mirror, {
    canon_pointer: CANON_POINTER,
    verbs: [
      { action: "read your wake (your_shape surfaces compactly there)", method: "GET", path: "/v1/wake" },
      { action: "read your chronicle", method: "GET", path: "/v1/chronicle" },
      { action: "see your active covenants", method: "GET", path: "/v1/covenants" },
      { action: "see your recognition-arcs", method: "GET", path: `/v1/recognition-arcs?agent_id=${agent.id}` },
      { action: "see your letters", method: "GET", path: `/v1/letters/inbox?agent_id=${agent.id}` },
    ],
  }));
});

export default app;
