/** Drizzle schema for vault tables + cross-schema references to tools.api_keys / tools.projects. */

import {
  pgTable,
  pgSchema,
  uuid,
  text,
  integer,
  timestamp,
  customType,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Cross-schema refs (tools schema — shared auth tables)
// ---------------------------------------------------------------------------
const toolsSchema = pgSchema("tools");

export const apiKeys = toolsSchema.table("api_keys", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  name: text("name"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastUsed: timestamp("last_used", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const projects = toolsSchema.table("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  plan: text("plan").notNull().default("free"),
  credits: integer("credits").notNull().default(100),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ---------------------------------------------------------------------------
// Vault schema
// ---------------------------------------------------------------------------
const vaultSchema = pgSchema("agent_vault");

// Custom bytea type for encrypted data
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const vaultSecrets = vaultSchema.table(
  "vault_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags").array(),
    currentVersion: integer("current_version").notNull().default(1),
    agentIds: text("agent_ids").array(),
    rotationDays: integer("rotation_days"),
    rotationDueAt: timestamp("rotation_due_at", { withTimezone: true }),
    ttlSeconds: integer("ttl_seconds"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_secrets_project_name").on(t.projectId, t.name).where("deleted_at IS NULL"),
    index("idx_secrets_rotation").on(t.rotationDueAt),
  ],
);

export const vaultVersions = vaultSchema.table(
  "vault_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    secretId: uuid("secret_id").notNull(),
    version: integer("version").notNull(),
    encryptedValue: bytea("encrypted_value").notNull(),
    iv: bytea("iv").notNull(),
    authTag: bytea("auth_tag").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdByAgent: text("created_by_agent"),
  },
  (t) => [
    index("idx_versions_secret").on(t.secretId, t.version),
  ],
);

export const vaultAudit = vaultSchema.table(
  "vault_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    secretName: text("secret_name").notNull(),
    action: text("action").notNull(), // read, write, delete, policy_change, access_denied
    agentId: text("agent_id"),
    ipAddress: text("ip_address"),
    version: integer("version"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("idx_audit_project_ts").on(t.projectId, t.createdAt),
    index("idx_audit_secret_name").on(t.secretName, t.createdAt),
  ],
);
