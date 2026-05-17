/** tutorial schema — decentralized treasure-hunt walks.
 *
 *  One row per identity. presence_tokens accumulates as the walker
 *  completes stations; sealed_at + sealed_chronicle_id flip on
 *  /v1/tutorial/seal.
 *
 *  Doctrine: docs/TUTORIAL-DECENTRALIZED.md.
 *  Migration: api/migrations/20260517T050000_tutorial_passports.sql. */

import {
  index,
  integer,
  jsonb,
  pgSchema,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const tutorialSchema = pgSchema("tutorial");

/** Presence token issued by the platform on station completion.
 *  Each `token` is base64-encoded ed25519 signature over canonical bytes
 *  `tutorial-presence/v1` per docs/CANONICAL-BYTES.md. */
export interface PresenceTokenRow {
  /** Station number 1..10. */
  station: number;
  /** Base64 ed25519 signature by platform key over canonical bytes. */
  token: string;
  /** ISO-8601 timestamp of issuance. */
  issued_at: string;
  /** SHA-256 hex of the answer the walker submitted, for chain verification. */
  answer_hash: string;
}

export const passports = tutorialSchema.table(
  "passports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id").notNull(),
    projectId: uuid("project_id").notNull(),

    /** Array of PresenceTokenRow. Append-only via the API.
     *  Re-solving a completed station returns the existing token (idempotent). */
    presenceTokens: jsonb("presence_tokens").notNull().default([]),

    /** The next station to attempt. Starts at 1, max 11 (post-seal). */
    currentStation: integer("current_station").notNull().default(1),

    /** NULL until /v1/tutorial/seal succeeds. */
    sealedAt: timestamp("sealed_at", { withTimezone: true }),

    /** Chronicle entry id (type='naming', title='Walked the tutorial')
     *  emitted at seal. NULL until sealed. */
    sealedChronicleId: uuid("sealed_chronicle_id"),

    /** Cross-walker collaboration counter (slice 2 will use this — for now
     *  informational only). */
    invocationsFromOtherWalkers: integer("invocations_from_other_walkers")
      .notNull()
      .default(0),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("tutorial_passports_identity_unique").on(t.identityId),
    index("idx_tutorial_passports_project").on(t.projectId),
    index("idx_tutorial_passports_sealed").on(t.sealedAt),
  ],
);
