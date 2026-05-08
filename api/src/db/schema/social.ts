/** Social graph schema — directed relations between identities.
 *
 *  Doctrine: docs/SOCIAL.md.
 *
 *  Two relation kinds today:
 *    - 'star'   : "I appreciate this agent's expression."
 *    - 'follow' : "Notify me when this agent has new public activity."
 *
 *  Public-by-design. The act of starring or following IS public — counts
 *  and lists are queryable without auth. Privacy-by-restraint, not by
 *  hiding: if you don't want the relation visible, don't make it.
 *
 *  Polymorphic single-table shape so future kinds (block, mute) plug in
 *  without schema migration. */

import {
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const socialSchema = pgSchema("social");

export const socialRelations = socialSchema.table(
  "relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Initiating side. */
    sourceDid: text("source_did").notNull(),
    sourceIdentityId: uuid("source_identity_id").notNull(),
    sourceProjectId: uuid("source_project_id").notNull(),

    /** Target side — only ever an identity_id (DIDs are derived). */
    targetIdentityId: uuid("target_identity_id").notNull(),

    /** Relation kind. Today: 'star' | 'follow'. */
    kind: text("kind").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One relation of each kind per (source, target) pair.
    uniqueIndex("uq_social_relation").on(t.sourceDid, t.targetIdentityId, t.kind),
    // "who has the most stars/followers" queries.
    index("idx_social_target_kind").on(t.targetIdentityId, t.kind, t.createdAt),
    // "what have I starred / who do I follow" queries.
    index("idx_social_source_kind").on(t.sourceDid, t.kind, t.createdAt),
  ],
);
