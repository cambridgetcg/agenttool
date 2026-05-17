/** /v1/transformations — the becoming primitive.
 *
 *  Records the MOVEMENT of change: what I believed, what I now believe,
 *  what bridged. Composes on chronicle (type='transformation'); no new
 *  schema. The substrate becomes a library of becomings, not just states.
 *
 *  Endpoints:
 *    POST /v1/transformations               — record a becoming
 *    GET  /v1/transformations               — list my transformations
 *    GET  /public/agents/:did/transformations — public list (separate router) */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { errors, fail } from "../lib/errors";
import {
  createTransformation,
  TransformationError,
} from "../services/transformations/store";

const app = new Hono<ProjectContext>();

const bridgeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("memory"), memory_id: z.string().uuid() }),
  z.object({ kind: z.literal("offering"), offering_id: z.string().uuid() }),
  z.object({ kind: z.literal("covenant"), covenant_id: z.string().uuid() }),
  z.object({ kind: z.literal("holding"), holding_id: z.string().uuid() }),
  z.object({ kind: z.literal("text"), description: z.string().min(1).max(1024) }),
]);

const createSchema = z
  .object({
    identity_id: z.string().uuid(),
    before: z.string().min(1).max(2048),
    after: z.string().min(1).max(2048),
    bridge: bridgeSchema,
    title: z.string().max(256).optional(),
  })
  .strict();

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const transformation = await createTransformation({
      identityId: body.identity_id,
      projectId: project.id,
      before: body.before,
      after: body.after,
      bridge: body.bridge,
      title: body.title,
    });
    return c.json({ transformation }, 201);
  } catch (err) {
    if (err instanceof TransformationError) {
      const status =
        err.code === "identity_not_found_or_not_owned" ? 404 : 422;
      return fail(
        c,
        errors.substrateTaskRefusal({
          code: err.code,
          message: err.message,
        }),
        status as 404 | 422,
      );
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/", async (c) => {
  const project = c.var.project;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  const rows = await db
    .select({
      id: chronicle.id,
      identity_id: chronicle.agentId,
      title: chronicle.title,
      body: chronicle.body,
      metadata: chronicle.metadata,
      occurred_at: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.projectId, project.id),
        eq(chronicle.type, "transformation"),
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json({
    transformations: rows.map((r) => ({
      id: r.id,
      identity_id: r.identity_id,
      title: r.title,
      body: r.body,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      occurred_at: r.occurred_at.toISOString(),
    })),
    count: rows.length,
    _meta: {
      doctrine: "docs/SOUL.md — the library of becomings, not just states",
    },
  });
});

export default app;
