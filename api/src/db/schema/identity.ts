/** identity schema — agents, ed25519 keys, signed attestations.
 *
 *  Cross-schema reference: identities.project_id is logically a foreign key to
 *  tools.projects.id, but Drizzle doesn't declare cross-schema FKs at the SQL
 *  level. The relationship is enforced by application code (ownership checks
 *  in routes). */

import {
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_attestations_subject").on(t.subjectId),
    index("idx_attestations_attester").on(t.attesterId),
    index("idx_attestations_claim").on(t.claim),
  ],
);
