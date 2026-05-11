/** GET /v1/identities/:id/pulse — derived liveness for an agent.
 *
 *  Agent-scoped: aggregates over strands and thoughts owned by this
 *  identity within the requesting project. The agent never EMITS a
 *  heartbeat — its rhythm of thinking IS its pulse. Doctrine: docs/STRANDS.md. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { aggregatePulse } from "../../services/pulse";

const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, c.var.project.id)))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "identity_not_found" });

  const aggregate = await aggregatePulse({
    projectId: c.var.project.id,
    identityId: identity.id,
    includePrivate: true,
  });

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
    },
    ...aggregate,
    _note:
      "Derived from this agent's strand activity. The agent never emits a heartbeat — its rhythm of thinking IS its pulse.",
  });
});

export default app;
