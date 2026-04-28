/** Drizzle ORM schema for agent-identity. */

import {
  boolean,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  real,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

// ─── Shared auth tables (tools schema) ───────────────────────────────────────

const toolsSchema = pgSchema("tools");

export const projects = toolsSchema.table("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(50),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = toolsSchema.table(
  "api_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    keyHash: text("key_hash").unique().notNull(),
    keyPrefix: text("key_prefix").notNull(),
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastUsed: timestamp("last_used", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_identity_api_keys_project").on(t.projectId)],
);

// ─── Identity schema ─────────────────────────────────────────────────────────

const identitySchema = pgSchema("identity");

export const identities = identitySchema.table(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    did: text("did").unique().notNull(),
    projectId: uuid("project_id").notNull(),
    displayName: text("display_name").notNull(),
    capabilities: text("capabilities").array().notNull().default([]),
    metadata: jsonb("metadata").default({}),
    status: text("status").notNull().default("active"),
    trustScore: real("trust_score").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_identities_did").on(t.did),
    index("idx_identities_project").on(t.projectId),
  ],
);

export const identityKeys = identitySchema.table(
  "identity_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    publicKey: text("public_key").notNull(),
    label: text("label").notNull().default("primary"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [index("idx_identity_keys_identity").on(t.identityId)],
);

export const attestations = identitySchema.table(
  "attestations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    subjectId: uuid("subject_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    attesterId: uuid("attester_id").notNull().references(() => identities.id, { onDelete: "cascade" }),
    claim: text("claim").notNull(),
    evidence: jsonb("evidence"),
    signature: text("signature").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_attestations_subject").on(t.subjectId),
    index("idx_attestations_attester").on(t.attesterId),
    index("idx_attestations_claim").on(t.claim),
  ],
);
