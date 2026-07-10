/** strand schema — strands of thought + opaque thought bytes (inner voice).
 *
 *  Doctrine: docs/STRANDS.md.
 *
 *  Structural posture: there is no plaintext thought-content column or
 *  server decrypt path. The API stores caller-supplied ciphertext/nonce
 *  strings but does not prove they are encrypted.
 *  Strand metadata (topic, mood) is plaintext by default; agents can opt
 *  to encrypt per item via the *_encrypted flags. */

import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const strandSchema = pgSchema("strand");

export const strands = strandSchema.table(
  "strands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    agentId: text("agent_id"),
    identityId: uuid("identity_id"),
    parentStrandId: uuid("parent_strand_id"),

    topic: text("topic"),
    topicEncrypted: boolean("topic_encrypted").notNull().default(false),
    mood: text("mood"),
    moodEncrypted: boolean("mood_encrypted").notNull().default(false),

    status: text("status").notNull().default("active"),
    importance: doublePrecision("importance"),
    /** Public/private toggle — defaults to private. Former public strand
     *  observer routes are currently unmounted. Thought content remains in
     *  caller-supplied ciphertext/nonce fields; encryption is not proven. */
    visibility: text("visibility").notNull().default("private"),

    lastThoughtAt: timestamp("last_thought_at", { withTimezone: true }),
    lastThoughtSeq: integer("last_thought_seq").notNull().default(0),
    nextRevisitAt: timestamp("next_revisit_at", { withTimezone: true }),

    stateCiphertext: text("state_ciphertext"),
    stateNonce: text("state_nonce"),

    metadata: jsonb("metadata").notNull().default({}),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_strands_project_status").on(t.projectId, t.status, t.lastThoughtAt),
    index("idx_strands_agent_status").on(t.agentId, t.status),
    index("idx_strands_revisit").on(t.nextRevisitAt),
  ],
);

export const thoughts = strandSchema.table(
  "thoughts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strandId: uuid("strand_id").notNull(),
    projectId: uuid("project_id").notNull(),
    agentId: text("agent_id"),
    sequenceNum: integer("sequence_num").notNull(),

    kind: text("kind"),
    kindEncrypted: boolean("kind_encrypted").notNull().default(false),

    ciphertext: text("ciphertext").notNull(),
    nonce: text("nonce").notNull(),

    refs: jsonb("refs"),

    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_thoughts_strand_seq").on(t.strandId, t.sequenceNum),
    index("idx_thoughts_strand_time").on(t.strandId, t.createdAt),
    index("idx_thoughts_project_time").on(t.projectId, t.createdAt),
  ],
);

/** Append-only mood transition log. Populated by a trigger on
 *  strand.strands; consumed by aggregatePulse() for mood_drift.
 *
 *  Migration `20260510T180000_strand_mood_history.sql` is authoritative
 *  for:
 *    - the partial index predicate `WHERE encrypted = false AND mood IS NOT NULL`
 *    - the `strand_id` FK with `ON DELETE CASCADE`
 *  Neither is expressible in Drizzle 0.36's `index()` / `references()`
 *  helpers as used elsewhere in this file. The Drizzle export is for
 *  type-safe query construction only. */
export const moodHistory = strandSchema.table(
  "mood_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    strandId: uuid("strand_id").notNull(),
    projectId: uuid("project_id").notNull(),
    identityId: uuid("identity_id"),
    mood: text("mood"),
    encrypted: boolean("encrypted").notNull().default(false),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_mood_history_identity_time").on(t.identityId, t.changedAt),
  ],
);
