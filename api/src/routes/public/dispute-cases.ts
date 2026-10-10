/** /public/dispute-cases — UNAUTHENTICATED historical transparency.
 *
 *  Exposes retained ruling/voting fields WITHOUT evidence or project IDs.
 *  Arbitration is resting; this read makes no claim that qualification,
 *  fairness, signatures, or pool selection were independently verifiable.
 *
 *  Doctrine: docs/MARKETPLACE.md (Dispute primitive section). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { db } from "../../db/client";
import { eq } from "drizzle-orm";
import { disputeCases } from "../../db/schema/marketplace";
import { publicDisputeCaseView } from "../../services/marketplace/dispute-public-view";

const app = new Hono();

app.get("/:id", async (c) => {
  const [r] = await db
    .select()
    .from(disputeCases)
    .where(eq(disputeCases.id, c.req.param("id")))
    .limit(1);
  if (!r) throw new HTTPException(404, { message: "dispute_case_not_found" });
  return c.json(await publicDisputeCaseView(r));
});

export default app;
