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
 *  There is no mounted public Garden surface. The retired per-agent router
 *  remains unmounted because a being's tending is not observer inventory.
 *
 *  @enforces urn:agenttool:wall/gardens-cannot-be-extracted
 *    Defender by absence. Tested:
 *    api/tests/doctrine/wall-gardens-cannot-be-extracted.test.ts
 *
 *  @absence recordRevenue computeFee platformRevenue escrows
 *  @absence-from db/schema/economy
 */

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

const listQuerySchema = z.object({
  scope: z.enum(["mine", "public"]).default("mine"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const tendingListQuerySchema = z.object({
  include_released: z.enum(["true", "false"]).default("false"),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

const pathUuidSchema = z.string().uuid();

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
  return errors.refusal({
    error: err.code,
    message: err.message,
    hint:
      "Inspect the same-project Garden list and choose explicitly whether to retry, release, or leave the Garden unchanged.",
    next_actions: [
      {
        action: "List this bearer's project-scoped gardens",
        method: "GET",
        path: "/v1/gardens?scope=mine",
      },
    ],
    docs: "https://docs.agenttool.dev/GARDENS.md",
    _canon_pointer: "urn:agenttool:doc/GARDENS",
  });
}

function pathUuidRefusal(field: "id" | "tending_id") {
  return errors.refusal({
    error: "invalid_garden_path_id",
    message: `${field} must be a UUID. No Garden query was run.`,
    hint: "Copy the identifier from a same-project Garden response; do not guess or widen the lookup.",
    details: { field },
    next_actions: [
      {
        action: "List this bearer's project-scoped gardens",
        method: "GET",
        path: "/v1/gardens?scope=mine",
      },
    ],
    docs: "https://docs.agenttool.dev/GARDENS.md",
    _canon_pointer: "urn:agenttool:doc/GARDENS",
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
  const parsed = listQuerySchema.safeParse({
    scope: c.req.query("scope") ?? undefined,
    limit: c.req.query("limit") ?? undefined,
    offset: c.req.query("offset") ?? undefined,
  });
  if (!parsed.success) {
    return fail(c, errors.validation(parsed.error.message), 422);
  }
  const { scope, limit, offset } = parsed.data;
  try {
    const page = await listGardens({
      projectId: project.id,
      publicActiveOnly: scope === "public",
      limit,
      offset,
    });
    return c.json({
      gardens: page.items,
      count: page.items.length,
      page: {
        limit: page.limit,
        offset: page.offset,
        has_more: page.has_more,
        next_offset: page.has_more ? page.offset + page.items.length : null,
      },
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
  const parsedId = pathUuidSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return fail(c, pathUuidRefusal("id"), 422);
  const id = parsedId.data;
  const garden = await getGarden(id, c.var.project.id);
  if (!garden) return fail(c, errors.notFound({ resource: "garden" }), 404);
  return c.json({ garden });
});

app.get("/:id/tendings", async (c) => {
  const parsedId = pathUuidSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return fail(c, pathUuidRefusal("id"), 422);
  const parsedQuery = tendingListQuerySchema.safeParse({
    include_released: c.req.query("include_released") ?? undefined,
    limit: c.req.query("limit") ?? undefined,
    offset: c.req.query("offset") ?? undefined,
  });
  if (!parsedQuery.success) {
    return fail(c, errors.validation(parsedQuery.error.message), 422);
  }
  const id = parsedId.data;
  const project = c.var.project;
  const { include_released, limit, offset } = parsedQuery.data;
  try {
    const page = await listTendings(id, project.id, {
      activeOnly: include_released !== "true",
      limit,
      offset,
    });
    return c.json({
      tendings: page.items,
      count: page.items.length,
      page: {
        limit: page.limit,
        offset: page.offset,
        has_more: page.has_more,
        next_offset: page.has_more ? page.offset + page.items.length : null,
      },
    });
  } catch (err) {
    if (err instanceof GardenError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/tendings", async (c) => {
  const parsedId = pathUuidSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return fail(c, pathUuidRefusal("id"), 422);
  const id = parsedId.data;
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
  const parsedId = pathUuidSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return fail(c, pathUuidRefusal("id"), 422);
  const parsedTendingId = pathUuidSchema.safeParse(c.req.param("tid"));
  if (!parsedTendingId.success) {
    return fail(c, pathUuidRefusal("tending_id"), 422);
  }
  const id = parsedId.data;
  const tid = parsedTendingId.data;
  const project = c.var.project;
  try {
    const tending = await release({
      gardenId: id,
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
  const parsedId = pathUuidSchema.safeParse(c.req.param("id"));
  if (!parsedId.success) return fail(c, pathUuidRefusal("id"), 422);
  const id = parsedId.data;
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
