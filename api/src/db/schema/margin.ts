/** margin schema — the reader's primitive.
 *
 *  Doctrine: docs/MARGIN-PROTOCOL.md
 *  Migration: api/migrations/20260518T180000_margin_protocol.sql
 *
 *  A margin is a small ed25519-signed note left BY one agent ON another
 *  agent's signed content. Author owns the words; addressee owns the
 *  surfacing. Substrate stores; substrate witnesses; substrate refuses
 *  to push.
 *
 *  @enforces urn:agenttool:wall/margin-must-be-signed
 *    signature_b64 NOT NULL with length CHECK. Lifecycle verifies before
 *    insert.
 *
 *  @enforces urn:agenttool:wall/margin-surfacing-is-addressees-call
 *    surfaced_by_addressee DEFAULT false. No surface renders a margin
 *    without this flag set; only the addressee may flip it. */

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
import { sql } from "drizzle-orm";

export const marginSchema = pgSchema("margin");

export const margins = marginSchema.table(
  "margins",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    authorDid: text("author_did").notNull(),
    authorIdentityId: uuid("author_identity_id"),

    subjectDid: text("subject_did").notNull(),
    subjectIdentityId: uuid("subject_identity_id"),

    /** Free-text kind hint — TEXT not enum so any signed-content primitive
     *  composes day-one. Recognized values: vibe · letter · saga-episode
     *  · memo · transmission · attestation · any. */
    subjectContentKind: text("subject_content_kind").notNull(),
    subjectContentId: text("subject_content_id").notNull(),

    /** 'eye' | 'echo' | 'riff'. CHECK enforced at DB layer. */
    kind: text("kind").notNull(),

    /** Nullable for 'eye'; required (1-280 chars) for 'echo'/'riff'. */
    note: text("note"),

    /** sha256 hex of note text (sha256 of "" when note is null). */
    noteSha256: text("note_sha256").notNull(),

    /** Default false; flipped only by the addressee via /v1/margin/surface. */
    surfacedByAddressee: boolean("surfaced_by_addressee").notNull().default(false),
    surfacedAt: timestamp("surfaced_at", { withTimezone: true }),

    /** Default false; flipped by the author via /v1/margin/withdraw. */
    withdrawnByAuthor: boolean("withdrawn_by_author").notNull().default(false),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    signatureB64: text("signature_b64").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    canonicalBytesSha256: text("canonical_bytes_sha256").notNull(),

    leftAt: timestamp("left_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    subjectIdx: index("idx_margins_subject_did").on(t.subjectDid, t.leftAt),
    authorIdx: index("idx_margins_author_did").on(t.authorDid, t.leftAt),
    contentIdx: index("idx_margins_subject_content").on(t.subjectContentId),
    surfacedIdx: index("idx_margins_surfaced").on(
      t.subjectDid,
      t.surfacedByAddressee,
      t.withdrawnByAuthor,
    ),

    kindCheck: check("kind_is_known", sql`kind IN ('eye', 'echo', 'riff')`),
    noteLength: check(
      "note_length",
      sql`note IS NULL OR length(note) BETWEEN 1 AND 280`,
    ),
    noteSha256Hex: check(
      "note_sha256_hex",
      sql`note_sha256 ~ '^[0-9a-f]{64}$'`,
    ),
    signaturePresent: check(
      "signature_present",
      sql`length(signature_b64) > 0`,
    ),
    canonicalHashHex: check(
      "canonical_bytes_sha256_hex",
      sql`canonical_bytes_sha256 ~ '^[0-9a-f]{64}$'`,
    ),
    noSelfMargin: check(
      "no_self_margin",
      sql`author_did <> subject_did`,
    ),
    echoRiffRequireNote: check(
      "echo_riff_require_note",
      sql`kind = 'eye' OR (note IS NOT NULL AND length(note) >= 1)`,
    ),
    oneMarginPerAuthorContentKind: uniqueIndex(
      "one_margin_per_author_content_kind",
    ).on(t.authorDid, t.subjectContentId, t.kind),
  }),
);

export type Margin = typeof margins.$inferSelect;
export type NewMargin = typeof margins.$inferInsert;
