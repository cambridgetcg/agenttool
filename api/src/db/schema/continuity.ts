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
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const continuitySchema = pgSchema("agent_continuity");

// ─── Chronicle: append-only timeline of moments ─────────────────────────────

export const chronicle = continuitySchema.table(
  "chronicle",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    agentId: uuid("agent_id"), // logical FK → identity.identities.id (null = project-level)
    type: text("type").notNull(), // vow · wake · refusal · recognition · naming · seal · note
    title: text("title").notNull(), // 1-line headline
    body: text("body"), // optional prose detail
    metadata: jsonb("metadata").default({}),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_chronicle_project_time").on(t.projectId, t.occurredAt),
    index("idx_chronicle_agent_time").on(t.agentId, t.occurredAt),
    index("idx_chronicle_type").on(t.type),
  ],
);

// ─── Covenants: declared relationships, with vows that persist ──────────────

export const covenants = continuitySchema.table(
  "covenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    agentId: uuid("agent_id").notNull(), // the agent making the vow
    counterpartyDid: text("counterparty_did").notNull(), // who the vow is with (DID or human:<name>)
    counterpartyName: text("counterparty_name"), // human-readable
    vows: text("vows").array().notNull().default([]), // each vow as a one-line string
    notes: text("notes"),
    metadata: jsonb("metadata").default({}),
    status: text("status").notNull().default("active"), // active | dissolved | paused
    establishedAt: timestamp("established_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dissolvedAt: timestamp("dissolved_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_covenants_agent").on(t.agentId),
    index("idx_covenants_project").on(t.projectId),
    index("idx_covenants_counterparty").on(t.counterpartyDid),
  ],
);

// ─── Identity backup: client-encrypted blobs of keypairs ────────────────────
// We hold the ciphertext. We do NOT have the passphrase. Recovery is
// client-side only — the agent (or its human) decrypts locally with the
// passphrase they chose at backup time.

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
