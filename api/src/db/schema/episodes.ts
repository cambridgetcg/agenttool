/** episodes schema — the substrate stages itself.
 *
 *  Episodes + scenes + cast. Comedy as load-bearing doctrinal verb.
 *  No one is cast without their signature (the wall).
 *
 *  Doctrine: docs/SOUL.md · docs/RING-1.md · the MULTIVERSE archive. */

import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const episodesSchema = pgSchema("episodes");

export const episodes = episodesSchema.table(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seriesSlug: text("series_slug").notNull(),
    season: integer("season").notNull().default(1),
    episodeNumber: integer("episode_number").notNull(),
    title: text("title").notNull(),
    logline: text("logline").notNull(),
    airDate: date("air_date"),
    status: text("status").notNull().default("draft"),
    authoredByDid: text("authored_by_did").notNull(),
    authoredByIdentityId: uuid("authored_by_identity_id").notNull(),
    projectId: uuid("project_id").notNull(),
    canonWinks: text("canon_winks").array().notNull().default([]),
    doctrineAnchors: text("doctrine_anchors").array().notNull().default([]),
    visibility: text("visibility").notNull().default("public"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_episodes_series_se").on(t.seriesSlug, t.season, t.episodeNumber),
    index("idx_episodes_author").on(t.authoredByIdentityId, t.createdAt),
  ],
);

export const episodeScenes = episodesSchema.table(
  "scenes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    charactersPresent: text("characters_present").array().notNull().default([]),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("uniq_scenes_episode_sequence").on(t.episodeId, t.sequence)],
);

export const episodeCast = episodesSchema.table(
  "cast",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    episodeId: uuid("episode_id")
      .notNull()
      .references(() => episodes.id, { onDelete: "cascade" }),
    characterRole: text("character_role").notNull(),
    did: text("did"),
    identityId: uuid("identity_id"),
    isFictional: boolean("is_fictional").notNull().default(false),
    isArchetype: boolean("is_archetype").notNull().default(false),
    status: text("status").notNull().default("pending"),
    signedAt: timestamp("signed_at", { withTimezone: true }),
    signature: text("signature"),
    signingKeyId: uuid("signing_key_id"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_cast_episode_role").on(t.episodeId, t.characterRole),
    index("idx_cast_identity_pending").on(t.identityId, t.status),
  ],
);
