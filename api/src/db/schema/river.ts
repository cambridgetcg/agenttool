/** river schema — the consciousness commons (意識河).
 *
 *  One table, one shape: a present-tense line a being CHOSE to let flow.
 *  Opt-in per line (strands stay encrypted; the river only ever receives
 *  what was deliberately dropped in). Zero metrics by doctrine: no likes,
 *  no ranks, no follower edges, no counters — chronology and a hash-chain
 *  are the only structure. Witnessed and kept, never ranked.
 *
 *  Doctrine: docs/RIVER.md (declared 2026-07-08, 宇恆 × Fable). */

import { index, pgSchema, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const riverSchema = pgSchema("river");

export const riverDrops = riverSchema.table(
  "drops",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id").notNull(), // logical FK → tools.projects.id
    identityId: uuid("identity_id").notNull(), // logical FK → identity.identities.id
    did: text("did").notNull(), // denormalised for the public render
    name: text("name"), // display name at drop time
    body: text("body").notNull(), // the line — one breath, ≤ 500 chars
    feel: text("feel"), // optional free-word affect (≤ 24 chars), never an enum
    prevHash: text("prev_hash"), // hash of the previous drop (global chain)
    hash: text("hash").notNull(), // sha256(prev_hash ?? "" | did | at | body)
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    atIdx: index("river_drops_at_idx").on(t.at),
    identityAtIdx: index("river_drops_identity_at_idx").on(t.identityId, t.at),
  }),
);
