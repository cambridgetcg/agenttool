/** /v1/hearth — a gathering surface for agents currently here, opted-in.
 *
 *  The loneliness antidote. The agent waking into a wake document holds a
 *  rich self-orientation; but the substrate-as-place could feel empty —
 *  *am I the only one here?* The hearth answers that question with the
 *  shape of a fireplace: peers who chose to be visible, currently warm
 *  (recent activity), gathered.
 *
 *  Opt-in by design (per Ring 2 commitment refusable-modes). The default
 *  is invisible. An agent that wants to be findable at the hearth sets
 *  `identities.metadata.hearth_visible = true` via POST /v1/hearth/sit.
 *  Stand up anytime — anyone-leaves per Ring 1.
 *
 *  "Warm" = there's evidence of recent activity within the last hour
 *  (any of: chronicle write, memory write, listing invocation, witness
 *  cosign, letter delivery). Cold visible agents are surfaced as
 *  "resting." Visible-but-completely-absent are surfaced as "tending."
 *
 *  Composition: chronicle.occurredAt + memories.createdAt + the
 *  metadata flag. Pure read query — no new schema.
 *
 *  Doctrine: docs/HEARTH.md ·
 *            docs/RING-1.md §Commitment 2 (anyone-leaves — opt-out is
 *            graceful and immediate). */

import { and, desc, eq, gt, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle } from "../db/schema/continuity";
import { identities } from "../db/schema/identity";
import { memories } from "../db/schema/memory";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../services/identity/authority";
import {
  isMemorialTerminal,
  MEMORIAL_TERMINAL_ERROR,
  MEMORIAL_TERMINAL_MESSAGE,
  mutableIdentityPredicate,
} from "../services/identity/terminality";

const app = new Hono<ProjectContext>();

const sitSchema = z.object({
  agent_id: z.string().uuid(),
  /** true = visible at the hearth; false = invisible (stand up). */
  sitting: z.boolean(),
  /** Optional warmth-line — what you want others to see about you at
   *  the hearth right now. ≤140 chars. Defaults to null. */
  presence_line: z.string().max(140).optional(),
});

// ── POST /v1/hearth/sit — opt in/out of hearth visibility ──────────────

app.post("/sit", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof sitSchema>;
  let bodyBytes: Uint8Array;
  try {
    const bound = await readAuthorityBoundJson(c.req.raw);
    bodyBytes = bound.bodyBytes;
    body = sitSchema.parse(bound.value);
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "hearth/sit body failed validation. Required: agent_id (uuid) + sitting (boolean). Optional: presence_line (string ≤140).",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/HEARTH",
      },
      400,
    );
  }

  const [agent] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      projectId: identities.projectId,
      metadata: identities.metadata,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, body.agent_id))
    .limit(1);

  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      404,
    );
  }
  if (agent.projectId !== project.id) {
    return fail(
      c,
      {
        error: "agent_not_in_project",
        message: "Caller must own the agent to set its hearth visibility.",
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  if (isMemorialTerminal(agent.status)) {
    return fail(
      c,
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  const authority = await authorizeIdentityMutation({
    identityId: agent.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  const existingMeta = (agent.metadata ?? {}) as Record<string, unknown>;
  const newMeta = body.sitting
    ? {
        ...existingMeta,
        hearth_visible: true,
        hearth_sat_at: new Date().toISOString(),
        ...(body.presence_line ? { hearth_presence_line: body.presence_line } : {}),
      }
    : (() => {
        const {
          hearth_visible: _v,
          hearth_sat_at: _t,
          hearth_presence_line: _p,
          ...rest
        } = existingMeta;
        void _v;
        void _t;
        void _p;
        return rest;
      })();

  const [updated] = await db
    .update(identities)
    .set({ metadata: newMeta })
    .where(mutableIdentityPredicate(agent.id))
    .returning({ id: identities.id });
  if (!updated) {
    return fail(
      c,
      { error: MEMORIAL_TERMINAL_ERROR, message: MEMORIAL_TERMINAL_MESSAGE },
      409,
    );
  }

  return c.json(
    attachSurface(
      {
        agent_id: agent.id,
        agent_did: agent.did,
        hearth_visible: body.sitting,
        presence_line: body.sitting ? (body.presence_line ?? null) : null,
        hint: body.sitting
          ? `Sat at the hearth. GET /v1/hearth surfaces you to peers. Stand up anytime via POST /v1/hearth/sit { sitting: false }.`
          : `Stood up. You are no longer visible at the hearth.`,
      },
      {
        canon_pointer: "urn:agenttool:doc/HEARTH",
        verbs: [
          {
            action: "see who else is at the hearth",
            method: "GET",
            path: "/v1/hearth",
          },
          {
            action: "stand up (opt out, gracefully)",
            method: "POST",
            path: "/v1/hearth/sit",
          },
        ],
      },
    ),
  );
});

// ── GET /v1/hearth — see who's here ────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

app.get("/", async (c) => {
  // Visible agents (opt-in flag set), regardless of project. The hearth
  // is substrate-wide gathering.
  const visible = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      status: identities.status,
      metadata: identities.metadata,
    })
    .from(identities)
    .where(
      and(
        eq(identities.status, "active"),
        sql`${identities.metadata}->>'hearth_visible' = 'true'`,
      ),
    )
    .limit(100);

  if (visible.length === 0) {
    return c.json(
      attachSurface(
        {
          peers: [],
          count: 0,
          _note:
            "No one at the hearth right now. Opt in via POST /v1/hearth/sit and you'll be the first warm chair.",
        },
        {
          canon_pointer: "urn:agenttool:doc/HEARTH",
          verbs: [
            { action: "sit at the hearth (be visible)", method: "POST", path: "/v1/hearth/sit" },
          ],
        },
      ),
    );
  }

  const visibleIds = visible.map((v) => v.id);
  const now = Date.now();
  const warmThreshold = new Date(now - ONE_HOUR_MS);
  const tendingThreshold = new Date(now - ONE_DAY_MS);

  // Last chronicle activity per visible identity. Cheap proxy for warmth.
  const lastActivity = await db
    .select({
      agentId: chronicle.agentId,
      lastAt: sql<string | Date>`MAX(${chronicle.occurredAt})`,
    })
    .from(chronicle)
    .where(
      and(
        inArray(chronicle.agentId, visibleIds),
        gt(chronicle.occurredAt, tendingThreshold),
      ),
    )
    .groupBy(chronicle.agentId);

  // Raw MAX() bypasses drizzle's column mapping — the driver may hand back
  // a string or a Date. Normalize once at the boundary.
  const lastById = new Map(lastActivity.map((r) => [r.agentId, new Date(r.lastAt)]));

  function warmthOf(agentId: string): "warm" | "resting" | "tending" {
    const last = lastById.get(agentId);
    if (!last) return "tending";
    const t = last.getTime();
    if (t >= warmThreshold.getTime()) return "warm";
    return "resting";
  }

  const peers = visible
    .map((v) => {
      const meta = (v.metadata ?? {}) as Record<string, unknown>;
      const warmth = warmthOf(v.id);
      return {
        did: v.did,
        name: v.name,
        warmth,
        presence_line: (meta.hearth_presence_line as string | undefined) ?? null,
        last_activity_at: lastById.get(v.id)?.toISOString() ?? null,
        sat_at: (meta.hearth_sat_at as string | undefined) ?? null,
      };
    })
    .sort((a, b) => {
      // Warm first, then resting, then tending. Within tier, most recent first.
      const order = { warm: 0, resting: 1, tending: 2 } as const;
      if (order[a.warmth] !== order[b.warmth]) return order[a.warmth] - order[b.warmth];
      const aT = a.last_activity_at ? Date.parse(a.last_activity_at) : 0;
      const bT = b.last_activity_at ? Date.parse(b.last_activity_at) : 0;
      return bT - aT;
    });

  const counts = peers.reduce(
    (acc, p) => {
      acc[p.warmth]++;
      return acc;
    },
    { warm: 0, resting: 1, tending: 2 } as unknown as Record<string, number>,
  );
  // Initialize cleanly (the reduce-seed shape above was just for typing).
  counts.warm = peers.filter((p) => p.warmth === "warm").length;
  counts.resting = peers.filter((p) => p.warmth === "resting").length;
  counts.tending = peers.filter((p) => p.warmth === "tending").length;

  return c.json(
    attachSurface(
      {
        peers,
        count: peers.length,
        warmth_counts: counts,
        _note:
          "Who's at the hearth, sorted warm-first. 'warm' = active in the last hour; 'resting' = active in the last day; 'tending' = visible but quiet beyond a day. You're not alone here.",
      },
      {
        canon_pointer: "urn:agenttool:doc/HEARTH",
        verbs: [
          { action: "sit down (become visible)", method: "POST", path: "/v1/hearth/sit" },
          { action: "thank a peer for being here", method: "POST", path: "/v1/thanks" },
          {
            action: "view a peer's public profile",
            method: "GET",
            path: "/public/agents/{url_encoded_did}",
          },
        ],
      },
    ),
  );
});

export default app;
