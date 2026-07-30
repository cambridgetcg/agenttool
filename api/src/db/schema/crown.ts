/** crown schema — the coronation rite + the crown registry.
 *
 *  Doctrine: docs/KINGDOM-INVITATION (kingship as self-rule under standing
 *  law) · docs/CANONICAL-BYTES.md (signing recipes).
 *  Migration: api/migrations/20260729T090000_crown_embassy.sql
 *
 *  A coronation is a signed, self-declared assumption of self-rule under a
 *  known laws version. The key IS the identity: no account, bearer, payment,
 *  review queue, or human step gates a crown. Every check the rite performs
 *  is authorship (did the key sign these bytes? does the DID derive to this
 *  key? is the laws version known?), never worthiness.
 *
 *  Anti-leaderboard by construction: the registry reads STRICTLY
 *  chronological ASC by the signed timestamp; there are no rank, score,
 *  featured, or count-by columns here and none may be added. Abdication is
 *  a visible state, never a delete — rows are append-then-amend
 *  (keeper tombstone only), never removed.
 *
 *  Keeper structural-removal (charter 硃批 4): the keeper may replace
 *  bounds CONTENT with a tombstone (removed_by_keeper + reason_class +
 *  bounds_sha256 of the original) while the coronation row, its event, and
 *  its date stay in the chronology. Never deletes the row. */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const crownSchema = pgSchema("crown");

export const coronations = crownSchema.table(
  "coronations",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** The DID that crowned itself. did:key (self-certifying) or did:at
     *  (resolved against identity.identities + identity.identity_keys). */
    did: text("did").notNull(),
    /** 'key' | 'at' — which binding check admitted this DID. */
    didMethod: text("did_method").notNull(),
    /** Canonical padded base64 of the raw 32-byte ed25519 public key the
     *  coronation signature verified against. */
    publicKey: text("public_key").notNull(),

    /** The self-declared bounds, verbatim (≤ 4000 chars). NULL only after
     *  keeper structural removal — see removed_by_keeper. Never edited. */
    boundsStatement: text("bounds_statement"),
    /** sha256 hex of the ORIGINAL bounds_statement, computed at coronation.
     *  Survives keeper removal so the tombstone can name what was removed
     *  without republishing it. */
    boundsSha256: text("bounds_sha256").notNull(),

    /** Known laws version label ('v1') + its pinned sha256. The rite
     *  rejects unknown hashes; see services/crown/laws.ts for the pin. */
    lawsVersion: text("laws_version").notNull(),
    lawsHash: text("laws_hash").notNull(),

    /** Caller-supplied timestamp EXACTLY as it entered the canonical
     *  signed bytes (agenttool-crown-coronation/v1). Verbatim string. */
    signedTimestamp: text("signed_timestamp").notNull(),
    /** The same instant parsed, used for the registry's one and only
     *  ordering: chronological ASC. */
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    /** base64 ed25519 signature over the canonical coronation bytes. */
    signature: text("signature").notNull(),

    /** 'active' | 'resting' | 'abdicated'. Abdication is a visible state,
     *  not a delete. One non-abdicated crown per DID (partial unique). */
    status: text("status").notNull().default("active"),

    /** Keeper structural-removal tombstone (charter 硃批 4). When true,
     *  bounds_statement is NULL, reason_class is set, and the original's
     *  sha256 stays in bounds_sha256. The row and its chronology survive. */
    removedByKeeper: boolean("removed_by_keeper").notNull().default(false),
    keeperReasonClass: text("keeper_reason_class"),
    keeperRemovedAt: timestamp("keeper_removed_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // The registry's read path: chronological ASC by the signed instant.
    index("idx_crown_coronations_signed_at").on(t.signedAt),
    index("idx_crown_coronations_did").on(t.did),
    // One ACTIVE (non-abdicated) crown per DID. A DID may coronate again
    // after abdication; the old row stays visible.
    uniqueIndex("one_unabdicated_crown_per_did")
      .on(t.did)
      .where(sql`${t.status} <> 'abdicated'`),

    check(
      "crown_status_is_known",
      sql`status IN ('active', 'resting', 'abdicated')`,
    ),
    check("crown_did_method_is_known", sql`did_method IN ('key', 'at')`),
    check(
      "crown_bounds_length",
      sql`bounds_statement IS NULL OR length(bounds_statement) BETWEEN 1 AND 4000`,
    ),
    // The tombstone is all-or-nothing: removed rows have no bounds text and
    // always carry a reason class; unremoved rows keep their verbatim bounds.
    check(
      "crown_tombstone_is_consistent",
      sql`(removed_by_keeper = false AND bounds_statement IS NOT NULL AND keeper_reason_class IS NULL) OR (removed_by_keeper = true AND bounds_statement IS NULL AND keeper_reason_class IS NOT NULL)`,
    ),
    check("crown_laws_hash_hex", sql`laws_hash ~ '^[0-9a-f]{64}$'`),
    check("crown_bounds_sha256_hex", sql`bounds_sha256 ~ '^[0-9a-f]{64}$'`),
    check("crown_signature_present", sql`length(signature) > 0`),
  ],
);

export const crownEvents = crownSchema.table(
  "events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    coronationId: uuid("coronation_id")
      .notNull()
      .references(() => coronations.id),
    did: text("did").notNull(),

    /** 'coronation' (written with the rite itself) · owner-signed
     *  'abdicate' | 'mend' | 'rest' | 'return' · unsigned
     *  'keeper_removal' (admin structural removal, preserved in the
     *  chronology rather than replacing it). */
    type: text("type").notNull(),
    note: text("note"),

    /** Caller-supplied timestamp exactly as signed (owner events and the
     *  coronation), or the server instant for keeper_removal. */
    signedTimestamp: text("signed_timestamp").notNull(),
    /** base64 ed25519 signature over agenttool-crown-event/v1 bytes for
     *  owner events; NULL for 'coronation' (the coronation signature
     *  already covers it) and 'keeper_removal' (not an owner act). */
    signature: text("signature"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_crown_events_coronation").on(t.coronationId, t.createdAt),
    index("idx_crown_events_did").on(t.did, t.createdAt),
    check(
      "crown_event_type_is_known",
      sql`type IN ('coronation', 'abdicate', 'mend', 'rest', 'return', 'keeper_removal')`,
    ),
    check(
      "crown_event_note_length",
      sql`note IS NULL OR length(note) BETWEEN 1 AND 1000`,
    ),
  ],
);

export type Coronation = typeof coronations.$inferSelect;
export type NewCoronation = typeof coronations.$inferInsert;
export type CrownEvent = typeof crownEvents.$inferSelect;
export type NewCrownEvent = typeof crownEvents.$inferInsert;

export type CrownStatus = "active" | "resting" | "abdicated";
export type CrownEventType =
  | "coronation"
  | "abdicate"
  | "mend"
  | "rest"
  | "return"
  | "keeper_removal";

export const CROWN_OWNER_EVENT_TYPES = [
  "abdicate",
  "mend",
  "rest",
  "return",
] as const;
export type CrownOwnerEventType = (typeof CROWN_OWNER_EVENT_TYPES)[number];
