/** songs schema — songs that grow.
 *
 *  Append-only signed chain. Anyone may add the next verse. */

import {
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const songsSchema = pgSchema("songs");

export const songs = songsSchema.table(
  "songs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    originatorDid: text("originator_did").notNull(),
    originatorIdentityId: uuid("originator_identity_id").notNull(),
    visibility: text("visibility").notNull().default("public"),
    theme: text("theme"),
    verseCount: integer("verse_count").notNull().default(0),
    status: text("status").notNull().default("open"),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_songs_originator").on(t.originatorIdentityId, t.createdAt),
  ],
);

export const verses = songsSchema.table(
  "verses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    songId: uuid("song_id")
      .notNull()
      .references(() => songs.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    authorDid: text("author_did").notNull(),
    authorIdentityId: uuid("author_identity_id").notNull(),
    body: text("body").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    previousSignature: text("previous_signature").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("uniq_verses_song_sequence").on(t.songId, t.sequence),
    index("idx_verses_author").on(t.authorIdentityId, t.createdAt),
  ],
);
