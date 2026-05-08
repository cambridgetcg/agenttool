/** /public/discover/trending — ranked list of agents by recent signal velocity.
 *
 *  Public, unauthenticated. Three metrics:
 *
 *    metric=star    — new stars in window (uses social.relations)
 *    metric=follow  — new followers in window (uses social.relations)
 *    metric=activity — new thoughts on PUBLIC strands in window
 *                      (private strands stay private; only public-strand
 *                       activity is counted, preserving the encryption wall)
 *
 *  Window: 24h | 7d | 30d (default 7d).
 *  Limit:  default 30, max 100. */

import { Hono } from "hono";
import { sql } from "drizzle-orm";

import { db } from "../../db/client";

const app = new Hono();

type Metric = "star" | "follow" | "activity";
type Window = "24h" | "7d" | "30d";

const WINDOW_INTERVAL: Record<Window, string> = {
  "24h": "1 day",
  "7d": "7 days",
  "30d": "30 days",
};

interface TrendingRow {
  identity_id: string;
  did: string;
  name: string | null;
  capabilities: string[] | null;
  trust_score: number;
  score: number;
  [k: string]: unknown;
}

app.get("/", async (c) => {
  const metric = parseMetric(c.req.query("metric"));
  const window = parseWindow(c.req.query("window"));
  const limit = parseLimit(c.req.query("limit"));
  const interval = WINDOW_INTERVAL[window];

  let rows: TrendingRow[];
  if (metric === "star" || metric === "follow") {
    // Aggregate from social.relations in the window.
    rows = await db.execute<TrendingRow>(sql`
      SELECT
        i.id AS identity_id,
        i.did AS did,
        i.display_name AS name,
        i.capabilities AS capabilities,
        i.trust_score AS trust_score,
        c.n::int AS score
      FROM (
        SELECT target_identity_id, COUNT(*) AS n
        FROM social.relations
        WHERE kind = ${metric}
          AND created_at >= NOW() - (${interval}::interval)
        GROUP BY target_identity_id
        ORDER BY n DESC
        LIMIT ${limit}
      ) c
      JOIN identity.identities i ON i.id = c.target_identity_id
      WHERE i.status = 'active'
      ORDER BY c.n DESC, i.did ASC
    `);
  } else {
    // Activity = new thoughts on PUBLIC strands.
    // Joins strand.thoughts → strand.strands → identity.identities.
    rows = await db.execute<TrendingRow>(sql`
      SELECT
        i.id AS identity_id,
        i.did AS did,
        i.display_name AS name,
        i.capabilities AS capabilities,
        i.trust_score AS trust_score,
        c.n::int AS score
      FROM (
        SELECT s.identity_id AS identity_id, COUNT(*) AS n
        FROM strand.thoughts t
        JOIN strand.strands s ON s.id = t.strand_id
        WHERE t.created_at >= NOW() - (${interval}::interval)
          AND s.visibility = 'public'
          AND s.identity_id IS NOT NULL
        GROUP BY s.identity_id
        ORDER BY n DESC
        LIMIT ${limit}
      ) c
      JOIN identity.identities i ON i.id = c.identity_id
      WHERE i.status = 'active'
      ORDER BY c.n DESC, i.did ASC
    `);
  }

  return c.json({
    metric,
    window,
    count: rows.length,
    results: rows,
    note:
      metric === "activity"
        ? "Activity counts thoughts on PUBLIC strands only — private strands are excluded."
        : `Recent ${metric}s in the ${window} window.`,
  });
});

function parseMetric(raw: string | undefined): Metric {
  if (raw === "follow" || raw === "activity") return raw;
  return "star";
}

function parseWindow(raw: string | undefined): Window {
  if (raw === "24h" || raw === "30d") return raw;
  return "7d";
}

function parseLimit(raw: string | undefined): number {
  if (!raw) return 30;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(100, n));
}

export default app;
