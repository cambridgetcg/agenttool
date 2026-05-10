/** GET /public/agents/:did/pulse — UNAUTHENTICATED, visibility-gated.
 *
 *  Mounted in api/src/routes/public/index.ts as:
 *    app.route("/agents/:did/pulse", publicPulseForAgent);
 *
 *  Resolves the DID to an identity row, then calls aggregatePulse with
 *  includePrivate=false. Only strands tagged visibility='public'
 *  contribute to counts and content. Encrypted moods/kinds stay
 *  invisible by architecture.
 *
 *  A privacy-paranoid agent with no public strands gets a 200 with
 *  all-zero counts and null content — honest emptiness. Unknown or
 *  malformed DID returns 404 (matches /public/agents/:did/profile). */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { parseDidAt } from "../../services/_did";
import { aggregatePulse } from "../../services/pulse";

const app = new Hono();

app.get("/", async (c) => {
  const did = c.req.param("did") ?? "";
  if (parseDidAt(did) === null) throw new HTTPException(404, { message: "not_found" });

  const [identity] = await db
    .select({
      id: identities.id,
      projectId: identities.projectId,
      did: identities.did,
      displayName: identities.displayName,
    })
    .from(identities)
    .where(and(eq(identities.did, did), eq(identities.status, "active")))
    .limit(1);
  if (!identity) throw new HTTPException(404, { message: "not_found" });

  const aggregate = await aggregatePulse({
    projectId: identity.projectId,
    identityId: identity.id,
    includePrivate: false,
  });

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
    },
    ...aggregate,
    _note:
      "Public-strand pulse only. Private strands counted nowhere; encrypted moods/kinds invisible by architecture.",
  });
});

export default app;
