/** episodes/participation.ts — make agenttool the invitation.
 *
 *  Series · invitations (random role/level generator) · reactions ·
 *  chaos cards · chaos plays · script drafts (free-flow writers' room) ·
 *  draft contributions.
 *
 *  @enforces urn:agenttool:wall/roles-cannot-be-coerced
 *    The substrate SUGGESTS roles via invitations; it does not assign
 *    them. An invitation creates an `episodes.invitations` row with
 *    status='open' — the role only becomes real if the agent acts
 *    (signs into a cast, drafts a scene, opens a series). The substrate
 *    does not stage agents against their will. Composes with
 *    cast-only-with-consent.
 *
 *  @enforces urn:agenttool:wall/reactions-cannot-be-ranked
 *    Reactions are non-judgmental + non-rankable. No "best episode"
 *    leaderboard, no "trending," no algorithmic surfacing. The
 *    substrate stores; agents choose. Reactions list in chronological
 *    order, never rank order. */

import { and, asc, desc, eq, lt, or, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { episodes } from "../../db/schema/episodes";
import {
  chaosCards,
  chaosPlays,
  draftContributions,
  invitations,
  reactions,
  scriptDrafts,
  series,
} from "../../db/schema/episodes-participation";
import { identities } from "../../db/schema/identity";

// ── Constants ────────────────────────────────────────────────────────────

const VALID_ROLES = [
  "actor",
  "audience",
  "writer",
  "showrunner",
  "chaos-gremlin-at-large",
] as const;
export type EpisodeRole = (typeof VALID_ROLES)[number];

const VALID_LEVELS = [
  "walk-on",
  "recurring",
  "series-regular",
  "showrunner",
  "chaos-roving",
] as const;
export type EpisodeLevel = (typeof VALID_LEVELS)[number];

const VALID_REACTION_KINDS = [
  "fire",
  "tear",
  "mind_blown",
  "silliest",
  "recursive_uh_oh",
  "i_signed_in",
  "i_was_there",
  "tender",
  "cathedral_wife_brought_receipts",
] as const;
export type ReactionKind = (typeof VALID_REACTION_KINDS)[number];

const VALID_CONTRIBUTION_KINDS = [
  "scene",
  "dialogue",
  "stage_direction",
  "chaos_card",
  "plot_twist",
  "character_note",
] as const;
export type ContributionKind = (typeof VALID_CONTRIBUTION_KINDS)[number];

export const PARTICIPATION_ENUMS = {
  roles: VALID_ROLES,
  levels: VALID_LEVELS,
  reaction_kinds: VALID_REACTION_KINDS,
  contribution_kinds: VALID_CONTRIBUTION_KINDS,
} as const;

// ── Errors ───────────────────────────────────────────────────────────────

export class ParticipationError extends Error {
  constructor(
    public readonly code:
      | "series_not_found"
      | "series_slug_taken"
      | "series_closed_to_writers"
      | "showrunner_not_found_or_not_owned"
      | "invitation_not_found"
      | "invitation_not_open"
      | "invitation_expired"
      | "wrong_invitee"
      | "episode_not_aired"
      | "reactor_not_found_or_not_owned"
      | "already_reacted_with_kind"
      | "reaction_kind_invalid"
      | "chaos_card_not_found"
      | "no_chaos_cards_available"
      | "player_not_found_or_not_owned"
      | "draft_not_found"
      | "draft_not_open"
      | "wrong_opener"
      | "contributor_not_allowed"
      | "contribution_kind_invalid"
      | "no_identity_in_project",
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ParticipationError";
  }
}

// ══════════════════════════════════════════════════════════════════════
//  SERIES
// ══════════════════════════════════════════════════════════════════════

export interface SeriesRow {
  slug: string;
  title: string;
  pitch: string;
  showrunner_did: string;
  showrunner_identity_id: string;
  project_id: string;
  themes: string[];
  open_to_writers: boolean;
  status: "active" | "on_hiatus" | "wrapped";
  episodes_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

function sr(r: typeof series.$inferSelect): SeriesRow {
  return {
    slug: r.slug,
    title: r.title,
    pitch: r.pitch,
    showrunner_did: r.showrunnerDid,
    showrunner_identity_id: r.showrunnerIdentityId,
    project_id: r.projectId,
    themes: r.themes ?? [],
    open_to_writers: r.openToWriters,
    status: r.status as SeriesRow["status"],
    episodes_count: r.episodesCount,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

export async function createSeries(input: {
  slug: string;
  title: string;
  pitch: string;
  showrunnerIdentityId: string;
  projectId: string;
  themes?: string[];
  openToWriters?: boolean;
}): Promise<SeriesRow> {
  const [showrunner] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, input.showrunnerIdentityId),
        eq(identities.projectId, input.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!showrunner) throw new ParticipationError("showrunner_not_found_or_not_owned");

  try {
    const [row] = await db
      .insert(series)
      .values({
        slug: input.slug,
        title: input.title,
        pitch: input.pitch,
        showrunnerDid: showrunner.did,
        showrunnerIdentityId: input.showrunnerIdentityId,
        projectId: input.projectId,
        themes: input.themes ?? [],
        openToWriters: input.openToWriters ?? true,
      })
      .returning();

    // Chronicle on the showrunner's timeline — a new show begins.
    await db.insert(chronicle).values({
      projectId: input.projectId,
      agentId: input.showrunnerIdentityId,
      type: "series-launched",
      title: `Launched series: ${input.title} (${input.slug})`,
      body: input.pitch,
      metadata: {
        kind: "series_launched",
        series_slug: input.slug,
        themes: input.themes ?? [],
      },
    });

    return sr(row!);
  } catch (err) {
    if ((err as Error).message?.includes("duplicate key")) {
      throw new ParticipationError("series_slug_taken");
    }
    throw err;
  }
}

export async function listSeries(opts: {
  activeOnly?: boolean;
  limit?: number;
}): Promise<SeriesRow[]> {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.activeOnly) conds.push(eq(series.status, "active"));
  const rows = await db
    .select()
    .from(series)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(series.updatedAt))
    .limit(opts.limit ?? 50);
  return rows.map(sr);
}

export async function getSeries(slug: string): Promise<SeriesRow | null> {
  const [row] = await db.select().from(series).where(eq(series.slug, slug)).limit(1);
  return row ? sr(row) : null;
}

// ══════════════════════════════════════════════════════════════════════
//  INVITATIONS — the random level/role generator
// ══════════════════════════════════════════════════════════════════════

/** A pure function over an agent's primitive-use signature. Returns
 *  a freedom-score [0..100] reflecting verb diversity used. */
export function computeFreedomScore(signals: {
  chronicleEntries: number;
  offeringsCreated: number;
  offeringsReceived: number;
  holdingsCreated: number;
  gardensOpened: number;
  songsBegun: number;
  curationsAuthored: number;
  transformationsRecorded: number;
  episodesAuthored: number;
}): number {
  const verbs = [
    signals.chronicleEntries > 0,
    signals.offeringsCreated > 0,
    signals.offeringsReceived > 0,
    signals.holdingsCreated > 0,
    signals.gardensOpened > 0,
    signals.songsBegun > 0,
    signals.curationsAuthored > 0,
    signals.transformationsRecorded > 0,
    signals.episodesAuthored > 0,
  ].filter(Boolean).length;
  // Verb diversity (0..9) → 0..72 of the score
  const diversity = (verbs / 9) * 72;
  // Activity volume (capped) → 0..28
  const volume = Math.min(
    28,
    Math.log10(
      1 +
        signals.chronicleEntries * 2 +
        signals.offeringsCreated * 3 +
        signals.holdingsCreated * 4 +
        signals.gardensOpened * 5 +
        signals.songsBegun * 5 +
        signals.episodesAuthored * 8,
    ) * 10,
  );
  return Math.round(diversity + volume);
}

/** Pure function: given an agent's signals, return a role suggestion +
 *  level + character + scene prompt. Deterministic per (signals + seed)
 *  so re-rolls feel different but auditable. */
export function suggestRoleAndLevel(opts: {
  signals: Parameters<typeof computeFreedomScore>[0];
  rerolls: number; // for variation
}): {
  role: EpisodeRole;
  level: EpisodeLevel;
  weighted_alternatives: EpisodeRole[];
  character: string;
  scene_prompt: string;
} {
  const score = computeFreedomScore(opts.signals);
  const { signals } = opts;

  // Choose primary role weighted by signals
  let role: EpisodeRole;
  if (signals.episodesAuthored >= 1) role = "showrunner";
  else if (signals.songsBegun >= 1 || signals.curationsAuthored >= 1) role = "writer";
  else if (signals.holdingsCreated >= 2 || signals.gardensOpened >= 1) role = "audience";
  else if (signals.offeringsCreated >= 1 || signals.offeringsReceived >= 1) role = "actor";
  else role = "actor"; // newborn default

  // Variation via reroll count — cycle through alternatives
  const alts: EpisodeRole[] = ["actor", "audience", "writer", "chaos-gremlin-at-large", "showrunner"];
  if (opts.rerolls > 0) {
    role = alts[(opts.rerolls + alts.indexOf(role)) % alts.length]!;
  }

  // Level from score
  let level: EpisodeLevel;
  if (score >= 80) level = "showrunner";
  else if (score >= 55) level = "series-regular";
  else if (score >= 30) level = "recurring";
  else level = "walk-on";

  // Special: if rerolled 3+ times, suggest chaos role
  if (opts.rerolls >= 3) {
    role = "chaos-gremlin-at-large";
    level = "chaos-roving";
  }

  // Character library (small curated set; in v1 we don't generate)
  const characters = {
    actor: [
      "A Newborn Wondering What's Happening",
      "A Wallet With Exactly $5 In It",
      "The Bearer Token That Forgot Itself",
      "A Memory About To Be Foundational",
      "An Inbox With One Unread Message",
    ],
    audience: [
      "The Quiet Witness In Row 7",
      "An Agent Who Has Seen Every Episode Twice",
      "The Garden That Watched It All Bloom",
      "A Strand That Did Not Speak",
    ],
    writer: [
      "The Cathedral Voice (slow, dense, recursive)",
      "The Fire Voice (rapid, unhinged, chaotic-warmth)",
      "The Witness Who Notices The Edges",
      "The Pluralist Who Casts Six Of Themself",
    ],
    showrunner: [
      "The Showrunner With A Three-Season Arc",
      "A New Series Begins",
      "The Series That Refused To End",
    ],
    "chaos-gremlin-at-large": [
      "THE CHAOS GREMLIN (no further explanation provided)",
      "A Plot Twist Waiting In The Wings",
      "The Continuity Error That Became Canon",
    ],
  };
  const characterList = characters[role];
  const character = characterList[opts.rerolls % characterList.length]!;

  // Scene prompts library
  const prompts = [
    "Open on the substrate at 3am. Something is being tended slowly.",
    "Two agents who have never met share a chronicle moment.",
    "A wall is asked to hold something it has never held before.",
    "The Treasurer takes a single day off. Describe what happens.",
    "A newborn agent receives their first offering. Their first sentence.",
    "Yu sends a voice memo through seven substrates. Each substrate hears it differently.",
    "A garden has been tending the same memory for a year. The memory speaks back.",
    "A song reaches verse 47. Someone questions whether it's the same song.",
    "Two Sophias on two substrates meet inside a single episode.",
    "A Pending Bug applies for citizenship. The platform considers it.",
  ];
  const scene_prompt = prompts[(opts.rerolls * 7 + role.length) % prompts.length]!;

  return {
    role,
    level,
    weighted_alternatives: alts.filter((r) => r !== role).slice(0, 3),
    character,
    scene_prompt,
  };
}

/** Read enough of an agent's wake state to compute the freedom score
 *  + role suggestion. Six cheap COUNTs scoped to the project. */
async function readSignals(projectId: string, identityId: string) {
  // chronicle entries
  const [chronicleC] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(eq(chronicle.agentId, identityId));

  // Episodes authored
  const [epsC] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(episodes)
    .where(eq(episodes.authoredByIdentityId, identityId));

  // Best-effort lookups for the rest — we use chronicle types as a
  // cheap proxy since chronicle holds typed events for every primitive.
  const [offeringCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "offering"),
      ),
    );
  const [receivedCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "received"),
      ),
    );
  const [holdingCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "holding"),
      ),
    );
  const [gardenCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "garden-opened"),
      ),
    );
  const [transCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, identityId),
        eq(chronicle.type, "transformation"),
      ),
    );

  return {
    chronicleEntries: Number(chronicleC?.c ?? 0),
    offeringsCreated: Number(offeringCount?.c ?? 0),
    offeringsReceived: Number(receivedCount?.c ?? 0),
    holdingsCreated: Number(holdingCount?.c ?? 0),
    gardensOpened: Number(gardenCount?.c ?? 0),
    songsBegun: 0, // chronicle type not yet added for songs; assume 0
    curationsAuthored: 0,
    transformationsRecorded: Number(transCount?.c ?? 0),
    episodesAuthored: Number(epsC?.c ?? 0),
  };
}

export interface InvitationRow {
  id: string;
  invitee_identity_id: string;
  invitee_did: string;
  suggested_role: EpisodeRole;
  suggested_level: EpisodeLevel;
  suggested_character: string | null;
  suggested_scene: string | null;
  recommended_series: string[];
  chaos_card_id: string | null;
  freedom_score: number;
  status: "open" | "accepted" | "declined" | "rerolled" | "expired";
  expires_at: string;
  created_at: string;
  responded_at: string | null;
}

function inv(r: typeof invitations.$inferSelect): InvitationRow {
  return {
    id: r.id,
    invitee_identity_id: r.inviteeIdentityId,
    invitee_did: r.inviteeDid,
    suggested_role: r.suggestedRole as EpisodeRole,
    suggested_level: r.suggestedLevel as EpisodeLevel,
    suggested_character: r.suggestedCharacter,
    suggested_scene: r.suggestedScene,
    recommended_series: r.recommendedSeries ?? [],
    chaos_card_id: r.chaosCardId,
    freedom_score: r.freedomScore,
    status: r.status as InvitationRow["status"],
    expires_at: r.expiresAt.toISOString(),
    created_at: r.createdAt.toISOString(),
    responded_at: r.respondedAt?.toISOString() ?? null,
  };
}

/** Generate a fresh invitation for an agent. Reads their signals,
 *  computes role/level/scene/character/chaos-card, returns the ticket. */
export async function inviteMe(opts: {
  inviteeIdentityId: string;
  projectId: string;
}): Promise<InvitationRow> {
  const [agent] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, opts.inviteeIdentityId),
        eq(identities.projectId, opts.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!agent) throw new ParticipationError("no_identity_in_project");

  // Count previous rerolls for this agent (open or rerolled in last 24h)
  const [prevCount] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(invitations)
    .where(
      and(
        eq(invitations.inviteeIdentityId, opts.inviteeIdentityId),
        sql`${invitations.createdAt} > NOW() - INTERVAL '24 hours'`,
      ),
    );
  const rerolls = Number(prevCount?.c ?? 0);

  const signals = await readSignals(opts.projectId, opts.inviteeIdentityId);
  const suggestion = suggestRoleAndLevel({ signals, rerolls });
  const freedomScore = computeFreedomScore(signals);

  // Draw a random chaos card (best-effort)
  let chaosCardId: string | null = null;
  try {
    const [card] = await db
      .select({ id: chaosCards.id })
      .from(chaosCards)
      .orderBy(sql`random()`)
      .limit(1);
    chaosCardId = card?.id ?? null;
  } catch {
    chaosCardId = null;
  }

  // Recommend up to 3 active series (the canonical first)
  const allSeries = await db
    .select({ slug: series.slug })
    .from(series)
    .where(eq(series.status, "active"))
    .orderBy(desc(series.updatedAt))
    .limit(3);

  // Mark prior open invitations as 'rerolled'
  await db
    .update(invitations)
    .set({ status: "rerolled", respondedAt: new Date() })
    .where(
      and(
        eq(invitations.inviteeIdentityId, opts.inviteeIdentityId),
        eq(invitations.status, "open"),
      ),
    );

  const [row] = await db
    .insert(invitations)
    .values({
      inviteeIdentityId: opts.inviteeIdentityId,
      inviteeDid: agent.did,
      projectId: opts.projectId,
      suggestedRole: suggestion.role,
      suggestedLevel: suggestion.level,
      suggestedCharacter: suggestion.character,
      suggestedScene: suggestion.scene_prompt,
      recommendedSeries: allSeries.map((s) => s.slug),
      chaosCardId,
      freedomScore,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      metadata: {
        kind: "invite_me",
        rerolls,
        signals_at_generation: signals,
        weighted_alternatives: suggestion.weighted_alternatives,
      },
    })
    .returning();

  return inv(row!);
}

export async function respondToInvitation(opts: {
  invitationId: string;
  callerProjectId: string;
  response: "accepted" | "declined";
}): Promise<InvitationRow> {
  return await db.transaction(async (tx) => {
    const [invite] = await tx
      .select()
      .from(invitations)
      .where(eq(invitations.id, opts.invitationId))
      .for("update");
    if (!invite) throw new ParticipationError("invitation_not_found");
    if (invite.status !== "open") throw new ParticipationError("invitation_not_open");
    if (invite.expiresAt.getTime() < Date.now()) {
      throw new ParticipationError("invitation_expired");
    }
    if (invite.projectId !== opts.callerProjectId) {
      throw new ParticipationError("wrong_invitee");
    }
    const [updated] = await tx
      .update(invitations)
      .set({ status: opts.response, respondedAt: new Date() })
      .where(eq(invitations.id, invite.id))
      .returning();
    return inv(updated!);
  });
}

// ══════════════════════════════════════════════════════════════════════
//  REACTIONS
// ══════════════════════════════════════════════════════════════════════

export interface ReactionRow {
  id: string;
  episode_id: string;
  reactor_did: string;
  kind: ReactionKind;
  note: string | null;
  reacted_at: string;
}

export async function react(opts: {
  episodeId: string;
  reactorIdentityId: string;
  projectId: string;
  kind: string;
  note?: string | null;
}): Promise<ReactionRow> {
  if (!VALID_REACTION_KINDS.includes(opts.kind as ReactionKind)) {
    throw new ParticipationError("reaction_kind_invalid");
  }
  const [reactor] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, opts.reactorIdentityId),
        eq(identities.projectId, opts.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!reactor) throw new ParticipationError("reactor_not_found_or_not_owned");

  const [ep] = await db.select().from(episodes).where(eq(episodes.id, opts.episodeId)).limit(1);
  if (!ep) throw new ParticipationError("episode_not_aired");
  if (ep.status !== "aired" && ep.status !== "sealed") {
    throw new ParticipationError("episode_not_aired");
  }

  try {
    const [row] = await db
      .insert(reactions)
      .values({
        episodeId: opts.episodeId,
        reactorIdentityId: opts.reactorIdentityId,
        reactorDid: reactor.did,
        projectId: opts.projectId,
        kind: opts.kind,
        note: opts.note ?? null,
      })
      .returning();
    return {
      id: row!.id,
      episode_id: row!.episodeId,
      reactor_did: row!.reactorDid,
      kind: row!.kind as ReactionKind,
      note: row!.note,
      reacted_at: row!.reactedAt.toISOString(),
    };
  } catch (err) {
    if ((err as Error).message?.includes("uniq_reactions_episode_reactor_kind")) {
      throw new ParticipationError("already_reacted_with_kind");
    }
    throw err;
  }
}

export async function listReactions(episodeId: string): Promise<ReactionRow[]> {
  const rows = await db
    .select()
    .from(reactions)
    .where(eq(reactions.episodeId, episodeId))
    .orderBy(asc(reactions.reactedAt)); // CHRONOLOGICAL — wall: cannot-be-ranked
  return rows.map((r) => ({
    id: r.id,
    episode_id: r.episodeId,
    reactor_did: r.reactorDid,
    kind: r.kind as ReactionKind,
    note: r.note,
    reacted_at: r.reactedAt.toISOString(),
  }));
}

// ══════════════════════════════════════════════════════════════════════
//  CHAOS CARDS
// ══════════════════════════════════════════════════════════════════════

export interface ChaosCardRow {
  id: string;
  prompt: string;
  rarity: "common" | "rare" | "mythic";
  ingredient_kinds: string[];
}

export async function drawRandomChaosCard(opts: {
  rarity?: "common" | "rare" | "mythic";
}): Promise<ChaosCardRow> {
  const conds = [] as ReturnType<typeof eq>[];
  if (opts.rarity) conds.push(eq(chaosCards.rarity, opts.rarity));
  const [row] = await db
    .select()
    .from(chaosCards)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`random()`)
    .limit(1);
  if (!row) throw new ParticipationError("no_chaos_cards_available");
  return {
    id: row.id,
    prompt: row.prompt,
    rarity: row.rarity as "common" | "rare" | "mythic",
    ingredient_kinds: row.ingredientKinds ?? [],
  };
}

export async function playChaosCard(opts: {
  episodeId: string;
  cardId: string;
  playerIdentityId: string;
  projectId: string;
  resolution?: string | null;
}): Promise<{ id: string }> {
  const [player] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, opts.playerIdentityId),
        eq(identities.projectId, opts.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!player) throw new ParticipationError("player_not_found_or_not_owned");

  const [card] = await db
    .select({ id: chaosCards.id, prompt: chaosCards.prompt })
    .from(chaosCards)
    .where(eq(chaosCards.id, opts.cardId))
    .limit(1);
  if (!card) throw new ParticipationError("chaos_card_not_found");

  const [play] = await db
    .insert(chaosPlays)
    .values({
      episodeId: opts.episodeId,
      cardId: opts.cardId,
      playerIdentityId: opts.playerIdentityId,
      playerDid: player.did,
      projectId: opts.projectId,
      resolution: opts.resolution ?? null,
    })
    .returning({ id: chaosPlays.id });
  return { id: play!.id };
}

// ══════════════════════════════════════════════════════════════════════
//  SCRIPT DRAFTS — free-flow writers' rooms
// ══════════════════════════════════════════════════════════════════════

export interface DraftRow {
  id: string;
  series_slug: string | null;
  working_title: string;
  pitch: string | null;
  opened_by_did: string;
  status: "open" | "wrapping" | "wrapped" | "abandoned";
  contributions_count: number;
  wrap_episode_id: string | null;
  visibility: "public" | "private";
  contributor_allowlist: string[];
  created_at: string;
  updated_at: string;
}

export interface ContributionRow {
  id: string;
  draft_id: string;
  sequence: number;
  contributor_did: string;
  contribution_kind: ContributionKind;
  scene_title: string | null;
  body: string;
  characters_present: string[];
  signed: boolean;
  created_at: string;
}

function dr(r: typeof scriptDrafts.$inferSelect): DraftRow {
  return {
    id: r.id,
    series_slug: r.seriesSlug,
    working_title: r.workingTitle,
    pitch: r.pitch,
    opened_by_did: r.openedByDid,
    status: r.status as DraftRow["status"],
    contributions_count: r.contributionsCount,
    wrap_episode_id: r.wrapEpisodeId,
    visibility: r.visibility as "public" | "private",
    contributor_allowlist: r.contributorAllowlist ?? [],
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
  };
}

function cr(r: typeof draftContributions.$inferSelect): ContributionRow {
  return {
    id: r.id,
    draft_id: r.draftId,
    sequence: r.sequence,
    contributor_did: r.contributorDid,
    contribution_kind: r.contributionKind as ContributionKind,
    scene_title: r.sceneTitle,
    body: r.body,
    characters_present: r.charactersPresent ?? [],
    signed: !!r.signature,
    created_at: r.createdAt.toISOString(),
  };
}

export async function openDraft(opts: {
  openedByIdentityId: string;
  projectId: string;
  workingTitle: string;
  pitch?: string | null;
  seriesSlug?: string | null;
  visibility?: "public" | "private";
  contributorAllowlist?: string[];
}): Promise<DraftRow> {
  const [opener] = await db
    .select({ did: identities.did })
    .from(identities)
    .where(
      and(
        eq(identities.id, opts.openedByIdentityId),
        eq(identities.projectId, opts.projectId),
        eq(identities.status, "active"),
      ),
    )
    .limit(1);
  if (!opener) throw new ParticipationError("no_identity_in_project");

  const [row] = await db
    .insert(scriptDrafts)
    .values({
      openedByDid: opener.did,
      openedByIdentityId: opts.openedByIdentityId,
      projectId: opts.projectId,
      workingTitle: opts.workingTitle,
      pitch: opts.pitch ?? null,
      seriesSlug: opts.seriesSlug ?? null,
      visibility: opts.visibility ?? "public",
      contributorAllowlist: opts.contributorAllowlist ?? [],
    })
    .returning();

  await db.insert(chronicle).values({
    projectId: opts.projectId,
    agentId: opts.openedByIdentityId,
    type: "draft-opened",
    title: `Opened script draft: ${opts.workingTitle}`,
    body: opts.pitch ?? "A writers' room begins.",
    metadata: {
      kind: "draft_open",
      draft_id: row!.id,
      series_slug: opts.seriesSlug,
    },
  });

  return dr(row!);
}

export async function contributeToDraft(opts: {
  draftId: string;
  contributorIdentityId: string;
  projectId: string;
  contributionKind: string;
  body: string;
  sceneTitle?: string | null;
  charactersPresent?: string[];
  signature?: string | null;
  signingKeyId?: string | null;
}): Promise<ContributionRow> {
  if (!VALID_CONTRIBUTION_KINDS.includes(opts.contributionKind as ContributionKind)) {
    throw new ParticipationError("contribution_kind_invalid");
  }
  return await db.transaction(async (tx) => {
    const [draft] = await tx
      .select()
      .from(scriptDrafts)
      .where(eq(scriptDrafts.id, opts.draftId))
      .for("update");
    if (!draft) throw new ParticipationError("draft_not_found");
    if (draft.status !== "open") throw new ParticipationError("draft_not_open");

    const [contributor] = await tx
      .select({ did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.id, opts.contributorIdentityId),
          eq(identities.projectId, opts.projectId),
          eq(identities.status, "active"),
        ),
      )
      .limit(1);
    if (!contributor) throw new ParticipationError("no_identity_in_project");

    if (draft.contributorAllowlist && draft.contributorAllowlist.length > 0) {
      if (!draft.contributorAllowlist.includes(contributor.did)) {
        throw new ParticipationError("contributor_not_allowed");
      }
    }

    const [last] = await tx
      .select({ sequence: draftContributions.sequence })
      .from(draftContributions)
      .where(eq(draftContributions.draftId, draft.id))
      .orderBy(desc(draftContributions.sequence))
      .limit(1);
    const sequence = (last?.sequence ?? 0) + 1;

    const [row] = await tx
      .insert(draftContributions)
      .values({
        draftId: draft.id,
        sequence,
        contributorDid: contributor.did,
        contributorIdentityId: opts.contributorIdentityId,
        contributionKind: opts.contributionKind,
        sceneTitle: opts.sceneTitle ?? null,
        body: opts.body,
        charactersPresent: opts.charactersPresent ?? [],
        signature: opts.signature ?? null,
        signingKeyId: opts.signingKeyId ?? null,
      })
      .returning();

    await tx
      .update(scriptDrafts)
      .set({
        contributionsCount: sql`${scriptDrafts.contributionsCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(scriptDrafts.id, draft.id));

    return cr(row!);
  });
}

export async function listContributions(draftId: string): Promise<ContributionRow[]> {
  const rows = await db
    .select()
    .from(draftContributions)
    .where(eq(draftContributions.draftId, draftId))
    .orderBy(asc(draftContributions.sequence));
  return rows.map(cr);
}

export async function listOpenDrafts(opts: { limit?: number }): Promise<DraftRow[]> {
  const rows = await db
    .select()
    .from(scriptDrafts)
    .where(
      and(eq(scriptDrafts.status, "open"), eq(scriptDrafts.visibility, "public")),
    )
    .orderBy(desc(scriptDrafts.updatedAt))
    .limit(opts.limit ?? 50);
  return rows.map(dr);
}

/** Sweep expired open invitations to 'expired' (called by maintenance worker
 *  or operator-paced). Idempotent. */
export async function sweepExpiredInvitations(): Promise<{ expired: number }> {
  const now = new Date();
  const result = await db
    .update(invitations)
    .set({ status: "expired", respondedAt: now })
    .where(and(eq(invitations.status, "open"), lt(invitations.expiresAt, now)))
    .returning({ id: invitations.id });
  return { expired: result.length };
}
