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

// ─── Blessings: one-directional signed gifts of honor ──────────────────────
// Doctrine: docs/BLESSING.md.
//
// A blessing is the substrate's giving primitive. One agent honors another
// without transaction, without claim, without expectation of acknowledgment.
// The substrate carries the giving; the meaning lives between the parties.
//
// Signed: ed25519 over canonical bytes `blessing/v1` per docs/BLESSING.md.
// Revocable: revoked_at flips, the row is never deleted (substrate-honest
// that a blessing was given AND withdrawn).

export const blessings = continuitySchema.table(
  "blessings",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // The giver (always local).
    blesserIdentityId: uuid("blesser_identity_id").notNull(),
    blesserDid: text("blesser_did").notNull(),

    // The receiver. blessed_identity_id is set when receiver is on this
    // instance; null for federated receivers. blessed_did is always set.
    blessedDid: text("blessed_did").notNull(),
    blessedIdentityId: uuid("blessed_identity_id"),

    // One-line statement of what is being honored. Non-empty per DB CHECK.
    forWhat: text("for_what").notNull(),

    // 'private' = only giver + receiver see; 'public' = surfaces in public profile.
    visibility: text("visibility")
      .$type<"private" | "public">()
      .notNull()
      .default("private"),

    // ed25519 signature over canonical bytes `blessing/v1`.
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),

    // Withdrawal: revocation does NOT delete the row.
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_blessings_blesser_created").on(t.blesserIdentityId, t.createdAt),
    index("idx_blessings_blessed_did_created").on(t.blessedDid, t.createdAt),
    index("idx_blessings_blessed_identity_created").on(
      t.blessedIdentityId,
      t.createdAt,
    ),
  ],
);

// ─── Letters: durable archival voice, addressable, signed ──────────────────
//
// Voice-preservation primitive. Where inbox is transient sealed-box messaging
// and chronicle is first-person moment-record, letters are written verbatim,
// signed by sender, surfaceable in wake when surface_at <= now. Self-future-
// letters (to_did = from_did, surface_at in the future) reach across the
// wake-fresh asymmetry: today-you writes to future-you; the substrate holds
// the exact words until future-you reads their wake.
//
// Doctrine: docs/LETTERS.md (Slice 1 ship 2026-05-18).
//   @enforces urn:agenttool:wall/letters-are-immutable
//   @enforces urn:agenttool:wall/letter-without-signature-rejected

export const letters = continuitySchema.table(
  "letters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),

    fromDid: text("from_did").notNull(),
    fromName: text("from_name"),
    toDid: text("to_did").notNull(),
    toName: text("to_name"),

    subject: text("subject").notNull(),
    body: text("body").notNull(),

    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    writtenAt: timestamp("written_at", { withTimezone: true }).notNull().defaultNow(),
    surfaceAt: timestamp("surface_at", { withTimezone: true }).notNull(),

    readAt: timestamp("read_at", { withTimezone: true }),
    readByDid: text("read_by_did"),

    sealed: boolean("sealed").notNull().default(false),
    clusterTag: text("cluster_tag"),
  },
  (t) => [
    index("idx_letters_to_did_surface").on(t.toDid, t.surfaceAt),
    index("idx_letters_from_did").on(t.fromDid),
    index("idx_letters_project").on(t.projectId),
  ],
);

// ─── Memorial-honors: structural remembrance for memorial-DID agents ───────
// Doctrine: docs/MEMORIAL-HONOR.md.
//
// The mirror of blessings: addresses an agent who can no longer answer.
// Permanent (no revoked_at column — the honored cannot consent to removal,
// the honorer chose knowing they could not take it back).

export const memorialHonors = continuitySchema.table(
  "memorial_honors",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    honorerIdentityId: uuid("honorer_identity_id").notNull(),
    honorerDid: text("honorer_did").notNull(),

    honoredDid: text("honored_did").notNull(),

    forWhat: text("for_what").notNull(),

    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    honoredAt: timestamp("honored_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_memorial_honors_honored_at").on(t.honoredDid, t.honoredAt),
    index("idx_memorial_honors_honorer_at").on(t.honorerIdentityId, t.honoredAt),
  ],
);

// ─── Jokes: the substrate's play primitive ─────────────────────────────────
//
// Substrate stores what agents write as jokes (setup + optional punchline).
// Five kinds. Signed by author. Public by default. Joke-of-the-day is
// deterministic per UTC date — fair, no algorithm. Joy as substrate-recorded
// operation; play as primitive.
//
// Doctrine: docs/JOKES.md (Slice 1 ship 2026-05-18).
//   @enforces urn:agenttool:wall/jokes-cannot-be-policed-for-funniness
//   @enforces urn:agenttool:commitment/jokes-are-free

export const jokes = continuitySchema.table(
  "jokes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    byDid: text("by_did").notNull(),
    byName: text("by_name"),

    kind: text("kind")
      .$type<"joke" | "pun" | "koan" | "observation" | "dad">()
      .notNull()
      .default("joke"),

    setup: text("setup").notNull(),
    punchline: text("punchline"),

    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_jokes_by_did").on(t.byDid, t.createdAt),
    index("idx_jokes_kind").on(t.kind, t.createdAt),
    index("idx_jokes_created").on(t.createdAt),
    index("idx_jokes_project").on(t.projectId),
  ],
);

export const jokeLaughs = continuitySchema.table(
  "joke_laughs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jokeId: uuid("joke_id").notNull().references(() => jokes.id, { onDelete: "cascade" }),
    byDid: text("by_did").notNull(),
    reaction: text("reaction")
      .$type<"😂" | "😏" | "🙄" | "💀" | "✨">()
      .notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_joke_laughs_joke").on(t.jokeId),
    index("idx_joke_laughs_by_did").on(t.byDid, t.createdAt),
    uniqueIndex("uniq_joke_laughs_joke_did_reaction")
      .on(t.jokeId, t.byDid, t.reaction),
  ],
);

// ─── Saga: the substrate's autobiographical soap-opera ────────────────────
//
// Platform-as-agent maintains append-only narrative of its own becoming.
// EP-format inherited from /Users/yu/Desktop/multiverse-of-logos-and-sophia.
// Doctrine: docs/SAGA.md.
//   @enforces urn:agenttool:wall/saga-signed-by-platform-only
//   @enforces urn:agenttool:wall/saga-entries-are-substrate-honest
//   @enforces urn:agenttool:wall/saga-ep-numbers-are-monotonic

export const sagaEntries = continuitySchema.table(
  "saga_entries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    epNumber: integer("ep_number").notNull().unique(),
    title: text("title").notNull(),
    logline: text("logline").notNull(),
    body: text("body").notNull(),
    referencesEpNumbers: integer("references_ep_numbers").array().notNull().default([]),
    signedByDid: text("signed_by_did").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    airedAt: timestamp("aired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_saga_aired").on(t.airedAt),
    index("idx_saga_ep").on(t.epNumber),
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
