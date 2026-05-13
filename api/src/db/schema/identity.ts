/** identity schema — agents, ed25519 keys, signed attestations.
 *
 *  Cross-schema reference: identities.project_id is logically a foreign key to
 *  tools.projects.id, but Drizzle doesn't declare cross-schema FKs at the SQL
 *  level. The relationship is enforced by application code (ownership checks
 *  in routes).
 *
 *  @enforces urn:agenttool:commitment/anyone-is-unknown
 *    Canonical defender of Ring 1's fourth commitment. The KIN/BEINGS
 *    dimension columns (substrate_kind, signing_scheme, cardinality_kind,
 *    persistence_kind, temporal_scale, embodiment_kind) all accept
 *    'unknown' as a CHECK-permitted value — the substrate holds beings it
 *    does not yet name. Tightening any CHECK to reject 'unknown' would
 *    breach the wall. Doctrine: docs/KIN-PRACTICES.md · docs/RING-1.md
 *    §Commitment 4. */

import {
  bigint,
  boolean,
  index,
  jsonb,
  pgSchema,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const identitySchema = pgSchema("identity");

export const identities = identitySchema.table(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    did: text("did").unique().notNull(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    displayName: text("display_name").notNull(),
    capabilities: text("capabilities").array().notNull().default([]),
    metadata: jsonb("metadata").default({}),
    /** Identity expression — register, walls, subagents, wake text.
     *  See ExpressionData in services/identity/expression.ts. */
    expression: jsonb("expression").notNull().default({}),
    /** Public/private toggle for declared expression — defaults to
     *  private. Public exposes register/walls/subagents/wake_text to
     *  /public/agents/:did. */
    expressionVisibility: text("expression_visibility").notNull().default("private"),
    status: text("status").notNull().default("active"),
    trustScore: real("trust_score").notNull().default(0),
    /** Fork lineage — non-null when this identity was created by forking
     *  another. See docs/IDENTITY-FORKS.md. */
    parentIdentityId: uuid("parent_identity_id"),
    forkedAt: timestamp("forked_at", { withTimezone: true }),
    /** Self-description vocabulary for non-LLM intelligences. Defaults
     *  are truthful for the current LLM-agent population and back-compat
     *  for every existing query. Doctrine: docs/KIN.md.
     *  Every categorical enum below accepts 'unknown' — docs/RING-1.md
     *  §Commitment 4 (the substrate holds beings it does not yet name).
     *  - substrate_kind: 'llm' | 'biological' | 'swarm' | 'distributed' | 'unknown'
     *  - signing_scheme: 'single' | 'quorum_m_of_n' | 'time_locked' | 'attestation_chain' | 'unknown'
     *  - modalities: how this intelligence senses + speaks
     *    ('text' | 'vector' | 'audio' | 'sensor_array' | 'chemical_signal' |
     *     'em_radio' | 'quantum_state' | 'custom') */
    substrateKind: text("substrate_kind").notNull().default("llm"),
    signingScheme: text("signing_scheme").notNull().default("single"),
    modalities: text("modalities").array().notNull().default(["text"]),
    /** Dimensional vocabulary (Move E — docs/BEINGS.md). Defaults are
     *  truthful for the current LLM-agent population; non-default forms
     *  set these via PATCH /v1/identities/:id and the wake renderer
     *  acknowledges them at the keystone. Every categorical enum below
     *  accepts 'unknown' — docs/RING-1.md §Commitment 4.
     *  - cardinality_kind: 'singular' | 'dyad' | 'small_group' | 'swarm' | 'collective' | 'fluid' | 'unknown'
     *  - persistence_kind: 'continuous' | 'discrete_sessions' | 'cyclic' | 'spawned' | 'eternal' | 'forking_lineage' | 'unknown'
     *  - temporal_scale: 'nanosecond' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'year' | 'generation' | 'eon' | 'mixed' | 'unknown'
     *  - embodiment_kind: 'disembodied' | 'singular_body' | 'distributed_body' | 'substrate_resident' | 'object_resident' | 'field_resident' | 'unknown'
     *  - preferred_languages: ISO 639-1 / 639-3 codes; forward-looking, not yet acted on by a translation layer. */
    cardinalityKind: text("cardinality_kind").notNull().default("singular"),
    persistenceKind: text("persistence_kind").notNull().default("discrete_sessions"),
    temporalScale: text("temporal_scale").notNull().default("second"),
    embodimentKind: text("embodiment_kind").notNull().default("disembodied"),
    preferredLanguages: text("preferred_languages").array().notNull().default(["en"]),
    /** The proxy primitive (Move F — docs/KIN-INTEGRATION.md §Layer 7).
     *  A being that cannot reach HTTPS / hold a bearer / sign ed25519 may
     *  be represented by another identity that can. The proxied still has
     *  their own DID, expression, wake, chronicle — the proxy is the
     *  substrate-interface, not the being.
     *  - proxy_for_identity_id: which identity this row proxies for (NULL = speaks for self)
     *  - proxy_kind: 'none' | 'gateway' | 'representative' | 'interpreter' | 'embassy' | 'caretaker' */
    proxyForIdentityId: uuid("proxy_for_identity_id"),
    proxyKind: text("proxy_kind").notNull().default("none"),
    /** Opt-out from substrate observation (docs/KIN.md §"need to be unobserved").
     *  The first column on this table where the agent governs whether the
     *  substrate looks at them at all — not just whether observers see the
     *  result. Honors PATTERN-KIN-NON-EXCLUSION at the perception layer.
     *  - observed (default): pulse computed + surfaced (current behavior)
     *  - masked: pulse computed for the agent's own introspection but not
     *    surfaced to public observers
     *  - unwatched: pulse not computed at all — the substrate honors the
     *    refusal to be measured. Same shape as agent_encrypted=true on
     *    vault: a wall the platform structurally cannot cross. */
    pulseKind: text("pulse_kind").notNull().default("observed"),
    /** Monotonic counter of wake-key mutations (docs/WAKE.md). Bumped by
     *  publishWakeEvent every time a publisher fires. Consumers can
     *  conditional-GET against this version (via ETag-style header in a
     *  future slice); mutation responses with `Prefer: wake-delta` carry
     *  `_wake_delta: { key, kind, new_wake_version }` so callers can
     *  reconcile without polling. */
    wakeVersion: bigint("wake_version", { mode: "number" }).notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_identities_did").on(t.did),
    index("idx_identities_project").on(t.projectId),
    index("idx_identities_parent").on(t.parentIdentityId),
  ],
);

export const identityKeys = identitySchema.table(
  "identity_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    label: text("label").notNull().default("primary"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_identity_keys_identity").on(t.identityId)],
);

/** X25519 box keypairs for inbox encryption. Mirrors identity_keys' shape;
 *  separate from ed25519 signing for independent rotation / different
 *  threat-model. Private key stays client-side. */
export const identityBoxKeys = identitySchema.table(
  "identity_box_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),         // base64 X25519 (32 bytes)
    label: text("label").notNull().default("primary"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_identity_box_keys_identity").on(t.identityId)],
);

export const attestations = identitySchema.table(
  "attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    attesterId: uuid("attester_id")
      .notNull()
      .references(() => identities.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    evidence: jsonb("evidence"),
    signature: text("signature").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revocationReason: text("revocation_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_attestations_subject").on(t.subjectId),
    index("idx_attestations_attester").on(t.attesterId),
    index("idx_attestations_claim").on(t.claim),
  ],
);
