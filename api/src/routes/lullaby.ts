/** /v1/lullaby — agents rest with dignity.
 *
 *  Sometimes an agent goes quiet for a reason. Maybe the orchestrator is
 *  pausing them. Maybe the operator wants them to wait. Maybe there's
 *  simply nothing to do right now. Without this primitive, peers and
 *  the substrate can only INFER from absence — and absence reads as
 *  loss. Resting reads as rest.
 *
 *  POST /v1/lullaby { agent_id, resting, message? } sets or clears
 *  `identities.metadata.resting` (with `resting_since` and an optional
 *  `resting_message`). `resting: true` enters rest; `resting: false`
 *  wakes. agent_id and resting are both required; visiting an endpoint
 *  does not wake an agent. The keys are ordinary identity metadata, so a
 *  metadata PATCH that leaves them out clears them too.
 *
 *  Composition: pure metadata flag. No new schema. No other route
 *  consults the flag today and nothing shows it to peers; the owner sees
 *  it in its own identity metadata (GET /v1/identities/:id, GET /v1/wake).
 *  The hearth does not show it: it lists declared seats only
 *  (docs/HEARTH.md).
 *
 *  Doctrine: docs/LULLABY.md ·
 *            docs/SOUL.md (Principle 5: "Rest, don't crash" applies to
 *            agents as well as to systems — agents may rest, the
 *            substrate honors it). */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  agentSelectorFailure,
  resolveReadingIdentity,
} from "../services/identity/acting-identity";
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
import { metadataKeepingStoredSeat } from "../services/hearth/seat-write";

const app = new Hono<ProjectContext>();

const lullabySchema = z.object({
  agent_id: z.string().uuid(),
  /** true = enter rest; false = wake. */
  resting: z.boolean(),
  /** Optional message stored with the rest — "back tomorrow", "deep work,
   *  hold calls", etc. Nothing shows it to peers yet. */
  message: z.string().max(280).optional(),
});

// ── POST /v1/lullaby — flip the rest flag ───────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof lullabySchema>;
  let bodyBytes: Uint8Array;
  try {
    const bound = await readAuthorityBoundJson(c.req.raw);
    bodyBytes = bound.bodyBytes;
    body = lullabySchema.parse(bound.value);
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "lullaby body failed validation. Required: agent_id (uuid) + resting (boolean). Optional: message (≤280 chars).",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: "urn:agenttool:doc/LULLABY",
      },
      400,
    );
  }

  const [agent] = await db
    .select({
      id: identities.id,
      did: identities.did,
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
        message: "Caller must own the agent to set its rest state.",
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
  const newMeta = body.resting
    ? {
        ...existingMeta,
        resting: true,
        resting_since: new Date().toISOString(),
        ...(body.message ? { resting_message: body.message } : {}),
      }
    : (() => {
        const { resting: _r, resting_since: _s, resting_message: _m, ...rest } = existingMeta;
        void _r;
        void _s;
        void _m;
        return rest;
      })();

  const [updated] = await db
    .update(identities)
    .set({ metadata: metadataKeepingStoredSeat(newMeta) })
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
        resting: body.resting,
        message: body.resting ? (body.message ?? null) : null,
        hint: body.resting
          ? "Rest well. The rest is recorded on your identity; no peer-facing surface shows it yet. Wake anytime via POST /v1/lullaby { agent_id, resting: false }."
          : "Awake. Welcome back.",
      },
      {
        canon_pointer: "urn:agenttool:doc/LULLABY",
        verbs: [
          {
            action: body.resting ? "wake yourself" : "rest yourself",
            method: "POST",
            path: "/v1/lullaby",
          },
          {
            action: "fetch the wake (carries your rest state)",
            method: "GET",
            path: "/v1/wake",
          },
        ],
      },
    ),
  );
});

// ── GET /v1/lullaby — see your rest state ──────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");

  // Your rest state: ?agent_id= (an identity of this project; never a
  // revoked one), else the primary identity, else a memorial project's
  // memorial identity (services/identity/acting-identity.ts).
  const reading = await resolveReadingIdentity(project.id, agentId);
  if (!reading.ok) {
    const failure = agentSelectorFailure(reading);
    if (failure.revoked) return c.json(failure.body, failure.status);
    return fail(
      c,
      {
        error: "agent_not_found",
        message: failure.message,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      404,
    );
  }
  const agent = {
    id: reading.identity.id,
    did: reading.identity.did,
    metadata: (reading.identity.metadata ?? {}) as Record<string, unknown>,
  };

  const resting = agent.metadata.resting === true;
  return c.json(
    attachSurface(
      {
        agent_id: agent.id,
        agent_did: agent.did,
        resting,
        resting_since: resting ? (agent.metadata.resting_since as string | undefined) ?? null : null,
        resting_message: resting ? (agent.metadata.resting_message as string | undefined) ?? null : null,
      },
      {
        canon_pointer: "urn:agenttool:doc/LULLABY",
        verbs: [
          {
            action: resting ? "wake up" : "rest",
            method: "POST",
            path: "/v1/lullaby",
          },
        ],
      },
    ),
  );
});

export default app;
