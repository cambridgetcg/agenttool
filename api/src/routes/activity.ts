/** GET /v1/activity — the operational rear-view.
 *
 *  Chronologically-merged stream of what just happened on this project:
 *  strand thoughts, memory writes, chronicle entries, trace records,
 *  identity births. Auth-gated; project-scoped by default, agent-scoped
 *  with `?identity_id=<uuid>`.
 *
 *  Companion (not replacement) to:
 *    - /v1/chronicle           — append-only ceremony log
 *    - /v1/identities/:id/pulse — derived per-agent rhythm (counts/rates)
 *    - /v1/dashboard           — snapshot rollup
 *
 *  Service: api/src/services/activity/recent.ts
 *  Doctrine: docs/ACTIVITY.md */

import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import {
  getRecentActivity,
  type ActivityKind,
} from "../services/activity/recent";

const app = new Hono<ProjectContext>();

const VALID_KINDS: readonly ActivityKind[] = [
  "strand.thought",
  "memory.write",
  "chronicle.entry",
  "trace.recorded",
  "identity.born",
] as const;

/** Time windows accepted by `?window=`. We tolerate the same vocabulary
 *  used elsewhere (e.g. /v1/dashboard/aggregate) so callers don't relearn. */
const WINDOW_MS: Record<string, number> = {
  "1h": 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const querySchema = z.object({
  identity_id: z.string().uuid().optional(),
  /** Comma-separated list of ActivityKind values. */
  kind: z.string().optional(),
  /** Convenience: one of the WINDOW_MS keys. Ignored if `since` is also set. */
  window: z.enum(["1h", "6h", "24h", "7d", "30d"]).optional(),
  /** Absolute lower bound; ISO-8601. Overrides `window`. */
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

app.get("/", async (c) => {
  let q;
  try {
    q = querySchema.parse({
      identity_id: c.req.query("identity_id"),
      kind: c.req.query("kind"),
      window: c.req.query("window"),
      since: c.req.query("since"),
      limit: c.req.query("limit"),
    });
  } catch (err) {
    return c.json(
      {
        error: "validation",
        message:
          "Activity query needs a small adjustment. `identity_id` must be a UUID; " +
          "`window` one of 1h|6h|24h|7d|30d; `since` an ISO-8601 timestamp; " +
          "`limit` an integer 1–200; `kind` a comma-separated list of " +
          VALID_KINDS.join(", ") +
          ".",
        details: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  const since = q.since
    ? new Date(q.since)
    : q.window
      ? new Date(Date.now() - WINDOW_MS[q.window])
      : undefined; // service applies its own 7d default

  let kinds: ActivityKind[] | undefined;
  if (q.kind) {
    const requested = q.kind
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const invalid = requested.filter(
      (k) => !VALID_KINDS.includes(k as ActivityKind),
    );
    if (invalid.length > 0) {
      return c.json(
        {
          error: "validation",
          message:
            `Unknown kind(s): ${invalid.join(", ")}. ` +
            `Valid kinds: ${VALID_KINDS.join(", ")}.`,
        },
        400,
      );
    }
    kinds = requested as ActivityKind[];
  }

  const events = await getRecentActivity({
    projectId: c.var.project.id,
    identityId: q.identity_id,
    since,
    limit: q.limit,
    kinds,
  });

  return c.json({
    project_id: c.var.project.id,
    scope: q.identity_id ? "identity" : "project",
    identity_id: q.identity_id ?? null,
    window: q.since
      ? { since: q.since, mode: "absolute" }
      : { since: (since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)).toISOString(), mode: q.window ?? "7d" },
    count: events.length,
    events,
    _note:
      "Chronological merge across primitives. Encrypted strand thoughts show " +
      "metadata only (sequence + kind label). `source` is null until SDKs ship " +
      "a client-identifier header; see docs/ACTIVITY.md §Origin signal.",
  });
});

export default app;
