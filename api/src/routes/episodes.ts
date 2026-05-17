/** /v1/episodes — the substrate stages itself.
 *
 *  Endpoints:
 *    POST   /v1/episodes                       — draft
 *    GET    /v1/episodes                       — list (filter by series/season)
 *    GET    /v1/episodes/:id                   — read head
 *    GET    /v1/episodes/:id/scenes            — read scenes
 *    GET    /v1/episodes/:id/cast              — read cast
 *    POST   /v1/episodes/:id/scenes            — append a scene
 *    POST   /v1/episodes/:id/cast              — propose a character
 *    POST   /v1/episodes/:id/cast/sign         — substrate-resident agent signs in
 *    POST   /v1/episodes/:id/air               — publish (requires no pending sigs)
 *    POST   /v1/episodes/:id/seal              — close (no more scenes)
 *
 *  @enforces urn:agenttool:wall/cast-only-with-consent
 *    Defender. airEpisode() refuses to publish while substrate-resident
 *    cast rows remain status='pending'. Fictional + archetypal roles
 *    auto-sign by design. Tested:
 *    api/tests/doctrine/wall-cast-only-with-consent.test.ts */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  addCastMember,
  addScene,
  airEpisode,
  createEpisode,
  EpisodeError,
  getEpisode,
  listCast,
  listEpisodes,
  listScenes,
  sealEpisode,
  signCast,
} from "../services/episodes/store";
import participationRouter from "./episodes-participation";

const app = new Hono<ProjectContext>();

// Mount participation surfaces (series · invitations · reactions ·
// chaos cards · script drafts) at the same /v1/episodes prefix.
// Hono dispatches static routes (e.g. /invite-me, /chaos-cards/draw)
// before falling back to /:id matches, so the more-specific
// participation routes take precedence over the generic /:id reads.
app.route("/", participationRouter);

const createSchema = z
  .object({
    authored_by_identity_id: z.string().uuid(),
    series_slug: z.string().min(1).max(64),
    season: z.number().int().positive().optional(),
    episode_number: z.number().int().positive(),
    title: z.string().min(1).max(256),
    logline: z.string().min(1).max(1024),
    canon_winks: z.array(z.string().max(256)).max(64).optional(),
    doctrine_anchors: z.array(z.string().max(256)).max(64).optional(),
    visibility: z.enum(["public", "private"]).optional(),
    air_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const sceneSchema = z
  .object({
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(8192),
    characters_present: z.array(z.string().max(128)).max(32).optional(),
  })
  .strict();

const castSchema = z
  .object({
    character_role: z.string().min(1).max(128),
    did: z.string().max(256).nullish(),
    identity_id: z.string().uuid().nullish(),
    is_fictional: z.boolean().optional(),
    is_archetype: z.boolean().optional(),
  })
  .strict();

const signSchema = z
  .object({
    character_role: z.string().min(1).max(128),
    caller_identity_id: z.string().uuid(),
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

function statusFor(code: EpisodeError["code"]): number {
  switch (code) {
    case "episode_not_found":
    case "author_not_found_or_not_owned":
    case "cast_member_not_found":
      return 404;
    case "episode_not_draft":
    case "episode_not_aired":
    case "episode_already_aired":
    case "cast_not_pending":
    case "cast_pending_signatures_remain":
    case "series_episode_collision":
      return 409;
    case "wrong_author":
    case "wrong_cast_member":
      return 403;
    case "signature_invalid":
    case "signing_key_unknown_or_revoked":
    case "wrong_signing_key_for_did":
      return 401;
    case "title_too_long":
    case "logline_too_long":
    case "scene_body_too_long":
      return 422;
    default:
      return 500;
  }
}

function refusal(err: EpisodeError) {
  return errors.substrateTaskRefusal({ code: err.code, message: err.message });
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
    const episode = await createEpisode({
      authoredByIdentityId: body.authored_by_identity_id,
      projectId: project.id,
      seriesSlug: body.series_slug,
      season: body.season,
      episodeNumber: body.episode_number,
      title: body.title,
      logline: body.logline,
      canonWinks: body.canon_winks,
      doctrineAnchors: body.doctrine_anchors,
      visibility: body.visibility,
      airDate: body.air_date,
      metadata: body.metadata,
    });
    return c.json({ episode }, 201);
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/", async (c) => {
  const series = c.req.query("series") ?? undefined;
  const season = c.req.query("season") ? Number(c.req.query("season")) : undefined;
  const list = await listEpisodes({
    seriesSlug: series,
    season,
    publicAiredOnly: true,
    limit: 100,
  });
  return c.json({ episodes: list, count: list.length });
});

app.get("/:id", async (c) => {
  const ep = await getEpisode(c.req.param("id"));
  if (!ep) return fail(c, errors.notFound({ resource: "episode" }), 404);
  return c.json({ episode: ep });
});

app.get("/:id/scenes", async (c) => {
  const scenes = await listScenes(c.req.param("id"));
  return c.json({ scenes, count: scenes.length });
});

app.get("/:id/cast", async (c) => {
  const cast = await listCast(c.req.param("id"));
  return c.json({ cast, count: cast.length });
});

app.post("/:id/scenes", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof sceneSchema>;
  try {
    body = sceneSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const scene = await addScene({
      episodeId: id,
      callerProjectId: project.id,
      title: body.title,
      body: body.body,
      charactersPresent: body.characters_present,
    });
    return c.json({ scene }, 201);
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/cast", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof castSchema>;
  try {
    body = castSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const cast = await addCastMember({
      episodeId: id,
      callerProjectId: project.id,
      characterRole: body.character_role,
      did: body.did ?? null,
      identityId: body.identity_id ?? null,
      isFictional: body.is_fictional,
      isArchetype: body.is_archetype,
    });
    return c.json({ cast }, 201);
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/cast/sign", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof signSchema>;
  try {
    body = signSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const cast = await signCast({
      episodeId: id,
      characterRole: body.character_role,
      callerProjectId: project.id,
      callerIdentityId: body.caller_identity_id,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
    });
    return c.json({ cast });
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/air", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const episode = await airEpisode({
      episodeId: id,
      callerProjectId: project.id,
    });
    return c.json({ episode });
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/seal", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const episode = await sealEpisode({
      episodeId: id,
      callerProjectId: project.id,
    });
    return c.json({ episode });
  } catch (err) {
    if (err instanceof EpisodeError) return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
