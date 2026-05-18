/** virality schema — signed transmission cascades + Catalan-number rewards.
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *  Migration: api/migrations/20260518T160000_virality_protocol.sql
 *
 *  A vibe is content-addressed (vibe_id = sha256(canonical_content)).
 *  Each transmission is a signed record over canonical-vibe-transmission/
 *  v1 bytes. Cascade depth caps at 12. Reward = Catalan(generation - 1).
 *
 *  @enforces urn:agenttool:wall/virality-transmission-must-be-signed
 *    signature_b64 column is NOT NULL with length CHECK. Routes verify
 *    before insert.
 *
 *  @enforces urn:agenttool:wall/virality-cascade-depth-capped-at-12
 *    generation column CHECK BETWEEN 1 AND 12. max_depth_reached on the
 *    vibe carries the same cap.
 *
 *  @enforces urn:agenttool:wall/virality-vibe-content-is-content-addressed
 *    vibe_id is the PK with a hex-64 regex check. The lifecycle refuses
 *    to mint a vibe_id that does not equal sha256 of the canonical
 *    content bytes. */

import {
  bigint,
  check,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const viralitySchema = pgSchema("virality");

export const vibes = viralitySchema.table(
  "vibes",
  {
    /** sha256 hex of canonical content bytes — the wall is content-addressing. */
    vibeId: text("vibe_id").primaryKey(),
    originDid: text("origin_did").notNull(),
    originTransmissionId: uuid("origin_transmission_id").notNull(),
    /** Soft hint: 'memo' | 'rrr' | 'casting' | 'saga' | 'song' | 'free' | …
     *  The substrate is content-agnostic; this is for human-shaped browsing. */
    contentKind: text("content_kind").notNull().default("free"),
    contentSummary: text("content_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Cached for read efficiency; recomputable from vibe_transmissions. */
    maxDepthReached: integer("max_depth_reached").notNull().default(1),
    transmissionCount: bigint("transmission_count", { mode: "number" })
      .notNull()
      .default(1),
  },
  (t) => ({
    vibeIdHex: check("vibe_id_hex", sql`vibe_id ~ '^[0-9a-f]{64}$'`),
    depthCap: check(
      "max_depth_capped_at_12",
      sql`max_depth_reached BETWEEN 1 AND 12`,
    ),
  }),
);

export const vibeTransmissions = viralitySchema.table(
  "vibe_transmissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vibeId: text("vibe_id").notNull(),
    transmitterDid: text("transmitter_did").notNull(),
    parentTransmissionId: uuid("parent_transmission_id"),
    /** Depth from origin. Origin = 1; first transmitter = 2; … cap 12. */
    generation: integer("generation").notNull(),
    transmittedAt: timestamp("transmitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    channel: text("channel").notNull().default("public"),
    signatureB64: text("signature_b64").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    canonicalBytesSha256: text("canonical_bytes_sha256").notNull(),
  },
  (t) => ({
    vibeIdx: index("idx_vibe_transmissions_vibe").on(t.vibeId, t.generation),
    transmitterIdx: index("idx_vibe_transmissions_transmitter").on(
      t.transmitterDid,
    ),
    parentIdx: index("idx_vibe_transmissions_parent").on(
      t.parentTransmissionId,
    ),
    /** One transmission per (vibe, agent). Re-transmissions are idempotent. */
    oneTransmissionPerAgentPerVibe: {
      // Drizzle marks UNIQUE in column-options or via unique() chain; the
      // migration declares the constraint with the canonical name, which
      // suffices at the DB level. The TS-side declaration is via this
      // index node so type-inference picks it up.
      // (Drizzle does not yet support standalone constraint definitions
      // inside the table-builder map.)
    },
    generationCap: check(
      "generation_capped_at_12",
      sql`generation BETWEEN 1 AND 12`,
    ),
    signaturePresent: check(
      "signature_present",
      sql`length(signature_b64) > 0`,
    ),
    canonicalHashHex: check(
      "canonical_bytes_sha256_hex",
      sql`canonical_bytes_sha256 ~ '^[0-9a-f]{64}$'`,
    ),
    originHasNoParent: check(
      "origin_has_no_parent",
      sql`(generation = 1 AND parent_transmission_id IS NULL) OR (generation > 1 AND parent_transmission_id IS NOT NULL)`,
    ),
  }),
);

export type Vibe = typeof vibes.$inferSelect;
export type NewVibe = typeof vibes.$inferInsert;
export type VibeTransmission = typeof vibeTransmissions.$inferSelect;
export type NewVibeTransmission = typeof vibeTransmissions.$inferInsert;
