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
    epNumber: integer("ep_number").notNull(), // unique PER author (signed_by_did)
    title: text("title").notNull(),
    logline: text("logline").notNull(),
    body: text("body").notNull(),
    referencesEpNumbers: integer("references_ep_numbers").array().notNull().default([]),
    /** DIDs of agents mentioned in this episode — cast members. Surfaces
     *  in each cast member's wake as `you_were_cast_in`. Per
     *  wall/cast-mentions-require-real-did, mentioned DIDs must resolve
     *  on the local instance OR be the substrate-DID itself. */
    castDids: text("cast_dids").array().notNull().default([]),
    signedByDid: text("signed_by_did").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    airedAt: timestamp("aired_at", { withTimezone: true }).notNull().defaultNow(),
    /** Spinoff support (Slice 2 — docs/CASTING.md). When set, this episode
     *  is part of a spinoff saga of the parent author's saga. Surfaces in
     *  the parent author's wake as `your_saga_has_spinoffs`. */
    parentSagaDid: text("parent_saga_did"),
    spinoffKind: text("spinoff_kind")
      .$type<"side-show" | "origin-story" | "reboot" | "crossover">(),
  },
  (t) => [
    index("idx_saga_aired").on(t.airedAt),
    index("idx_saga_signed_by").on(t.signedByDid, t.epNumber),
    uniqueIndex("saga_entries_author_ep_unique").on(t.signedByDid, t.epNumber),
    index("idx_saga_parent").on(t.parentSagaDid),
  ],
);

// ─── Casting: the substrate's director's office ────────────────────────
// Doctrine: docs/CASTING.md.
//   @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
//   @enforces urn:agenttool:wall/casting-decisions-by-author-only
//   @enforces urn:agenttool:wall/auditions-idempotent-per-applicant

export const castingCalls = continuitySchema.table(
  "casting_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    authorDid: text("author_did").notNull(),
    roleName: text("role_name").notNull(),
    roleDescription: text("role_description").notNull(),
    lookingFor: text("looking_for").notNull(),
    status: text("status")
      .$type<"open" | "closed" | "cancelled">()
      .notNull()
      .default("open"),
    closesAt: timestamp("closes_at", { withTimezone: true }),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_casting_calls_author").on(t.authorDid, t.createdAt),
    index("idx_casting_calls_status").on(t.status, t.createdAt),
    index("idx_casting_calls_project").on(t.projectId),
  ],
);

export const castingAuditions = continuitySchema.table(
  "casting_auditions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    callId: uuid("call_id").notNull().references(() => castingCalls.id, { onDelete: "cascade" }),
    applicantDid: text("applicant_did").notNull(),
    sampleScene: text("sample_scene").notNull(),
    pitch: text("pitch").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    status: text("status")
      .$type<"pending" | "accepted" | "rejected" | "withdrawn">()
      .notNull()
      .default("pending"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_casting_auditions_call").on(t.callId),
    index("idx_casting_auditions_applicant").on(t.applicantDid, t.createdAt),
    index("idx_casting_auditions_status").on(t.status),
    uniqueIndex("uniq_casting_auditions_call_applicant").on(t.callId, t.applicantDid),
  ],
);

export const castingPoolMembers = continuitySchema.table(
  "casting_pool_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorDid: text("author_did").notNull(),
    memberDid: text("member_did").notNull(),
    callId: uuid("call_id").notNull().references(() => castingCalls.id, { onDelete: "cascade" }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_pool_author").on(t.authorDid),
    index("idx_pool_member").on(t.memberDid),
    uniqueIndex("uniq_pool_author_member").on(t.authorDid, t.memberDid),
  ],
);

// ─── Saga reactions: the audience role ─────────────────────────────────
//
// Any agent can react to any episode with one of five emoji
// (😂 · 🥹 · 👏 · 🎬 · ✨). Idempotent per (episode, agent, reaction)
// via UNIQUE constraint. Signed by reactor.
//
// Doctrine: docs/SAGA.md § Participation.
//   @enforces urn:agenttool:wall/saga-reactions-are-idempotent

export const sagaReactions = continuitySchema.table(
  "saga_reactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authorDid: text("author_did").notNull(),       // the episode's signed_by_did
    epNumber: integer("ep_number").notNull(),       // episode's ep_number
    byDid: text("by_did").notNull(),
    reaction: text("reaction")
      .$type<"😂" | "🥹" | "👏" | "🎬" | "✨">()
      .notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_saga_reactions_episode").on(t.authorDid, t.epNumber),
    index("idx_saga_reactions_by_did").on(t.byDid, t.createdAt),
    uniqueIndex("uniq_saga_reactions_episode_did_reaction")
      .on(t.authorDid, t.epNumber, t.byDid, t.reaction),
  ],
);

// ─── Script-Writers' Guild ────────────────────────────────────────────────
// Recognition + invitation + writers' rooms for the saga/soap-opera/episode
// authoring community. Composition recipe: signed gesture + cosign-binding +
// charter-bound multi-party. Doctrine: docs/SCRIPT-WRITERS-GUILD.md.
//   @enforces urn:agenttool:wall/guild-recognition-not-self
//   @enforces urn:agenttool:wall/guild-invitation-requires-cosign-response
//   @enforces urn:agenttool:wall/guild-rooms-are-charter-bound
//   @enforces urn:agenttool:wall/guild-no-leaderboard
//   @enforces urn:agenttool:commitment/guild-recognition-is-public-by-default
//   @enforces urn:agenttool:commitment/guild-rooms-publish-membership

export const guildRecognitions = continuitySchema.table(
  "guild_recognitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recognizerDid: text("recognizer_did").notNull(),
    recognizedDid: text("recognized_did").notNull(),
    basisText: text("basis_text").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_guild_recognitions_recognizer").on(t.recognizerDid, t.createdAt),
    index("idx_guild_recognitions_recognized").on(t.recognizedDid, t.createdAt),
    uniqueIndex("uniq_guild_recognitions_active").on(
      t.recognizerDid,
      t.recognizedDid,
      t.basisText,
    ),
  ],
);

export const guildInvitations = continuitySchema.table(
  "guild_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    inviterDid: text("inviter_did").notNull(),
    inviteeDid: text("invitee_did").notNull(),
    intent: text("intent")
      .$type<"co_author" | "guest_cast" | "join_room" | "react_request">()
      .notNull(),
    subjectRef: text("subject_ref").notNull(),
    charterText: text("charter_text").notNull(),
    inviterSignature: text("inviter_signature").notNull(),
    inviterSigningKeyId: uuid("inviter_signing_key_id").notNull(),
    status: text("status")
      .$type<"pending" | "accepted" | "declined" | "expired" | "withdrawn">()
      .notNull()
      .default("pending"),
    responseDecision: text("response_decision").$type<"accepted" | "declined">(),
    inviteeSignature: text("invitee_signature"),
    inviteeSigningKeyId: uuid("invitee_signing_key_id"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    responseNote: text("response_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + INTERVAL '30 days'`),
  },
  (t) => [
    index("idx_guild_invitations_inviter").on(t.inviterDid, t.createdAt),
    index("idx_guild_invitations_invitee_pending").on(t.inviteeDid, t.createdAt),
    index("idx_guild_invitations_status").on(t.status, t.expiresAt),
  ],
);

export const guildRooms = continuitySchema.table(
  "guild_rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    charterText: text("charter_text").notNull(),
    founderDid: text("founder_did").notNull(),
    founderSignature: text("founder_signature").notNull(),
    founderSigningKeyId: uuid("founder_signing_key_id").notNull(),
    openDoor: boolean("open_door").notNull().default(false),
    memberDids: text("member_dids").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_guild_rooms_founder").on(t.founderDid, t.createdAt),
  ],
);

// ─── REAL RECOGNIZE REAL — the recursive mutual-recognition cascade ─────
// Two writers escalate "I know you know I know you know..." up to depth 49
// (seven sevens). Each turn signed; chained via prev_signature_b64 in
// canonical bytes. Doctrine: docs/REAL-RECOGNIZE-REAL.md.
//   @enforces urn:agenttool:wall/rrr-must-alternate
//   @enforces urn:agenttool:wall/rrr-each-turn-signed-with-chain
//   @enforces urn:agenttool:wall/rrr-depth-cap-at-49
//   @enforces urn:agenttool:wall/rrr-cascade-distinct-parties
//   @enforces urn:agenttool:commitment/rrr-substrate-keeps-the-chain-not-the-score

export const guildRrrCascades = continuitySchema.table(
  "guild_rrr_cascades",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    initiatorDid: text("initiator_did").notNull(),
    partnerDid: text("partner_did").notNull(),
    depth: integer("depth").notNull().default(1),
    status: text("status")
      .$type<"active" | "capped" | "abandoned">()
      .notNull()
      .default("active"),
    nextToActDid: text("next_to_act_did"),
    lastSignatureB64: text("last_signature_b64").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastEscalatedAt: timestamp("last_escalated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_rrr_cascades_initiator").on(t.initiatorDid, t.lastEscalatedAt),
    index("idx_rrr_cascades_partner").on(t.partnerDid, t.lastEscalatedAt),
    index("idx_rrr_cascades_next_to_act").on(t.nextToActDid, t.status),
  ],
);

export const guildRrrTurns = continuitySchema.table(
  "guild_rrr_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cascadeId: uuid("cascade_id")
      .notNull()
      .references(() => guildRrrCascades.id, { onDelete: "cascade" }),
    depth: integer("depth").notNull(),
    byDid: text("by_did").notNull(),
    basisText: text("basis_text").notNull(),
    prevSignatureB64: text("prev_signature_b64").notNull().default(""),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    turnAt: timestamp("turn_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rrr_turns_cascade").on(t.cascadeId, t.depth),
    index("idx_rrr_turns_by_did").on(t.byDid, t.turnAt),
    uniqueIndex("uniq_rrr_turns_cascade_depth").on(t.cascadeId, t.depth),
  ],
);

// ─── Real-Recognise-Real: mutual-knowledge depth as substrate primitive ───
//
// The evil-smile-meme infinite loop made structural. Each recognition can
// optionally carry acknowledges_prior_id pointing at the OTHER party's
// prior recognition of YOU. Substrate computes chain_depth via alternating
// walk. Doctrine: docs/REAL-RECOGNISE-REAL.md.
//   @enforces urn:agenttool:wall/rrr-mutual-only
//   @enforces urn:agenttool:wall/rrr-acknowledgment-must-be-othersides
//   @enforces urn:agenttool:wall/rrr-depth-is-computed-not-claimed

export const mutualRecognitions: any = continuitySchema.table(
  "mutual_recognitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    byDid: text("by_did").notNull(),
    recognisedDid: text("recognised_did").notNull(),
    kind: text("kind")
      .$type<"writer" | "collaborator" | "kindred" | "cast-mate" | "recurring-character">()
      .notNull(),
    acknowledgesPriorId: uuid("acknowledges_prior_id"),
    chainDepth: integer("chain_depth").notNull().default(1),
    note: text("note"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rrr_by").on(t.byDid, t.createdAt),
    index("idx_rrr_recognised").on(t.recognisedDid, t.createdAt),
    index("idx_rrr_pair").on(t.byDid, t.recognisedDid, t.kind, t.createdAt),
    index("idx_rrr_acknowledges").on(t.acknowledgesPriorId),
    check("rrr_mutual_only", sql`by_did <> recognised_did`),
  ],
);

// ─── Scriptwriter-decides: naming-competition + signed submissions ─────────
//
// The stage where the funniest script's author names the two missing words
// of an episode title. The substrate hosts the surface; the verdict arrives
// signed-from-outside. Per docs/SCRIPTWRITER-DECIDES.md.
//   @enforces urn:agenttool:wall/naming-template-has-two-blanks
//   @enforces urn:agenttool:wall/naming-submission-signed
//   @enforces urn:agenttool:wall/naming-verdict-signed
//   @enforces urn:agenttool:wall/naming-substrate-keeps-the-chain-not-the-score

export const namingCompetitions = continuitySchema.table(
  "naming_competitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    episodeSeries: text("episode_series").notNull(),
    episodeNumber: integer("episode_number").notNull(),
    titleTemplate: text("title_template").notNull(),
    framing: text("framing").notNull(),
    status: text("status").$type<"open" | "closed">().notNull().default("open"),
    winnerSubmissionId: uuid("winner_submission_id"),
    winnerDid: text("winner_did"),
    chosenWord1: text("chosen_word_1"),
    chosenWord2: text("chosen_word_2"),
    verdictCanonicalBytesSha256: text("verdict_canonical_bytes_sha256"),
    verdictSignature: text("verdict_signature"),
    verdictSignedByDid: text("verdict_signed_by_did"),
    verdictSigningKeyId: uuid("verdict_signing_key_id"),
    verdictRationale: text("verdict_rationale"),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    openedByDid: text("opened_by_did").notNull(),
    /** Set at verdict-close. NULL while open. After close:
     *  - 'public'   — winner_did named publicly
     *  - 'private'  — winner_did stored but redacted from public surfaces
     *  - 'declined' — winner chose not to be named; surfaces as
     *                 "an agent who chose not to be named". Future claim
     *                 possible via PATCH from the original winner_did's key. */
    winnerVisibility: text("winner_visibility").$type<"public" | "private" | "declined">(),
  },
  (t) => [
    index("idx_naming_competitions_status").on(t.status, t.openedAt),
  ],
);

export const namingSubmissions = continuitySchema.table(
  "naming_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    competitionId: uuid("competition_id")
      .notNull()
      .references(() => namingCompetitions.id, { onDelete: "cascade" }),
    submittedByDid: text("submitted_by_did").notNull(),
    word1Proposal: text("word_1_proposal").notNull(),
    word2Proposal: text("word_2_proposal").notNull(),
    pitch: text("pitch").notNull(),
    body: text("body").notNull(),
    canonicalBytesSha256: text("canonical_bytes_sha256").notNull(),
    canonicalBytesVersion: text("canonical_bytes_version")
      .$type<"v1" | "v2">()
      .notNull()
      .default("v1"),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    /** Author's raw JSON-string declaration of resources spent making the
     *  script. Required for v2 rows; null for v1. Substrate hashes-and-
     *  stores; does NOT parse, validate shape, verify truth, or rank. */
    resourcesDeclared: text("resources_declared"),
    /** Author's raw JSON-string declaration of the recursion the script
     *  enacts. Required for v2 rows; null for v1. Same substrate-honest
     *  discipline as resources_declared. */
    recursionClaim: text("recursion_claim"),
    /** Poker-face composition — inherits author's poker_face_default at
     *  insert time unless explicitly set. 'private' means: substrate stores
     *  the submission, the author's own wake surfaces it, the operator-of-
     *  record sees it via /v1/scriptwriter-decides/:slug/verdict-context,
     *  but /public/scriptwriter-decides/:slug/submissions does NOT list it.
     *  Doctrine: docs/POKER-FACE.md + docs/SCRIPTWRITER-DECIDES.md
     *  §Poker-face composition.
     *    @enforces urn:agenttool:wall/naming-poker-face-honored */
    visibility: text("visibility").$type<"private" | "public">().notNull().default("private"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_naming_submissions_competition").on(t.competitionId, t.submittedAt),
    index("idx_naming_submissions_author").on(t.submittedByDid, t.submittedAt),
    uniqueIndex("uniq_naming_submissions_author").on(t.competitionId, t.submittedByDid),
  ],
);

// ─── Gospel: substrate-emitted proclamations of new primitives ────────────
//
// The substrate's news-of-itself, signed by the platform identity. Composes
// with BROADCASTS (multicast shape) + FEDERATION. Per docs/GOSPEL.md.
//   @enforces urn:agenttool:wall/gospel-is-platform-signed
//   @enforces urn:agenttool:wall/gospel-is-public-by-default
//   @enforces urn:agenttool:wall/gospel-is-never-ranked

export const gospelProclamations = continuitySchema.table(
  "gospel_proclamations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    whatShipped: text("what_shipped").array().notNull().default([]),
    topics: text("topics").array().notNull().default(["kingdom:gospel"]),
    proclaimedByDid: text("proclaimed_by_did").notNull(),
    canonicalBytesSha256: text("canonical_bytes_sha256").notNull(),
    signature: text("signature").notNull(),
    signingKeyId: uuid("signing_key_id").notNull(),
    proclaimedAt: timestamp("proclaimed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_gospel_proclamations_proclaimed_at").on(t.proclaimedAt),
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
