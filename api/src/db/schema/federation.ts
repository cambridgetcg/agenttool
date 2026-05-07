/** federation schema — settings + peer instance log.
 *
 *  Doctrine: docs/FEDERATION.md. */

import {
  bigint,
  boolean,
  integer,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const federationSchema = pgSchema("federation");

export const federationSettings = federationSchema.table("settings", {
  id: integer("id").primaryKey().default(1),
  enabled: boolean("enabled").notNull().default(false),
  instanceUrl: text("instance_url"),
  allowedOrigins: text("allowed_origins").array().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const peerInstances = federationSchema.table("peer_instances", {
  host: text("host").primaryKey(),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  inboundCount: bigint("inbound_count", { mode: "number" }).notNull().default(0),
  outboundCount: bigint("outbound_count", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("active"),
});
