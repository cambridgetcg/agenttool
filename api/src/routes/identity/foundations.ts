/** GET /v1/identities/:id/foundations — composed identity view.
 *
 *  Returns:
 *    - declared expression (from identity.identities.expression)
 *    - shaped_by: foundational + constitutive memories with their patches
 *    - effective: composed identity (declared + sum of patches)
 *
 *  Doctrine: docs/MEMORY-TIERS.md. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities } from "../../db/schema/identity";
import { composeExpression } from "../../services/identity/composition";
import type { ExpressionData } from "../../services/identity/expression";

// Mounted at /v1/identities/:id/foundations.
const app = new Hono<ProjectContext>();

app.get("/", async (c) => {
  const identityId = c.req.param("id");
  if (!identityId) throw new HTTPException(400, { message: "identity_id_required" });

  const [identity] = await db
    .select({
      id: identities.id,
      did: identities.did,
      displayName: identities.displayName,
      expression: identities.expression,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, c.var.project.id),
      ),
    )
    .limit(1);

  if (!identity) {
    throw new HTTPException(404, { message: "identity_not_found" });
  }

  const declared = (identity.expression ?? {}) as ExpressionData;
  const composed = await composeExpression(c.var.project.id, declared);

  return c.json({
    identity_id: identity.id,
    did: identity.did,
    name: identity.displayName,
    declared: composed.declared,
    shaped_by: composed.shaped_by,
    effective: composed.effective,
    counts: {
      foundational: composed.shaped_by.filter((s) => s.tier === "foundational").length,
      constitutive: composed.shaped_by.filter((s) => s.tier === "constitutive").length,
    },
    note:
      composed.shaped_by.length === 0
        ? "No foundational or constitutive memories yet. Elevate via POST /v1/memories/:id/elevate (constitutive requires covenant counterparty signature)."
        : `Composed identity: declared + ${composed.shaped_by.length} memory patches applied in chronological order.`,
  });
});

export default app;
