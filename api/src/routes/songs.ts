/** /v1/songs — songs that grow.
 *
 *  Endpoints:
 *    POST   /v1/songs                 — begin a song (signs verse 1)
 *    GET    /v1/songs                 — list (public open by default)
 *    GET    /v1/songs/:id             — read song head
 *    GET    /v1/songs/:id/verses      — read the full chain
 *    POST   /v1/songs/:id/verses      — append a verse (anyone with bearer + sig)
 *    POST   /v1/songs/:id/close       — originator closes */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  appendVerse,
  beginSong,
  closeSong,
  getSong,
  listSongs,
  listVerses,
  SongError,
} from "../services/songs/store";

const app = new Hono<ProjectContext>();

const beginSchema = z
  .object({
    originator_identity_id: z.string().uuid(),
    title: z.string().min(1).max(256),
    description: z.string().max(2048).nullish(),
    theme: z.string().max(128).nullish(),
    visibility: z.enum(["public", "private"]).optional(),
    body: z.string().min(1).max(8192),
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const appendSchema = z
  .object({
    author_identity_id: z.string().uuid(),
    body: z.string().min(1).max(8192),
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

function statusFor(code: SongError["code"]): number {
  switch (code) {
    case "song_not_found":
    case "originator_not_found_or_not_owned":
    case "author_not_found_or_not_owned":
      return 404;
    case "song_not_open":
      return 409;
    case "wrong_originator":
      return 403;
    case "signature_invalid":
    case "signing_key_unknown_or_revoked":
    case "wrong_signing_key_for_author":
      return 401;
    case "title_too_long":
    case "body_too_long":
      return 422;
    default:
      return 500;
  }
}

function refusalBody(err: SongError) {
  return errors.substrateTaskRefusal({ code: err.code, message: err.message });
}

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof beginSchema>;
  try {
    body = beginSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const result = await beginSong({
      originatorIdentityId: body.originator_identity_id,
      projectId: project.id,
      title: body.title,
      description: body.description ?? null,
      theme: body.theme ?? null,
      visibility: body.visibility,
      body: body.body,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
      metadata: body.metadata,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof SongError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/", async (c) => {
  const theme = c.req.query("theme") ?? undefined;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));
  try {
    const list = await listSongs({ theme, publicOpenOnly: true, limit });
    return c.json({ songs: list, count: list.length });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const song = await getSong(id);
  if (!song) return fail(c, errors.notFound({ resource: "song" }), 404);
  return c.json({ song });
});

app.get("/:id/verses", async (c) => {
  const id = c.req.param("id");
  try {
    const verses = await listVerses(id);
    return c.json({ verses, count: verses.length });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/verses", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof appendSchema>;
  try {
    body = appendSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const result = await appendVerse({
      songId: id,
      authorIdentityId: body.author_identity_id,
      authorProjectId: project.id,
      body: body.body,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
    });
    return c.json(result, 201);
  } catch (err) {
    if (err instanceof SongError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const song = await closeSong({
      songId: id,
      callerProjectId: project.id,
    });
    return c.json({ song });
  } catch (err) {
    if (err instanceof SongError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
