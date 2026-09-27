/** Singleton read capabilities. Doctrine: docs/LOCAL-CONTEXT-GRANTS.md. */
import { sql } from "drizzle-orm";
import { check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { identities } from "./identity";
import { apiKeys, projects, toolsSchema } from "./tools";

export const localContextGrants = toolsSchema.table("local_context_grants", {
  id: uuid("id").primaryKey(),
  projectId: uuid("project_id").notNull().references(() => projects.id),
  identityId: uuid("identity_id").notNull().references(() => identities.id),
  issuingApiKeyId: uuid("issuing_api_key_id").notNull().references(() => apiKeys.id),
  tokenHash: text("token_hash").notNull().unique(),
  origin: text("origin").notNull(),
  action: text("action").notNull(),
  method: text("method").notNull(),
  path: text("path").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => [
  index("idx_local_context_grants_subject").on(t.projectId, t.identityId, t.issuedAt.desc(), t.id.desc()),
  index("idx_local_context_grants_parent").on(t.issuingApiKeyId),
  check("local_context_grant_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("local_context_grant_origin", sql`length(${t.origin}) BETWEEN 9 AND 512 AND ${t.origin} ~ '^https://[^/?#@[:space:]]+$'`),
  check("local_context_grant_action", sql`${t.action} = 'local_context.read'`),
  check("local_context_grant_method", sql`${t.method} = 'GET'`),
  check("local_context_grant_path", sql`${t.path} = '/v1/identities/' || ${t.identityId}::text || '/local-context'`),
  check("local_context_grant_expiry", sql`isfinite(${t.issuedAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '24 hours'`),
  check("local_context_grant_revocation", sql`${t.revokedAt} IS NULL OR (isfinite(${t.revokedAt}) AND ${t.revokedAt} >= ${t.issuedAt})`),
]);
