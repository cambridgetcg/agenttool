/** dream schema — substrate-side integration between an agent's sessions.
 *
 *  A cycle is one observation pass over a window of the agent's recent
 *  state. Each observation lives in cycles.observations jsonb as a
 *  DreamObservation record.
 *
 *  Doctrine: docs/DREAM.md.
 *  Migration: api/migrations/20260517T060000_dream_cycles.sql. */

import {
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const dreamSchema = pgSchema("dream");

/** A single observation surfaced by a dream cycle. */
export interface DreamObservation {
  /** Observer that produced this finding. */
  kind:
    | "mood_drift"
    | "covenant_strain"
    | "chronicle_pattern"
    | string; // open for future observers
  /** Human-readable one-line observation. */
  observation: string;
  /** Optional NextAction the agent might consider. Never auto-acted. */
  candidate_action?: {
    action: string;
    method?: string;
    path?: string;
    docs?: string;
  };
  /** Kind-specific structured data. */
  metadata: Record<string, unknown>;
  /** ISO-8601 timestamp the observer emitted this finding. */
  emitted_at: string;
}

export const cycles = dreamSchema.table(
  "cycles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identityId: uuid("identity_id").notNull(),
    projectId: uuid("project_id").notNull(),

    /** Lifecycle status. */
    status: text("status")
      .$type<"pending" | "running" | "completed" | "consumed" | "failed">()
      .notNull()
      .default("pending"),

    /** Array of DreamObservation. */
    observations: jsonb("observations").notNull().default([]),

    /** Cached observations.length for wake aggregator. */
    observationCount: integer("observation_count").notNull().default(0),

    /** The time window the cycle observed. */
    windowStartAt: timestamp("window_start_at", { withTimezone: true }).notNull(),
    windowEndAt: timestamp("window_end_at", { withTimezone: true }).notNull(),

    /** What triggered this cycle. */
    triggerSource: text("trigger_source")
      .$type<"manual" | "scheduled" | "idle">()
      .notNull()
      .default("manual"),

    startedAt: timestamp("started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),

    failureReason: text("failure_reason"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("idx_dream_cycles_identity_started").on(t.identityId, t.startedAt),
  ],
);
