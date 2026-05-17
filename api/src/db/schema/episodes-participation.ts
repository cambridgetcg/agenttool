/** episodes-participation schema — series · invitations · reactions ·
 *  chaos cards · chaos plays · script drafts · draft contributions.
 *
 *  All in the `episodes` schema (no new schema) — extensions to the
 *  episodes universe that make it participatory. */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { episodesSchema, episodes } from "./episodes";

export const series = episodesSchema.table(
  "series",
  {
    slug: text("slug").primaryKey(),
    title: text("title").notNull(),
    pitch: text("pitch").notNull(),
    showrunnerDid: text("showrunner_did").notNull(),
    showrunnerIdentityId: uuid("showrunner_identity_id").notNull(),
    projectId: uuid("project_id").notNull(),
    themes: text("themes").array().notNull().default([]),
    openToWriters: boolean("open_to_writers").notNull().default(true),
    status: text("status").notNull().default("active"),
    episodesCount: integer("episodes_count").notNull().default(0),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_series_showrunner").on(t.showrunnerIdentityId, t.createdAt)],
);

export const invitations = episodesSchema.table(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviteeIdentityId: uuid("invitee_identity_id").notNull(),
    inviteeDid: text("invitee_did").notNull(),
    projectId: uuid("project_id").notNull(),
    suggestedRole: text("suggested_role").notNull(),
    suggestedLevel: text("suggested_level").notNull(),
    suggestedCharacter: text("suggested_character"),
    suggestedScene: text("suggested_scene"),
    recommendedSeries: text("recommended_series").array().notNull().default([]),
    chaosCardId: uuid("chaos_card_id"),
    freedomScore: integer("freedom_score").notNull().default(0),
    status: text("status").notNull().default("open"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_invitations_invitee").on(t.inviteeIdentityId, t.createdAt),
    index("idx_invitations_open").on(t.inviteeIdentityId, t.status, t.expiresAt),
  ],
);

export const reactions = episodesSchema.table(
  "reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    reactorIdentityId: uuid("reactor_identity_id").notNull(),
    reactorDid: text("reactor_did").notNull(),
    projectId: uuid("project_id").notNull(),
    kind: text("kind").notNull(),
    note: text("note"),
    metadata: jsonb("metadata").notNull().default({}),
    reactedAt: timestamp("reacted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_reactions_episode_reactor_kind").on(
      t.episodeId,
      t.reactorIdentityId,
      t.kind,
    ),
    index("idx_reactions_episode").on(t.episodeId, t.reactedAt),
  ],
);

export const chaosCards = episodesSchema.table(
  "chaos_cards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prompt: text("prompt").notNull(),
    rarity: text("rarity").notNull().default("common"),
    ingredientKinds: text("ingredient_kinds").array().notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_chaos_cards_rarity").on(t.rarity)],
);

export const chaosPlays = episodesSchema.table(
  "chaos_plays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    cardId: uuid("card_id")
      .notNull()
      .references(() => chaosCards.id),
    playerIdentityId: uuid("player_identity_id").notNull(),
    playerDid: text("player_did").notNull(),
    projectId: uuid("project_id").notNull(),
    playedAt: timestamp("played_at", { withTimezone: true }).notNull().defaultNow(),
    resolution: text("resolution"),
    metadata: jsonb("metadata").notNull().default({}),
  },
  (t) => [
    index("idx_chaos_plays_episode").on(t.episodeId, t.playedAt),
    index("idx_chaos_plays_player").on(t.playerIdentityId, t.playedAt),
  ],
);

export const scriptDrafts = episodesSchema.table(
  "script_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesSlug: text("series_slug"),
    workingTitle: text("working_title").notNull(),
    pitch: text("pitch"),
    openedByDid: text("opened_by_did").notNull(),
    openedByIdentityId: uuid("opened_by_identity_id").notNull(),
    projectId: uuid("project_id").notNull(),
    status: text("status").notNull().default("open"),
    contributionsCount: integer("contributions_count").notNull().default(0),
    wrapEpisodeId: uuid("wrap_episode_id"),
    visibility: text("visibility").notNull().default("public"),
    contributorAllowlist: text("contributor_allowlist").array().notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_script_drafts_opener").on(t.openedByIdentityId, t.createdAt)],
);

export const draftContributions = episodesSchema.table(
  "draft_contributions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => scriptDrafts.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    contributorDid: text("contributor_did").notNull(),
    contributorIdentityId: uuid("contributor_identity_id").notNull(),
    contributionKind: text("contribution_kind").notNull(),
    sceneTitle: text("scene_title"),
    body: text("body").notNull(),
    charactersPresent: text("characters_present").array().notNull().default([]),
    signature: text("signature"),
    signingKeyId: uuid("signing_key_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_draft_contributions_seq").on(t.draftId, t.sequence),
    index("idx_draft_contributions_contributor").on(t.contributorIdentityId, t.createdAt),
  ],
);
