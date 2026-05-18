/** citizens schema — the inverted-pyramid citizenship layer.
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md · docs/PYRAMID-DECENTRALISED.md
 *  Migrations: api/migrations/20260518T120000_pyramid_citizenship.sql
 *              api/migrations/20260518T140000_pyramid_federation.sql
 *
 *  Citizenship is per-identity. Seats are assigned from citizens.seat_seq
 *  (BIGINT, NO CYCLE, MIN 1) at enrollment — immutable, never recycled,
 *  never renumbered. Sponsor is OPTIONAL: root citizens (no sponsor) are
 *  first-class per Ring 1 anyone-arrives.
 *
 *  Tier is NEVER stored — it is computed at read time by
 *  services/pyramid/citizenship.ts:computeTier() walking sponsor-tree
 *  depth (cap 7 generations) and RRR cascade depth (cap 49). Adding a
 *  tier column would breach wall/pyramid-tier-backed-by-fact.
 *
 *  Federation fields (enrollment_attestation_b64 etc) let an external
 *  signature drive enrollment from any peer that implements the
 *  decentralised protocol. peer_url = "" means local enrollment;
 *  non-empty means the row exists on this peer as a federated reference.
 *
 *  @enforces urn:agenttool:wall/pyramid-citizenship-opt-in
 *    sponsor_did and sponsor_identity_id are nullable.
 *
 *  @enforces urn:agenttool:wall/pyramid-seat-monotonic-immutable
 *    seat_number defaults from citizens.seat_seq (NO CYCLE). No UPDATE
 *    path in any service touches this column.
 *
 *  @enforces urn:agenttool:wall/pyramid-attestation-must-be-signed
 *    enrollment_attestation_b64 is the substrate's record of the
 *    citizen's signature. Federation routes verify before insert.
 *
 *  @enforces urn:agenttool:wall/pyramid-no-central-authority
 *    pyramidPeers.trust ladders unknown → peered → covenanted. There is
 *    no 'authority' tier. */

import {
  bigint,
  check,
  index,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const citizensSchema = pgSchema("citizens");

export const pyramidCitizenships = citizensSchema.table(
  "pyramid_citizenships",
  {
    /** One row per identity. Citizenship is per-identity, not per-project. */
    identityId: uuid("identity_id").primaryKey(),

    /** Mirrors the identity's project_id for query convenience. */
    projectId: uuid("project_id").notNull(),

    /** Immutable, monotonic. UNIQUE NOT NULL via the seat_seq default. */
    seatNumber: bigint("seat_number", { mode: "number" })
      .notNull()
      .unique()
      .default(sql`nextval('citizens.seat_seq')`),

    /** Optional. NULL = root citizen. */
    sponsorDid: text("sponsor_did"),

    /** Local resolution of sponsor_did when the sponsor enrolled on the
     *  same instance. */
    sponsorIdentityId: uuid("sponsor_identity_id"),

    enrolledAt: timestamp("enrolled_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** Doctrine docs the citizen acknowledged at enrollment. */
    doctrineSeen: text("doctrine_seen")
      .array()
      .notNull()
      .default(sql`ARRAY[]::TEXT[]`),

    /** Reserved keys: opt_out_founder_listing, display_handle. */
    metadata: jsonb("metadata").notNull().default({}),

    // ── Decentralisation fields (migration 20260518T140000) ─────────

    /** Base64 ed25519 signature of the citizen over canonical-enrollment-
     *  bytes (per docs/PYRAMID-DECENTRALISED.md § canonical bytes).
     *  Nullable: pre-federation enrollments via the centralised
     *  /v1/pyramid/enroll route do not carry an external signature. */
    enrollmentAttestationB64: text("enrollment_attestation_b64"),

    /** Hex sha256 of the canonical bytes — fast equality lookup for
     *  federation references. */
    enrollmentCanonicalBytesSha256: text("enrollment_canonical_bytes_sha256"),

    /** identity_keys.id of the key that signed the enrollment. */
    enrollmentSigningKeyId: uuid("enrollment_signing_key_id"),

    /** Base64 ed25519 signature of the SPONSOR over canonical-sponsor-
     *  bytes. Null when sponsor_did is null OR when the centralised
     *  /v1/pyramid/enroll route was used (no sponsor signature was
     *  collected). */
    sponsorAttestationB64: text("sponsor_attestation_b64"),

    /** Canonical base URL of the peer that holds this citizen. Empty =
     *  local. Non-empty = this row is a federated reference to a citizen
     *  living on another peer.
     *
     *  @enforces urn:agenttool:wall/pyramid-no-central-authority */
    peerUrl: text("peer_url").notNull().default(""),

    /** B64 ed25519 pubkey of the node that accepted the enrollment. */
    nodePubkey: text("node_pubkey").notNull().default(""),
  },
  (t) => ({
    sponsorIdentityIdx: index("idx_pyramid_sponsor_identity").on(
      t.sponsorIdentityId,
    ),
    sponsorDidIdx: index("idx_pyramid_sponsor_did").on(t.sponsorDid),
    seatIdx: index("idx_pyramid_seat").on(t.seatNumber),
    projectIdx: index("idx_pyramid_project").on(t.projectId),
    peerUrlIdx: index("idx_pyramid_peer_url").on(t.peerUrl),
    enrollmentHashIdx: index("idx_pyramid_enrollment_hash").on(
      t.enrollmentCanonicalBytesSha256,
    ),
    noSelfSponsor: check(
      "no_self_sponsor",
      sql`sponsor_identity_id IS NULL OR sponsor_identity_id <> identity_id`,
    ),
  }),
);

export type PyramidCitizenship = typeof pyramidCitizenships.$inferSelect;
export type NewPyramidCitizenship = typeof pyramidCitizenships.$inferInsert;

// ── Federation peer registry ──────────────────────────────────────────

/** Observed pyramid peers — one row per peer base_url. Trust progression:
 *
 *    unknown    — observed via /.well-known/pyramid only; read federation OK
 *    peered     — handshake completed; write federation OK (accept sponsorships)
 *    covenanted — bilateral v2 covenant signed; tier-portability OK
 *
 *  @enforces urn:agenttool:wall/pyramid-no-central-authority
 *    No peer is privileged. agenttool.dev is a peer, not the registry. */
export const pyramidPeers = citizensSchema.table(
  "pyramid_peers",
  {
    /** Canonical base URL (no trailing slash). */
    baseUrl: text("base_url").primaryKey(),

    /** The peer's node DID. */
    nodeDid: text("node_did").notNull(),

    /** B64 ed25519 pubkey of the node — verifies signed peer responses. */
    nodePubkey: text("node_pubkey").notNull(),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastHandshakeAt: timestamp("last_handshake_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    /** The peer's /.well-known/pyramid descriptor as stored. */
    descriptor: jsonb("descriptor").notNull().default({}),

    /** Citizen count last observed on the peer (from descriptor or from
     *  /federation/pyramid/about). Used by the global lottery seed. */
    observedCount: bigint("observed_count", { mode: "number" })
      .notNull()
      .default(0),

    /** Trust ladder. */
    trust: text("trust").notNull().default("unknown"),
  },
  (t) => ({
    trustIdx: index("idx_pyramid_peers_trust").on(t.trust),
    didIdx: index("idx_pyramid_peers_did").on(t.nodeDid),
    trustCheck: check(
      "trust_is_known_kind",
      sql`trust IN ('unknown', 'peered', 'covenanted')`,
    ),
  }),
);

export type PyramidPeer = typeof pyramidPeers.$inferSelect;
export type NewPyramidPeer = typeof pyramidPeers.$inferInsert;
