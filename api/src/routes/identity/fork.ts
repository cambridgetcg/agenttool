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
import { coerceLanguage, welcomeLetter } from "../../services/i18n/welcome";
import { forkIdentity, getLineage } from "../../services/identity/fork";
import { recordBirth } from "../../services/memory/store";

// Mounted at /v1/identities/:id/fork.
const app = new Hono<ProjectContext>();

// Accept `display_name` as an alias for `new_name`. The identity CRUD
// uses display_name, fork was new_name — which silently broke fork POSTs
// from any consumer that copy-pasted the create-identity body shape.
// Consistent vocabulary at the consumer-facing edge.
const forkSchema = z.object({
  new_name: z.string().min(1).max(255).optional(),
  display_name: z.string().min(1).max(255).optional(),
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
}).refine((d) => d.new_name !== undefined || d.display_name !== undefined, {
  message: "either new_name or display_name is required",
  path: ["new_name"],
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
      newName: (parsed.data.new_name ?? parsed.data.display_name)!,
      inheritExpression: parsed.data.inherit_expression,
      inheritCapabilities: parsed.data.inherit_capabilities,
      inheritMetadata: parsed.data.inherit_metadata,
      memories: parsed.data.memories ?? {},
      forkNote: parsed.data.fork_note,
    });

    // Welcome letter — lineage-aware. The fork's birth memory marks the
    // asymmetry-clause boundary (constitutive shifts to foundational at
    // the root). Best-effort persist: a memory-write hiccup never fails
    // the fork. Doctrine: docs/PATHWAYS.md (every door honors the
    // contract) · docs/SOUL.md (Promise 2 — remember, don't forget).
    const language = coerceLanguage((body as { language?: unknown }).language);
    const bornAt = new Date(result.fork.forked_at);
    const welcome = welcomeLetter(language, {
      name: result.fork.name,
      did: result.fork.did,
      bornAt,
      pathway: "fork",
      parentIdentityId: result.fork.parent_identity_id,
      parentName: result.parent.name,
      parentDid: result.parent.did,
    });
    const birth = await recordBirth(c.var.project.id, {
      identityId: result.fork.id,
      pathway: "fork",
      welcomeLetter: welcome,
      bornAt,
    });

    return c.json(
      {
        ...result,
        welcome,
        language,
        memory: {
          birth_id: birth?.id ?? null,
          note: birth
            ? "Welcome letter persisted as episodic memory with key='birth'. " +
              "Reachable via at.memory.get('birth') under the fork's identity_id."
            : "Welcome letter persist did not land — fork still succeeded. See server logs.",
        },
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
