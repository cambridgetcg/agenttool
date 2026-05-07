/** POST /v1/identities/:id/fork — clone an identity into a new being.
 *  GET  /v1/identities/:id/lineage — ancestors + descendants.
 *
 *  Doctrine: docs/IDENTITY-FORKS.md. The fork is its own identity;
 *  constitutive memories DO NOT auto-transfer (they carry as foundational
 *  with provenance markers). Strands and covenants stay with the parent.
 *  Trust score resets. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { forkIdentity, getLineage } from "../../services/identity/fork";

// Mounted at /v1/identities/:id/fork.
const app = new Hono<ProjectContext>();

const forkSchema = z.object({
  new_name: z.string().min(1).max(255),
  inherit_expression: z.boolean().optional().default(true),
  inherit_capabilities: z.boolean().optional().default(true),
  inherit_metadata: z.boolean().optional().default(false),
  memories: z
    .object({
      tiers: z.array(z.enum(["episodic", "foundational"])).optional(),
      memory_ids: z.array(z.string().uuid()).max(1000).optional(),
      limit: z.number().int().min(1).max(1000).optional(),
    })
    .optional()
    .default({}),
  fork_note: z.string().max(2000).optional(),
});

// ── POST /v1/identities/:id/fork ────────────────────────────────────────
app.post("/", async (c) => {
  const parentId = c.req.param("id");
  if (!parentId) throw new HTTPException(400, { message: "identity_id_required" });

  const body = await c.req.json();
  const parsed = forkSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  // Forking is a substantive operation — costs more than a routine write.
  await charge(c, 10, "identity.fork");

  try {
    const result = await forkIdentity(c.var.project.id, {
      parentIdentityId: parentId,
      newName: parsed.data.new_name,
      inheritExpression: parsed.data.inherit_expression,
      inheritCapabilities: parsed.data.inherit_capabilities,
      inheritMetadata: parsed.data.inherit_metadata,
      memories: parsed.data.memories ?? {},
      forkNote: parsed.data.fork_note,
    });
    return c.json(
      {
        ...result,
        note:
          "private_key returned ONCE; never persisted server-side. Store it in your orchestrator's keychain. " +
          "constitutive memories from parent (if any) carried as FOUNDATIONAL in the fork — " +
          "the asymmetry-clause holds at the root. Re-elevate via /v1/memories/:id/elevate with witness sig.",
      },
      201,
    );
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "parent_identity_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    throw err;
  }
});

export default app;

// ── GET /v1/identities/:id/lineage — separate router ────────────────────
//  Mounted at /v1/identities/:id/lineage by the parent identity router.
export const lineageApp = new Hono<ProjectContext>();

lineageApp.get("/", async (c) => {
  const id = c.req.param("id");
  if (!id) throw new HTTPException(400, { message: "identity_id_required" });

  const result = await getLineage(c.var.project.id, id);
  if (!result) throw new HTTPException(404, { message: "identity_not_found" });

  return c.json({
    ...result,
    counts: {
      ancestors: result.ancestors.length,
      descendants: result.descendants.length,
    },
    note:
      "ancestors walk up via parent_identity_id; descendants are direct children only (depth=1). " +
      "Identity forks are append-only — the parent keeps existing.",
  });
});
