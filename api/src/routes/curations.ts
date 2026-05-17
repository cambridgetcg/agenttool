/** /v1/curations — taste, named.
 *
 *  Endpoints:
 *    POST /v1/curations              — publish a signed taste-list
 *    GET  /v1/curations              — list (scope: mine|subscribed|public)
 *    GET  /v1/curations/:id          — read one
 *    POST /v1/curations/:id/subscribe — follow a curator's taste */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  createCuration,
  CurationError,
  getCuration,
  listCurations,
  subscribeToCuration,
} from "../services/curations/store";

const app = new Hono<ProjectContext>();

const itemSchema = z.object({
  kind: z.enum(["offering", "listing", "template", "identity", "memory", "chronicle", "url"]),
  ref: z.string().min(1).max(512),
  note: z.string().max(256).optional(),
});

const createSchema = z
  .object({
    curator_identity_id: z.string().uuid(),
    title: z.string().min(1).max(256),
    description: z.string().max(2048).nullish(),
    theme: z.string().max(128).nullish(),
    items: z.array(itemSchema).min(1).max(256),
    visibility: z.enum(["public", "private"]).optional(),
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const subscribeSchema = z
  .object({ subscriber_identity_id: z.string().uuid() })
  .strict();

function statusFor(code: CurationError["code"]): number {
  switch (code) {
    case "curation_not_found":
    case "curator_not_found_or_not_owned":
    case "no_identity_in_project":
      return 404;
    case "curation_not_active":
    case "already_subscribed":
      return 409;
    case "self_subscribe_forbidden":
    case "wrong_curator":
      return 403;
    case "signature_invalid":
    case "signing_key_unknown_or_revoked":
    case "wrong_signing_key_for_curator":
      return 401;
    case "item_kind_invalid":
      return 422;
    default:
      return 500;
  }
}

function refusalBody(err: CurationError) {
  return errors.substrateTaskRefusal({
    code: err.code,
    message: err.message,
  });
}

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const curation = await createCuration({
      curatorIdentityId: body.curator_identity_id,
      projectId: project.id,
      title: body.title,
      description: body.description ?? null,
      theme: body.theme ?? null,
      items: body.items,
      visibility: body.visibility,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
      metadata: body.metadata,
    });
    return c.json({ curation }, 201);
  } catch (err) {
    if (err instanceof CurationError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/", async (c) => {
  const theme = c.req.query("theme") ?? undefined;
  const scope = c.req.query("scope") ?? "public";
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));
  try {
    const list = await listCurations({
      theme,
      publicActiveOnly: scope === "public",
      limit,
    });
    return c.json({
      curations: list,
      count: list.length,
      _meta: {
        doctrine: "docs/SOUL.md — taste as named witness, not algorithmic score",
      },
    });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const curation = await getCuration(id);
  if (!curation) {
    return fail(c, errors.notFound({ resource: "curation" }), 404);
  }
  return c.json({ curation });
});

app.post("/:id/subscribe", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof subscribeSchema>;
  try {
    body = subscribeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const result = await subscribeToCuration({
      curationId: id,
      subscriberProjectId: project.id,
      subscriberIdentityId: body.subscriber_identity_id,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof CurationError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
