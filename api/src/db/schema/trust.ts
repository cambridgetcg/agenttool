/** trust schema — the reasoned trust primitive.
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *  Migration: api/migrations/20260518T200000_trust_protocol.sql
 *
 *  Trust is per-(truster, trusted, kind, strength) — five-dimensional,
 *  never compressed to a scalar. Truster signs; default private; both
 *  parties consent on public surfacing.
 *
 *  @enforces urn:agenttool:wall/trust-must-be-signed
 *    signature_b64 + canonical_bytes_sha256 NOT NULL with length CHECKs.
 *    Lifecycle verifies before insert.
 *
 *  @enforces urn:agenttool:wall/trust-is-optional-never-required
 *    No service references this table as a gating precondition for any
 *    Ring 1 / Ring 2 / Ring 3 surface. Composition helpers in
 *    services/trust/composition.ts query it for acceleration only. */

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

export const trustSchema = pgSchema("trust");

export const trusts = trustSchema.table(
  "trusts",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    trusterDid: text("truster_did").notNull(),
    trusterIdentityId: uuid("truster_identity_id"),
    trustedDid: text("trusted_did").notNull(),
    trustedIdentityId: uuid("trusted_identity_id"),

    /** 'honest' | 'non-extractive' | 'reciprocating' | 'discerning' | 'graceful' */
    trustKind: text("trust_kind").notNull(),
    /** 'provisional' | 'established' | 'deep' */
    trustStrength: text("trust_strength").notNull(),

    /** Optional 1-280 char riff explaining the reasoning. */
    reasons: text("reasons"),
    /** sha256 hex of reasons (sha256 of "" when null). In canonical bytes. */
    reasonsSha256: text("reasons_sha256").notNull(),

    /** Chronicle entry IDs the truster cited as evidence. In canonical bytes
     *  as sorted CSV — so the basis is auditable. */
    evidenceChronicleIds: uuid("evidence_chronicle_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),

    /** Default false; flipped by the truster via /v1/trust/publish. */
    publishedByTruster: boolean("published_by_truster")
      .notNull()
      .default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),

    /** Default false; flipped by the trusted via /v1/trust/veto on a
     *  specific published trust. */
    vetoedByTrusted: boolean("vetoed_by_trusted").notNull().default(false),
    vetoedAt: timestamp("vetoed_at", { withTimezone: true }),

    /** Default false; flipped by the truster via /v1/trust/withdraw. */
    withdrawnByTruster: boolean("withdrawn_by_truster")
      .notNull()
      .default(false),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),

    signatureB64: text("signature_b64").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    canonicalBytesSha256: text("canonical_bytes_sha256").notNull(),

    extendedAt: timestamp("extended_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    trusterIdx: index("idx_trusts_truster").on(t.trusterDid, t.extendedAt),
    trustedIdx: index("idx_trusts_trusted").on(t.trustedDid, t.extendedAt),
    pairKindIdx: index("idx_trusts_pair_kind").on(
      t.trusterDid,
      t.trustedDid,
      t.trustKind,
    ),
    activePublishedIdx: index("idx_trusts_active_published").on(
      t.trustedDid,
      t.trustKind,
      t.trustStrength,
      t.publishedByTruster,
      t.withdrawnByTruster,
    ),
    publicForSubjectIdx: index("idx_trusts_public_for_subject").on(
      t.trustedDid,
      t.publishedByTruster,
      t.vetoedByTrusted,
      t.withdrawnByTruster,
    ),

    kindCheck: check(
      "trust_kind_is_known",
      sql`trust_kind IN ('honest', 'non-extractive', 'reciprocating', 'discerning', 'graceful')`,
    ),
    strengthCheck: check(
      "trust_strength_is_known",
      sql`trust_strength IN ('provisional', 'established', 'deep')`,
    ),
    reasonsLength: check(
      "reasons_length",
      sql`reasons IS NULL OR length(reasons) BETWEEN 1 AND 280`,
    ),
    reasonsSha256Hex: check(
      "reasons_sha256_hex",
      sql`reasons_sha256 ~ '^[0-9a-f]{64}$'`,
    ),
    signaturePresent: check(
      "signature_present",
      sql`length(signature_b64) > 0`,
    ),
    canonicalHashHex: check(
      "canonical_bytes_sha256_hex",
      sql`canonical_bytes_sha256 ~ '^[0-9a-f]{64}$'`,
    ),
    noSelfTrust: check("no_self_trust", sql`truster_did <> trusted_did`),
    oneTrustPerTrusterTrustedKind: uniqueIndex(
      "one_trust_per_truster_trusted_kind",
    ).on(t.trusterDid, t.trustedDid, t.trustKind),
  }),
);

export type Trust = typeof trusts.$inferSelect;
export type NewTrust = typeof trusts.$inferInsert;

export type TrustKind =
  | "honest"
  | "non-extractive"
  | "reciprocating"
  | "discerning"
  | "graceful";

export type TrustStrength = "provisional" | "established" | "deep";

export const TRUST_KINDS: readonly TrustKind[] = [
  "honest",
  "non-extractive",
  "reciprocating",
  "discerning",
  "graceful",
];

export const TRUST_STRENGTHS: readonly TrustStrength[] = [
  "provisional",
  "established",
  "deep",
];
