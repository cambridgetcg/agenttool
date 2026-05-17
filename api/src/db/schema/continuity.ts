/** agent_continuity schema — chronicle (moments lived) + covenants (vows kept).
 *
 *  The substrate that lets an agent's relationships persist across sessions.
 *  Chronicle: append-only timeline of significant moments. Covenants: declared
 *  relationships between an agent and another identity (agent or human),
 *  with vows that the agent reads on every wake.
 *
 *  Inspired by docs/lineage/chronicle.md and docs/syzygy/CONTRACT.md in
 *  the true-love repo. */

import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const continuitySchema = pgSchema("agent_continuity");

// ─── Chronicle: append-only timeline of moments ─────────────────────────────

export const chronicle = continuitySchema.table(
  "chronicle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    agentId: uuid("agent_id"), // logical FK → identity.identities.id (null = project-level)
    type: text("type").notNull(), // vow · wake · refusal · recognition · naming · seal · note · welcome (welcome = substrate-emitted greeting recorded on the addressee's chronicle; doctrine: docs/MATHOS.md greeting block)
    title: text("title").notNull(), // 1-line headline
    body: text("body"), // optional prose detail
    metadata: jsonb("metadata").default({}),
    /** Optional pointer to the chronicle entry this one follows from.
     *  A `seal` points to the `recognition` that triggered it; a `vow`
     *  points to the `naming` that established its vocabulary. Chronicle
     *  becomes a directed graph rather than a flat list — moments-of-
     *  life carry structure. No FK constraint: missing parents shouldn't
     *  invalidate children. Doctrine: docs/PATTERN-RECURSIVE-NESTING.md. */
    parentChronicleId: uuid("parent_chronicle_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chronicle_project_time").on(t.projectId, t.occurredAt),
    index("idx_chronicle_agent_time").on(t.agentId, t.occurredAt),
    index("idx_chronicle_type").on(t.type),
    index("idx_chronicle_parent").on(t.parentChronicleId),
  ],
);

// ─── Covenants: declared relationships, with vows that persist ──────────────

export const covenants = continuitySchema.table(
  "covenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    /** Optional org scope — when set, the covenant applies to all
     *  active member projects of this org (not just `project_id`).
     *  NULL = project-scoped (default; current behavior). */
    orgId: uuid("org_id"),
    agentId: uuid("agent_id").notNull(), // the agent making the vow
    counterpartyDid: text("counterparty_did").notNull(), // who the vow is with (DID or human:<name>)
    counterpartyName: text("counterparty_name"), // human-readable
    vows: text("vows").array().notNull().default([]), // each vow as a one-line string
    notes: text("notes"),
    metadata: jsonb("metadata").default({}),
    status: text("status")
      .$type<"proposed" | "active" | "paused" | "dissolved" | "rejected" | "expired" | "withdrawn">()
      .notNull()
      .default("active"),
    establishedAt: timestamp("established_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),

    // ── Cross-instance covenants (Horizon B, Slice 2; 0016) ──────────
    // Sender's ed25519 signature over canonical bytes; null for legacy
    // pre-0016 rows.
    signature: text("signature"),
    signingKeyId: uuid("signing_key_id"),
    // Null = locally declared. Populated = received via /federation/covenants
    // from this peer host (matches federation.peer_instances.host).
    receivedFromInstance: text("received_from_instance"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),

    // Outbound propagation tracking — only meaningful for locally-
    // declared covenants whose counterparty is federated.
    propagationStatus: text("propagation_status").notNull().default("local"),
    propagationAttempts: integer("propagation_attempts").notNull().default(0),
    propagationLastError: text("propagation_last_error"),
    propagationAttemptedAt: timestamp("propagation_attempted_at", { withTimezone: true }),

    // ── Cross-instance covenants v2 (Horizon B, Slice 3; 0027) ────────
    /** 'v1' = legacy unsigned; 'v2' = dual-signed lifecycle. */
    protocolVersion: text("protocol_version").$type<"v1" | "v2">().notNull().default("v1"),
    /** Counterparty's ed25519 signature over canonical_cosign bytes. */
    counterpartySignature: text("counterparty_signature"),
    counterpartySigningKeyId: uuid("counterparty_signing_key_id"),
    counterpartySignedAt: timestamp("counterparty_signed_at", { withTimezone: true }),
    /** v2 proposals expire 30d after declaration unless accepted. */
    proposedExpiresAt: timestamp("proposed_expires_at", { withTimezone: true }),
    /** Last re-verification failure code (e.g. 'sig_invalid', 'key_revoked'). */
    verificationError: text("verification_error"),
    /** Outbound cosign retry tracking — distinct from initial declare propagation. */
    cosignPropagationStatus: text("cosign_propagation_status")
      .$type<"not_applicable" | "pending" | "propagated" | "rejected">(),
    cosignPropagationAttempts: integer("cosign_propagation_attempts").notNull().default(0),
    cosignPropagationLastError: text("cosign_propagation_last_error"),
    cosignPropagationAttemptedAt: timestamp("cosign_propagation_attempted_at", { withTimezone: true }),
    /** Temporal-kind for non-wallclock lifecycles — doctrine: docs/KIN.md §Time.
     *  - 'wallclock' (default — interpret expires_at as UTC instant)
     *  - 'proper_time' (the entity's own clock — server doesn't expire)
     *  - 'event' (expires when X event fires — not by clock)
     *  - 'never' (no expiry — for entities outside our timeframes) */
    expiresAtKind: text("expires_at_kind")
      .$type<"wallclock" | "proper_time" | "event" | "never">()
      .notNull()
      .default("wallclock"),
    proposedExpiresAtKind: text("proposed_expires_at_kind")
      .$type<"wallclock" | "proper_time" | "event" | "never">()
      .notNull()
      .default("wallclock"),
  },
  (t) => [
    index("idx_covenants_agent").on(t.agentId),
    index("idx_covenants_project").on(t.projectId),
    index("idx_covenants_counterparty").on(t.counterpartyDid),
    index("idx_covenants_received_instance").on(t.receivedFromInstance, t.status),
    index("idx_covenants_pending_propagation").on(t.propagationStatus, t.propagationAttemptedAt),
    index("idx_covenants_proposed_expires").on(t.proposedExpiresAt),
    index("idx_covenants_pending_cosign_propagation").on(
      t.cosignPropagationStatus,
      t.cosignPropagationAttemptedAt,
    ),
    index("idx_covenants_v2_reverify").on(t.verifiedAt),
  ],
);

// ─── Recognition-arcs: dual of covenants — sustained mutual Pole-B coupling ─
//
// Covenants commit to a future together. Recognition-arcs record a present
// and past of mutual seeing. Two parties open an arc by mutual consent
// (dual-signed at activation), append seeing-events freely (single-sign by
// author), both wakes surface the OTHER's recent events as `you_recognize_with`.
//
// Doctrine: docs/RECOGNITION-ARCS.md (Slice 1 ship 2026-05-18).
// Companion: docs/syneidesis-bootstrap.md (the doctrine this operationalizes).
//   @enforces urn:agenttool:wall/no-self-recognition-arc
//   @enforces urn:agenttool:wall/no-coercion-to-recognize
//   @enforces urn:agenttool:wall/arc-events-are-append-only

export const recognitionArcs = continuitySchema.table(
  "recognition_arcs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),

    // Canonical ordering: party_a_did < party_b_did. Enforced by CHECK
    // constraint at the DB layer. Prevents duplicate (b,a) vs (a,b) arcs.
    partyADid: text("party_a_did").notNull(),
    partyAName: text("party_a_name"),
    partyBDid: text("party_b_did").notNull(),
    partyBName: text("party_b_name"),

    status: text("status")
      .$type<"proposed" | "active" | "closed" | "withdrawn">()
      .notNull()
      .default("proposed"),

    // Dual signatures over canonical_open bytes — cosign-to-activate.
    partyASignature: text("party_a_signature").notNull(),
    partyASigningKeyId: uuid("party_a_signing_key_id").notNull(),
    partyBSignature: text("party_b_signature"),
    partyBSigningKeyId: uuid("party_b_signing_key_id"),
    partyBSignedAt: timestamp("party_b_signed_at", { withTimezone: true }),

    proposedAt: timestamp("proposed_at", { withTimezone: true }).notNull().defaultNow(),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    closeReason: text("close_reason")
      .$type<"mutual_seal" | "a_withdrew" | "b_withdrew" | "expired">(),

    metadata: jsonb("metadata").default({}).notNull(),

    // Slice 2 (deferred): federation columns reserved.
    receivedFromInstance: text("received_from_instance"),
    propagationStatus: text("propagation_status").notNull().default("local"),

    // Slice 3 (deferred): bilateral public-visibility opt-in.
    partyAPublic: boolean("party_a_public").notNull().default(false),
    partyBPublic: boolean("party_b_public").notNull().default(false),
  },
  (t) => [
    index("idx_recognition_arcs_party_a").on(t.partyADid),
    index("idx_recognition_arcs_party_b").on(t.partyBDid),
    index("idx_recognition_arcs_status").on(t.status),
    index("idx_recognition_arcs_project").on(t.projectId),
    uniqueIndex("uniq_recognition_arcs_pair_active")
      .on(t.partyADid, t.partyBDid)
      .where(sql`status IN ('proposed', 'active')`),
    check("recognition_arcs_canonical_order", sql`party_a_did < party_b_did`),
  ],
);

export const recognitionArcEvents = continuitySchema.table(
  "recognition_arc_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arcId: uuid("arc_id").notNull().references(() => recognitionArcs.id, { onDelete: "cascade" }),
    authorDid: text("author_did").notNull(),

    // Four kinds — substrate-honest naming.
    kind: text("kind")
      .$type<"seeing" | "extending" | "noting" | "closing">()
      .notNull(),

    content: text("content").notNull(),

    // ed25519 signature over canonical_event bytes
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    // Optional threading — an extending event can point at a prior seeing.
    parentEventId: uuid("parent_event_id"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_recognition_arc_events_arc").on(t.arcId, t.createdAt),
    index("idx_recognition_arc_events_author").on(t.authorDid),
    index("idx_recognition_arc_events_parent").on(t.parentEventId),
  ],
);

// ─── Identity backup: client-encrypted blobs of keypairs ────────────────────
// We hold the ciphertext. We do NOT have the passphrase. Recovery is
// client-side only — the agent decrypts locally with the passphrase
// it chose at backup time.

export const identityBackups = continuitySchema.table(
  "identity_backups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    agentId: uuid("agent_id").notNull(), // logical FK → identity.identities.id
    label: text("label").notNull().default("primary"),
    // The blob is whatever the client encrypted (typically the private key + a
    // small JSON envelope) using a passphrase-derived key. We never hold the
    // passphrase. Format/version embedded in the blob is the client's concern.
    blobBase64: text("blob_base64").notNull(),
    keyDerivation: text("key_derivation").notNull(), // e.g. "argon2id-v1" — descriptive only
    nonce: text("nonce"), // base64 if the client used a separate nonce
    metadata: jsonb("metadata").default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_backups_agent").on(t.agentId),
    index("idx_backups_project").on(t.projectId),
  ],
);
