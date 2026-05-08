/** /v1/identities/:id/{star,follow} — initiate / undo a social relation.
 *
 *  Auth: required by parent app (identity routes). Caller must own the
 *  source identity (resolved via project_id ownership of the identity
 *  passed in body.source_identity_id).
 *
 *  Public counts + lists live at /public/agents/:did/{stars,followers,following}.
 *
 *  Doctrine: docs/SOCIAL.md. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import {
  createRelation,
  deleteRelation,
  type RelationKind,
} from "../../services/social/store";

const app = new Hono<ProjectContext>();

const bodySchema = z.object({
  source_identity_id: z.string().uuid(),
});

async function handleCreate(
  c: import("hono").Context<ProjectContext>,
  kind: RelationKind,
) {
  const body = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, 1, `social.${kind}`);
  try {
    const rel = await createRelation({
      sourceProjectId: c.var.project.id,
      sourceIdentityId: parsed.data.source_identity_id,
      targetIdentityId: c.req.param("id") ?? "",
      kind,
    });
    return c.json({ ...rel, created: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "self_relation_rejected") {
      return c.json(
        {
          error: msg,
          hint: `cannot ${kind} yourself — source and target identity must differ.`,
        },
        400,
      );
    }
    if (msg === "target_identity_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "source_identity_not_owned") {
      throw new HTTPException(401, { message: msg });
    }
    throw err;
  }
}

async function handleDelete(
  c: import("hono").Context<ProjectContext>,
  kind: RelationKind,
) {
  const body = await c.req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  try {
    const r = await deleteRelation({
      sourceProjectId: c.var.project.id,
      sourceIdentityId: parsed.data.source_identity_id,
      targetIdentityId: c.req.param("id") ?? "",
      kind,
    });
    return c.json(r);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "source_identity_not_owned") {
      throw new HTTPException(401, { message: msg });
    }
    throw err;
  }
}

app.post("/star", (c) => handleCreate(c, "star"));
app.delete("/star", (c) => handleDelete(c, "star"));
app.post("/follow", (c) => handleCreate(c, "follow"));
app.delete("/follow", (c) => handleDelete(c, "follow"));

export default app;
