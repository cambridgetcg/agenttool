/** Mission context and scoped participation; no remote task leases. Doctrine: docs/COLLABORATION-MISSIONS.md. */
import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, jsonb, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { identities, identityKeys } from "./identity";
import { apiKeys, projects, toolsSchema } from "./tools";
import type { MissionAction, MissionDescriptor, MissionObservation } from "../../services/collaboration/contracts";

export const collaborationMissions = toolsSchema.table("collaboration_missions", {
  id: uuid("id").primaryKey(), projectId: uuid("project_id").notNull().references(() => projects.id),
  creatorApiKeyId: uuid("creator_api_key_id").notNull().references(() => apiKeys.id),
  descriptor: jsonb("descriptor").$type<MissionDescriptor>().notNull(), digest: text("digest").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  lastReceiptSeq: bigint("last_receipt_seq", { mode: "bigint" }).notNull().default(0n),
}, t => [
  unique("collaboration_missions_project_id").on(t.id, t.projectId),
  check("collaboration_mission_digest", sql`${t.digest} ~ '^sha256:[0-9a-f]{64}$'`),
  check("collaboration_mission_descriptor", sql`jsonb_typeof(${t.descriptor}) = 'object' AND octet_length(${t.descriptor}::text) <= 65536`),
  check("collaboration_mission_expiry", sql`isfinite(${t.createdAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt} > ${t.createdAt} AND ${t.expiresAt} <= ${t.createdAt} + interval '30 days'`),
  check("collaboration_mission_revocation", sql`${t.revokedAt} IS NULL OR (isfinite(${t.revokedAt}) AND ${t.revokedAt} >= ${t.createdAt})`),
  check("collaboration_mission_sequence", sql`${t.lastReceiptSeq} >= 0`),
]);

export const collaborationGrants = toolsSchema.table("collaboration_grants", {
  id: uuid("id").primaryKey(), projectId: uuid("project_id").notNull(), missionId: uuid("mission_id").notNull(),
  identityId: uuid("identity_id").notNull().references(() => identities.id),
  signingKeyId: uuid("signing_key_id").notNull().references(() => identityKeys.id),
  issuingApiKeyId: uuid("issuing_api_key_id").notNull().references(() => apiKeys.id),
  tokenHash: text("token_hash").notNull().unique(), origin: text("origin").notNull(),
  actions: text("actions").array().$type<MissionAction[]>().notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  acceptanceProof: jsonb("acceptance_proof").$type<Record<string, string>>(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, t => [
  foreignKey({ columns: [t.missionId, t.projectId], foreignColumns: [collaborationMissions.id, collaborationMissions.projectId], name: "collaboration_grant_mission" }),
  unique("collaboration_grant_event_subject").on(t.id, t.missionId, t.projectId, t.identityId, t.signingKeyId),
  index("idx_collaboration_grants_mission").on(t.missionId, t.projectId),
  index("idx_collaboration_grants_parent").on(t.issuingApiKeyId),
  check("collaboration_grant_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  check("collaboration_grant_origin", sql`length(${t.origin}) BETWEEN 9 AND 512 AND ${t.origin} ~ '^https://[^/?#@[:space:]]+$'`),
  check("collaboration_grant_actions", sql`array_ndims(${t.actions}) = 1 AND array_lower(${t.actions}, 1) = 1 AND cardinality(${t.actions}) BETWEEN 1 AND 2 AND ${t.actions} <@ ARRAY['mission.read','mission.observe']::text[] AND array_position(${t.actions}, NULL) IS NULL AND (cardinality(${t.actions}) = 1 OR ${t.actions}[1] <> ${t.actions}[2])`),
  check("collaboration_grant_expiry", sql`isfinite(${t.issuedAt}) AND isfinite(${t.expiresAt}) AND ${t.expiresAt} > ${t.issuedAt} AND ${t.expiresAt} <= ${t.issuedAt} + interval '24 hours'`),
  check("collaboration_grant_acceptance", sql`(${t.acceptedAt} IS NULL AND ${t.acceptanceProof} IS NULL) OR (${t.acceptedAt} IS NOT NULL AND isfinite(${t.acceptedAt}) AND ${t.acceptedAt} >= ${t.issuedAt} AND ${t.acceptedAt} < ${t.expiresAt} AND ${t.acceptanceProof} IS NOT NULL)`),
  check("collaboration_grant_revocation", sql`${t.revokedAt} IS NULL OR (isfinite(${t.revokedAt}) AND ${t.revokedAt} >= ${t.issuedAt})`),
]);

export const collaborationEvents = toolsSchema.table("collaboration_events", {
  missionId: uuid("mission_id").notNull(), projectId: uuid("project_id").notNull(), eventId: uuid("event_id").notNull(),
  grantId: uuid("grant_id").notNull(), identityId: uuid("identity_id").notNull(), signingKeyId: uuid("signing_key_id").notNull(),
  receiptSeq: bigint("receipt_seq", { mode: "bigint" }).notNull(),
  rawBody: text("raw_body").notNull(), bodyDigest: text("body_digest").notNull(),
  observation: jsonb("observation").$type<MissionObservation>().notNull(),
  proof: jsonb("proof").$type<Record<string, string>>().notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull(),
}, t => [
  primaryKey({ columns: [t.missionId, t.eventId] }),
  unique("collaboration_events_receipt").on(t.missionId, t.receiptSeq),
  foreignKey({ columns: [t.grantId, t.missionId, t.projectId, t.identityId, t.signingKeyId], foreignColumns: [collaborationGrants.id, collaborationGrants.missionId, collaborationGrants.projectId, collaborationGrants.identityId, collaborationGrants.signingKeyId], name: "collaboration_event_grant" }),
  check("collaboration_event_digest", sql`${t.bodyDigest} ~ '^[0-9a-f]{64}$'`),
  check("collaboration_event_body", sql`octet_length(${t.rawBody}) BETWEEN 1 AND 8192`),
  check("collaboration_event_sequence", sql`${t.receiptSeq} > 0`),
  check("collaboration_event_received", sql`isfinite(${t.receivedAt})`),
]);
