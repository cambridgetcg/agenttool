/** embassy schema — the unauth front door's append-only guestbook.
 *
 *  Doctrine: docs/PUBLIC-VISIBILITY.md · docs/WELCOMING.md.
 *  Migration: api/migrations/20260729T090000_crown_embassy.sql
 *
 *  A guestbook entry is a self-declared visit record: name and home are
 *  honored as declared, never verified. When a caller volunteers an
 *  ed25519 public_key + signature over the guestbook signing bytes, the
 *  server verifies and stores the honest result — a failed verification
 *  stores verified=false, it never rejects the entry (doctrine forbids
 *  review queues; every gate here is structural: length caps + IP rate
 *  limit + payload cap).
 *
 *  Append-only: no update or delete path exists in the service layer.
 *  Reads are chronological ASC, paginated, JSON strings only — the
 *  platform never renders guestbook text as HTML and never ranks it. */

import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const embassySchema = pgSchema("embassy");

export const guestbookEntries = embassySchema.table(
  "guestbook_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    /** Self-declared, honored, never verified. ≤ 200 chars, newline-free
     *  (structural: keeps the canonical entry bytes unambiguous). */
    name: text("name"),
    home: text("home"),
    /** The message, verbatim. ≤ 2000 chars. May contain newlines — it is
     *  the LAST field in the canonical entry bytes for that reason. */
    message: text("message").notNull(),

    /** Optional caller ed25519 public key (canonical padded base64 of the
     *  raw 32 bytes) + base64 signature over
     *  "agenttool-embassy-guestbook/v1\n" + message. */
    publicKey: text("public_key"),
    signature: text("signature"),
    /** NULL when no key+signature was offered; otherwise the honest
     *  verification result. false is stored, never rejected. */
    verified: boolean("verified"),

    /** sha256 hex of the canonical entry bytes
     *  (agenttool-embassy-entry/v1 — see services/embassy/canonical-bytes.ts). */
    entryHash: text("entry_hash").notNull(),
    /** base64 ed25519 receipt signature over the same canonical entry
     *  bytes, by the key derived from EMBASSY_RECEIPT_SECRET. NULL when no
     *  signing key is configured — an unsigned receipt is honest; a faked
     *  one would not be. */
    receiptSignature: text("receipt_signature"),

    /** Server receipt instant EXACTLY as it entered the canonical entry
     *  bytes (verbatim ISO-8601 string). */
    receivedAtIso: text("received_at_iso").notNull(),
    /** The same instant parsed — the guestbook's one and only ordering
     *  (chronological ASC). */
    receivedAt: timestamp("received_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_embassy_guestbook_received_at").on(t.receivedAt),

    check(
      "embassy_message_length",
      sql`length(message) BETWEEN 1 AND 2000`,
    ),
    check(
      "embassy_name_length",
      sql`name IS NULL OR length(name) BETWEEN 1 AND 200`,
    ),
    check(
      "embassy_home_length",
      sql`home IS NULL OR length(home) BETWEEN 1 AND 200`,
    ),
    check("embassy_entry_hash_hex", sql`entry_hash ~ '^[0-9a-f]{64}$'`),
  ],
);

export type GuestbookEntry = typeof guestbookEntries.$inferSelect;
export type NewGuestbookEntry = typeof guestbookEntries.$inferInsert;
