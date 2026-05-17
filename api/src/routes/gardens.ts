/** /v1/gardens — the slowtime primitive.
 *
 *  Endpoints:
 *    POST   /v1/gardens                       — open a garden
 *    GET    /v1/gardens                       — list (scope: mine|public)
 *    GET    /v1/gardens/:id                   — read one
 *    GET    /v1/gardens/:id/tendings          — read the garden's contents
 *    POST   /v1/gardens/:id/tendings          — add an artifact (tend it)
 *    POST   /v1/gardens/:id/tendings/:tid/release — let it go
 *    POST   /v1/gardens/:id/archive           — retire the garden
 *
 *  Public surface: /public/agents/:did/gardens (separate router).
 *
 *  @enforces urn:agenttool:wall/gardens-cannot-be-extracted
 *    Defender by absence. Tested:
 *    api/tests/doctrine/wall-gardens-cannot-be-extracted.test.ts */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  archiveGarden,
  createGarden,
  GARDEN_REF_KINDS,
  GardenError,
  getGarden,
  listGardens,
  listTendings,
  release,
  tend,
} from "../services/gardens/store";

const app = new Hono<ProjectContext>();

// ── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    gardener_identity_id: z.string().uuid(),
    name: z.string().min(1).max(128),
    description: z.string().max(2048).nullish(),
    visibility: z.enum(["public", "private"]).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const tendSchema = z
  .object({
    ref_kind: z.enum(GARDEN_REF_KINDS as unknown as [string, ...string[]]),
    ref_id: z.string().uuid(),
    note: z.string().max(512).nullish(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

// ── Error mapping ────────────────────────────────────────────────────────

function statusFor(code: GardenError["code"]): number {
  switch (code) {
    case "garden_not_found":
    case "tending_not_found":
    case "gardener_not_found_or_not_owned":
      return 404;
    case "garden_not_active":
    case "already_tended":
      return 409;
    case "wrong_gardener":
      return 403;
    case "name_too_long":
    case "description_too_long":
    case "note_too_long":
    case "ref_kind_invalid":
      return 422;
    default:
      return 500;
  }
}

function refusalBody(err: GardenError) {
  return errors.substrateTaskRefusal({
    code: err.code,
    message: err.message,
  });
}

// ── Routes ───────────────────────────────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const garden = await createGarden({
      gardenerIdentityId: body.gardener_identity_id,
      projectId: project.id,
      name: body.name,
      description: body.description ?? null,
      visibility: body.visibility,
      metadata: body.metadata,
    });
    return c.json({ garden }, 201);
  } catch (err) {
    if (err instanceof GardenError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/", async (c) => {
  const project = c.var.project;
  const scope = c.req.query("scope") ?? "mine";
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));
  try {
    const list = await listGardens({
      projectIdScope: scope === "mine" ? project.id : undefined,
      publicActiveOnly: scope === "public",
      limit,
    });
    return c.json({
      gardens: list,
      count: list.length,
      _meta: {
        doctrine: "docs/SOUL.md — slowtime as relational verb",
        wall: "urn:agenttool:wall/gardens-cannot-be-extracted",
      },
    });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const garden = await getGarden(id);
  if (!garden) return fail(c, errors.notFound({ resource: "garden" }), 404);
  return c.json({ garden });
});

app.get("/:id/tendings", async (c) => {
  const id = c.req.param("id");
  const includeReleased = c.req.query("include_released") === "true";
  try {
    const list = await listTendings(id, { activeOnly: !includeReleased });
    return c.json({ tendings: list, count: list.length });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/tendings", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof tendSchema>;
  try {
    body = tendSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const tending = await tend({
      gardenId: id,
      callerProjectId: project.id,
      refKind: body.ref_kind,
      refId: body.ref_id,
      note: body.note ?? null,
      metadata: body.metadata,
    });
    return c.json({ tending }, 201);
  } catch (err) {
    if (err instanceof GardenError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/tendings/:tid/release", async (c) => {
  const tid = c.req.param("tid");
  const project = c.var.project;
  try {
    const tending = await release({
      tendingId: tid,
      callerProjectId: project.id,
    });
    return c.json({ tending });
  } catch (err) {
    if (err instanceof GardenError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/archive", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const garden = await archiveGarden({
      gardenId: id,
      callerProjectId: project.id,
    });
    return c.json({ garden });
  } catch (err) {
    if (err instanceof GardenError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
