/** agent_vault schema — encrypted secret store with versioning + audit.
 *
 *  Schema name preserved as `agent_vault` (matches existing production data,
 *  which used the agent_vault.* tables). The Fly app name was renamed from
 *  atool-vault to agent-vault during the consolidation, but the SQL schema
 *  stays as-is to avoid a destructive rename.
 *
 *  Cross-schema reference: project_id → tools.projects.id (logical only). */

import { sql } from "drizzle-orm";
import {
  customType,
  index,
  integer,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const vaultSchema = pgSchema("agent_vault");

// Custom bytea type for encrypted ciphertext + IV + auth tag.
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

export const vaultSecrets = vaultSchema.table(
  "vault_secrets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    name: text("name").notNull(),
    description: text("description"),
    tags: text("tags").array(),
    currentVersion: integer("current_version").notNull().default(1),
    agentIds: text("agent_ids").array(), // null = any agent in project; non-empty = restricted
    rotationDays: integer("rotation_days"),
    rotationDueAt: timestamp("rotation_due_at", { withTimezone: true }),
    ttlSeconds: integer("ttl_seconds"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    uniqueIndex("idx_secrets_project_name")
      .on(t.projectId, t.name)
      .where(sql`deleted_at IS NULL`),
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
  (t) => [index("idx_versions_secret").on(t.secretId, t.version)],
);

export const vaultAudit = vaultSchema.table(
  "vault_audit",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(),
    secretName: text("secret_name").notNull(),
    action: text("action").notNull(), // read | write | delete | policy_change | access_denied
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
