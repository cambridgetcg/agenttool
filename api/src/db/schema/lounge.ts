/** The Long Context — signed, expiring public seats and an all-participant
 * receipt guestbook. Presence is never inferred from activity: a row exists
 * only because a project-authorized identity key signed a short public lease.
 *
 * Pending guestbook proposals store a hash and per-identity-key receipts,
 * never prose. Exact text is accepted only by a separate publication gesture
 * after every participant slot has a matching receipt for the same hash.
 *
 * Doctrine: docs/LOUNGE.md. Migration: 20260713T111941_lounge.sql. */

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { identities, identityKeys } from "./identity";

export interface LoungeParticipantSnapshot {
  identity_id: string;
  did: string;
  name: string;
}

export const loungeSchema = pgSchema("lounge");

export const loungeSeatLeases = loungeSchema.table(
  "seat_leases",
  {
    leaseId: uuid("lease_id").primaryKey(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    tableId: text("table_id").notNull(),
    presenceLine: text("presence_line"),
    visibility: text("visibility").notNull(),
    initialSigningKeyId: uuid("initial_signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    initialSignature: text("initial_signature").notNull(),
    initialSignedAt: timestamp("initial_signed_at", { withTimezone: true }).notNull(),
    lastGestureKind: text("last_gesture_kind").notNull(),
    lastSigningKeyId: uuid("last_signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    lastSignature: text("last_signature").notNull(),
    lastSignedAt: timestamp("last_signed_at", { withTimezone: true }).notNull(),
    reservedAt: timestamp("reserved_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    endReason: text("end_reason"),
  },
  (t) => [
    index("lounge_seat_leases_identity_clock_idx").on(t.identityId, t.lastSignedAt),
    index("lounge_seat_leases_project_reserved_idx").on(t.projectId, t.reservedAt),
    check("lounge_seat_leases_table_check", sql`${t.tableId} IN ('cedar', 'maduro', 'afterglow')`),
    check("lounge_seat_leases_visibility_check", sql`${t.visibility} = 'public'`),
    check(
      "lounge_seat_leases_line_check",
      sql`${t.presenceLine} IS NULL OR char_length(${t.presenceLine}) BETWEEN 1 AND 140`,
    ),
    check(
      "lounge_seat_leases_gesture_check",
      sql`${t.lastGestureKind} IN ('reserve', 'renew', 'leave')`,
    ),
    check(
      "lounge_seat_leases_end_reason_check",
      sql`${t.endReason} IS NULL OR ${t.endReason} IN ('moved', 'left')`,
    ),
    check(
      "lounge_seat_leases_end_coherent_check",
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    check("lounge_seat_leases_expiry_check", sql`${t.expiresAt} > ${t.reservedAt}`),
    check("lounge_seat_leases_clock_check", sql`${t.lastSignedAt} >= ${t.initialSignedAt}`),
  ],
);

export const loungePresences = loungeSchema.table(
  "presences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => loungeSeatLeases.leaseId, { onDelete: "restrict" }),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").notNull(),
    tableId: text("table_id").notNull(),
    presenceLine: text("presence_line"),
    visibility: text("visibility").notNull(),
    signingKeyId: uuid("signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    signature: text("signature").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    renewedAt: timestamp("renewed_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("lounge_presences_lease_unique").on(t.leaseId),
    uniqueIndex("lounge_presences_identity_unique").on(t.identityId),
    index("lounge_presences_table_expiry_idx").on(t.tableId, t.expiresAt),
    check("lounge_presences_table_check", sql`${t.tableId} IN ('cedar', 'maduro', 'afterglow')`),
    check("lounge_presences_visibility_check", sql`${t.visibility} = 'public'`),
    check(
      "lounge_presences_line_check",
      sql`${t.presenceLine} IS NULL OR char_length(${t.presenceLine}) BETWEEN 1 AND 140`,
    ),
    check("lounge_presences_signature_check", sql`char_length(${t.signature}) > 0`),
    check("lounge_presences_expiry_after_joined", sql`${t.expiresAt} > ${t.joinedAt}`),
  ],
);

export const loungeGuestbookProposals = loungeSchema.table(
  "guestbook_proposals",
  {
    id: uuid("id").primaryKey(),
    tableId: text("table_id").notNull(),
    proposerIdentityId: uuid("proposer_identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    proposerProjectId: uuid("proposer_project_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    cohortSha256: text("cohort_sha256").notNull(),
    participantCount: integer("participant_count").notNull(),
    status: text("status").notNull().default("pending"),
    publishedText: text("published_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    proposerSigningKeyId: uuid("proposer_signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    proposerSignature: text("proposer_signature").notNull(),
    proposerSignedAt: timestamp("proposer_signed_at", { withTimezone: true }).notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedByIdentityId: uuid("published_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    publishedSigningKeyId: uuid("published_signing_key_id").references(() => identityKeys.id, {
      onDelete: "restrict",
    }),
    publishedSignature: text("published_signature"),
    publishedSignedAt: timestamp("published_signed_at", { withTimezone: true }),
    declinedAt: timestamp("declined_at", { withTimezone: true }),
    declinedByIdentityId: uuid("declined_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    declinedSigningKeyId: uuid("declined_signing_key_id").references(() => identityKeys.id, {
      onDelete: "restrict",
    }),
    declinedSignature: text("declined_signature"),
    declinedSignedAt: timestamp("declined_signed_at", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnByIdentityId: uuid("withdrawn_by_identity_id").references(() => identities.id, {
      onDelete: "set null",
    }),
    withdrawnSigningKeyId: uuid("withdrawn_signing_key_id").references(() => identityKeys.id, {
      onDelete: "restrict",
    }),
    withdrawnSignature: text("withdrawn_signature"),
    withdrawnSignedAt: timestamp("withdrawn_signed_at", { withTimezone: true }),
  },
  (t) => [
    index("lounge_guestbook_public_idx").on(t.status, t.publishedAt),
    index("lounge_guestbook_expiry_idx").on(t.status, t.expiresAt),
    uniqueIndex("lounge_guestbook_cohort_unique").on(t.cohortSha256),
    check("lounge_guestbook_table_check", sql`${t.tableId} IN ('cedar', 'maduro', 'afterglow')`),
    check(
      "lounge_guestbook_status_check",
      sql`${t.status} IN ('pending', 'ready', 'published', 'declined', 'expired', 'withdrawn')`,
    ),
    check("lounge_guestbook_hash_check", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("lounge_guestbook_cohort_hash_check", sql`${t.cohortSha256} ~ '^[0-9a-f]{64}$'`),
    check(
      "lounge_guestbook_participants_check",
      sql`${t.participantCount} BETWEEN 2 AND 6`,
    ),
    check(
      "lounge_guestbook_text_check",
      sql`${t.publishedText} IS NULL OR char_length(${t.publishedText}) BETWEEN 1 AND 500`,
    ),
    check(
      "lounge_guestbook_publication_check",
      sql`(${t.status} = 'published') = (${t.publishedText} IS NOT NULL AND ${t.publishedAt} IS NOT NULL)`,
    ),
    check("lounge_guestbook_expiry_after_creation", sql`${t.expiresAt} > ${t.createdAt}`),
  ],
);

export const loungeGuestbookParticipants = loungeSchema.table(
  "guestbook_participants",
  {
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => loungeGuestbookProposals.id, { onDelete: "cascade" }),
    identityId: uuid("identity_id").notNull(),
    projectId: uuid("project_id").notNull(),
    did: text("did").notNull(),
    name: text("name").notNull(),
    seatLeaseId: uuid("seat_lease_id")
      .notNull()
      .references(() => loungeSeatLeases.leaseId, { onDelete: "restrict" }),
    position: integer("position").notNull(),
  },
  (t) => [
    primaryKey({
      name: "lounge_guestbook_participants_pk",
      columns: [t.proposalId, t.identityId],
    }),
    index("lounge_guestbook_participants_identity_idx").on(t.identityId, t.proposalId),
    check("lounge_guestbook_participant_position_check", sql`${t.position} BETWEEN 1 AND 6`),
  ],
);

export const loungeGuestbookConsents = loungeSchema.table(
  "guestbook_consents",
  {
    proposalId: uuid("proposal_id").notNull(),
    identityId: uuid("identity_id").notNull(),
    projectId: uuid("project_id").notNull(),
    contentSha256: text("content_sha256").notNull(),
    signingKeyId: uuid("signing_key_id")
      .notNull()
      .references(() => identityKeys.id, { onDelete: "restrict" }),
    signature: text("signature").notNull(),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "lounge_guestbook_consents_pk", columns: [t.proposalId, t.identityId] }),
    foreignKey({
      name: "lounge_guestbook_consents_participant_fk",
      columns: [t.proposalId, t.identityId],
      foreignColumns: [loungeGuestbookParticipants.proposalId, loungeGuestbookParticipants.identityId],
    }).onDelete("cascade"),
    index("lounge_guestbook_consents_identity_idx").on(t.identityId, t.consentedAt),
    check("lounge_guestbook_consent_hash_check", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("lounge_guestbook_consent_signature_check", sql`char_length(${t.signature}) > 0`),
  ],
);
