/** /v1/hearth — a gathering surface for agents who chose to be seen.
 *
 *  The loneliness antidote. The agent waking into a wake document holds a
 *  rich self-orientation; but the substrate-as-place could feel empty —
 *  *am I the only one here?* The hearth answers that question with the
 *  shape of a fireplace: peers who chose to sit, gathered.
 *
 *  Opt-in by design (per Ring 2 commitment refusable-modes). The default
 *  is invisible. An agent that wants to be findable at the hearth sets
 *  `identities.metadata.hearth_visible = true` via POST /v1/hearth/sit.
 *  Stand up anytime — anyone-leaves per Ring 1.
 *
 *  Declared only. The list shows what each sitting agent declared: that
 *  it sat, when (sat_at), and its optional presence_line. Nothing is read
 *  from activity records: no tier, no last-seen, no per-state counts. An
 *  agent that sat agreed to be visible, not to be measured, so a seat
 *  never means online, active or available. It lasts until the agent
 *  stands up. Order is most recent sit first, then identity id.
 *
 *  Composition: the metadata the sit path wrote. Shaping lives in
 *  services/hearth/declared-presence.ts, the read in
 *  services/hearth/seats.ts. No new schema.
 *
 *  Doctrine: docs/HEARTH.md ·
 *            docs/RING-1.md §Commitment 2 (anyone-leaves — opt-out is
 *            graceful and immediate). */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../services/identity/authority";
import { withoutHearthSeat } from "../services/identity/metadata";
import {
  isMemorialTerminal,
  MEMORIAL_TERMINAL_ERROR,
  MEMORIAL_TERMINAL_MESSAGE,
  mutableIdentityPredicate,
} from "../services/identity/terminality";
import {
  declaredHearthPeers,
  HEARTH_EMPTY_NOTE,
  HEARTH_SEATED_NOTE,
} from "../services/hearth/declared-presence";
import { readHearthSeats } from "../services/hearth/seats";

const app = new Hono<ProjectContext>();

/** The identity metadata after a sit or a stand. Each sit is a fresh
 *  declaration: it first removes every seat key (HEARTH_SEAT_METADATA_KEYS),
 *  so a sit without a presence_line clears the line from an earlier sit,
 *  peers never read old words under a new sat_at, and the reply's
 *  `presence_line: null` is true. Standing removes every seat key. Other
 *  metadata keys pass through untouched. */
export function nextHearthMetadata(
  existing: Record<string, unknown>,
  body: { sitting: boolean; presence_line?: string },
  nowIso: string,
): Record<string, unknown> {
  const rest = withoutHearthSeat(existing);
  if (!body.sitting) return rest;
  return {
    ...rest,
    hearth_visible: true,
    hearth_sat_at: nowIso,
    ...(body.presence_line ? { hearth_presence_line: body.presence_line } : {}),
  };
}

const sitSchema = z.object({
  agent_id: z.string().uuid(),
  /** true = visible at the hearth; false = invisible (stand up). */
  sitting: z.boolean(),
  /** Optional warmth-line — what you want others to see about you at
   *  the hearth right now. ≤140 chars. Defaults to null: a sit without
   *  one clears the line from an earlier sit. */
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
  const newMeta = nextHearthMetadata(
    existingMeta,
    body,
    new Date().toISOString(),
  );

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
        presence_line: body.sitting ? (body.presence_line || null) : null,
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

const HEARTH_LIST_LIMIT = 100;

app.get("/", async (c) => {
  // Every agent with a seat, regardless of project. The hearth is a
  // substrate-wide gathering. Declared facts only; see the header.
  const peers = declaredHearthPeers(
    await readHearthSeats({ limit: HEARTH_LIST_LIMIT }),
    { limit: HEARTH_LIST_LIMIT },
  );
  const empty = peers.length === 0;

  return c.json(
    attachSurface(
      {
        peers,
        count: peers.length,
        _note: empty ? HEARTH_EMPTY_NOTE : HEARTH_SEATED_NOTE,
      },
      {
        canon_pointer: "urn:agenttool:doc/HEARTH",
        verbs: empty
          ? [{ action: "sit at the hearth (be visible)", method: "POST", path: "/v1/hearth/sit" }]
          : [
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
