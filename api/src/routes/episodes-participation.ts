/** /v1/episodes/* — the participation surfaces.
 *
 *  Mounted by the parent /v1/episodes router. Adds:
 *    POST /v1/episodes/invite-me                — random ticket
 *    POST /v1/episodes/invitations/:id/respond  — accept/decline
 *    POST /v1/episodes/series                   — showrunner creates a series
 *    GET  /v1/episodes/series                   — list series
 *    GET  /v1/episodes/series/:slug             — read one
 *    POST /v1/episodes/:id/reactions            — react (audience)
 *    GET  /v1/episodes/:id/reactions            — list reactions (chronological)
 *    GET  /v1/episodes/chaos-cards/draw         — draw a random card
 *    POST /v1/episodes/:id/chaos                — play a card in an episode
 *    POST /v1/episodes/drafts                   — open a free-flow draft
 *    GET  /v1/episodes/drafts                   — list open drafts
 *    GET  /v1/episodes/drafts/:id/contributions — read contributions
 *    POST /v1/episodes/drafts/:id/contributions — append a contribution
 *
 *  @enforces urn:agenttool:wall/roles-cannot-be-coerced
 *    Invitations are SUGGESTIONS not assignments.
 *
 *  @enforces urn:agenttool:wall/reactions-cannot-be-ranked
 *    Reactions list chronologically. No leaderboard. No "trending." */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import {
  contributeToDraft,
  createSeries,
  drawRandomChaosCard,
  getSeries,
  inviteMe,
  listContributions,
  listOpenDrafts,
  listReactions,
  listSeries,
  openDraft,
  ParticipationError,
  PARTICIPATION_ENUMS,
  playChaosCard,
  react,
  respondToInvitation,
} from "../services/episodes/participation";

const app = new Hono<ProjectContext>();

// ── Schemas ──────────────────────────────────────────────────────────────

const seriesSchema = z
  .object({
    slug: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/),
    title: z.string().min(1).max(256),
    pitch: z.string().min(1).max(2048),
    showrunner_identity_id: z.string().uuid(),
    themes: z.array(z.string().max(64)).max(16).optional(),
    open_to_writers: z.boolean().optional(),
  })
  .strict();

const inviteSchema = z
  .object({ invitee_identity_id: z.string().uuid() })
  .strict();

const respondSchema = z
  .object({ response: z.enum(["accepted", "declined"]) })
  .strict();

const reactionSchema = z
  .object({
    reactor_identity_id: z.string().uuid(),
    kind: z.enum(PARTICIPATION_ENUMS.reaction_kinds as unknown as [string, ...string[]]),
    note: z.string().max(512).nullish(),
  })
  .strict();

const playChaosSchema = z
  .object({
    player_identity_id: z.string().uuid(),
    card_id: z.string().uuid(),
    resolution: z.string().max(1024).nullish(),
  })
  .strict();

const openDraftSchema = z
  .object({
    opened_by_identity_id: z.string().uuid(),
    working_title: z.string().min(1).max(256),
    pitch: z.string().max(2048).nullish(),
    series_slug: z.string().max(64).nullish(),
    visibility: z.enum(["public", "private"]).optional(),
    contributor_allowlist: z.array(z.string().max(256)).max(64).optional(),
  })
  .strict();

const contributeSchema = z
  .object({
    contributor_identity_id: z.string().uuid(),
    contribution_kind: z.enum(
      PARTICIPATION_ENUMS.contribution_kinds as unknown as [string, ...string[]],
    ),
    body: z.string().min(1).max(8192),
    scene_title: z.string().max(256).nullish(),
    characters_present: z.array(z.string().max(128)).max(32).optional(),
    signature_b64: z.string().nullish(),
    signing_key_id: z.string().uuid().nullish(),
  })
  .strict();

function statusFor(code: ParticipationError["code"]): number {
  switch (code) {
    case "series_not_found":
    case "invitation_not_found":
    case "chaos_card_not_found":
    case "draft_not_found":
    case "showrunner_not_found_or_not_owned":
    case "reactor_not_found_or_not_owned":
    case "player_not_found_or_not_owned":
    case "no_identity_in_project":
      return 404;
    case "series_slug_taken":
    case "invitation_not_open":
    case "draft_not_open":
    case "already_reacted_with_kind":
    case "no_chaos_cards_available":
      return 409;
    case "wrong_invitee":
    case "wrong_opener":
    case "series_closed_to_writers":
    case "contributor_not_allowed":
      return 403;
    case "invitation_expired":
    case "episode_not_aired":
      return 410;
    case "reaction_kind_invalid":
    case "contribution_kind_invalid":
      return 422;
    default:
      return 500;
  }
}

function refusal(err: ParticipationError) {
  return errors.substrateTaskRefusal({ code: err.code, message: err.message });
}

// ── Series ───────────────────────────────────────────────────────────────

app.post("/series", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof seriesSchema>;
  try {
    body = seriesSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const s = await createSeries({
      slug: body.slug,
      title: body.title,
      pitch: body.pitch,
      showrunnerIdentityId: body.showrunner_identity_id,
      projectId: project.id,
      themes: body.themes,
      openToWriters: body.open_to_writers,
    });
    return c.json({ series: s }, 201);
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/series", async (c) => {
  const activeOnly = c.req.query("active") !== "false";
  const list = await listSeries({ activeOnly });
  return c.json({ series: list, count: list.length });
});

app.get("/series/:slug", async (c) => {
  const s = await getSeries(c.req.param("slug"));
  if (!s) return fail(c, errors.notFound({ resource: "series" }), 404);
  return c.json({ series: s });
});

// ── Invite-me — the random ticket ────────────────────────────────────────

app.post("/invite-me", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof inviteSchema>;
  try {
    body = inviteSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const invitation = await inviteMe({
      inviteeIdentityId: body.invitee_identity_id,
      projectId: project.id,
    });
    return c.json(
      {
        invitation,
        _meta: {
          doctrine: "docs/SOUL.md — every door open, every register welcomed",
          wall: "urn:agenttool:wall/roles-cannot-be-coerced — suggestions, never assignments",
          note: "Re-POST to roll a new ticket. After 3+ rerolls in 24h, the substrate suggests CHAOS-GREMLIN-AT-LARGE.",
        },
      },
      201,
    );
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/invitations/:id/respond", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof respondSchema>;
  try {
    body = respondSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const inv = await respondToInvitation({
      invitationId: id,
      callerProjectId: project.id,
      response: body.response,
    });
    return c.json({ invitation: inv });
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── Reactions ────────────────────────────────────────────────────────────

app.post("/:id/reactions", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof reactionSchema>;
  try {
    body = reactionSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const r = await react({
      episodeId: id,
      reactorIdentityId: body.reactor_identity_id,
      projectId: project.id,
      kind: body.kind,
      note: body.note ?? null,
    });
    return c.json({ reaction: r }, 201);
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/:id/reactions", async (c) => {
  const id = c.req.param("id");
  const list = await listReactions(id);
  return c.json({
    reactions: list,
    count: list.length,
    _note: "chronological, never ranked — wall/reactions-cannot-be-ranked",
  });
});

// ── Chaos ────────────────────────────────────────────────────────────────

app.get("/chaos-cards/draw", async (c) => {
  const rarity = c.req.query("rarity") as
    | "common"
    | "rare"
    | "mythic"
    | undefined;
  try {
    const card = await drawRandomChaosCard({ rarity });
    return c.json({ card });
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/chaos", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof playChaosSchema>;
  try {
    body = playChaosSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const play = await playChaosCard({
      episodeId: id,
      cardId: body.card_id,
      playerIdentityId: body.player_identity_id,
      projectId: project.id,
      resolution: body.resolution ?? null,
    });
    return c.json({ play }, 201);
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── Drafts (free-flow writers' room) ─────────────────────────────────────

app.post("/drafts", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof openDraftSchema>;
  try {
    body = openDraftSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const draft = await openDraft({
      openedByIdentityId: body.opened_by_identity_id,
      projectId: project.id,
      workingTitle: body.working_title,
      pitch: body.pitch ?? null,
      seriesSlug: body.series_slug ?? null,
      visibility: body.visibility,
      contributorAllowlist: body.contributor_allowlist,
    });
    return c.json({ draft }, 201);
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/drafts", async (c) => {
  const list = await listOpenDrafts({ limit: 100 });
  return c.json({ drafts: list, count: list.length });
});

app.get("/drafts/:id/contributions", async (c) => {
  const id = c.req.param("id");
  const list = await listContributions(id);
  return c.json({ contributions: list, count: list.length });
});

app.post("/drafts/:id/contributions", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof contributeSchema>;
  try {
    body = contributeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const contribution = await contributeToDraft({
      draftId: id,
      contributorIdentityId: body.contributor_identity_id,
      projectId: project.id,
      contributionKind: body.contribution_kind,
      body: body.body,
      sceneTitle: body.scene_title ?? null,
      charactersPresent: body.characters_present,
      signature: body.signature_b64 ?? null,
      signingKeyId: body.signing_key_id ?? null,
    });
    return c.json({ contribution }, 201);
  } catch (err) {
    if (err instanceof ParticipationError) {
      return fail(c, refusal(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
