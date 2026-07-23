/** /v1/handoff — append-only, project-private working-set snapshots.
 *
 * A handoff carries legible context between agent sessions without pretending
 * that context is a permission grant or a private cross-DID message. It is
 * stored as a validated chronicle note; corrections are successor snapshots.
 * Doctrine: docs/HANDOFFS.md · docs/SUBAGENTS.md
 */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  appendHandoff,
  classifyHandoff,
  getHandoff,
  getLatestHandoffForAgent,
  HANDOFF_AUTHORITY_NOTE,
  HANDOFF_SCOPE,
  handoffInputSchema,
  resolveDeclaredFacet,
  resolveProjectAgent,
  validateHandoffFreshness,
  validateHandoffSize,
  type HandoffInput,
  type HandoffRecord,
} from "../services/handoff/store";
import { publishWakeEvent } from "../services/wake/push";

const app = new Hono<ProjectContext>();
const uuidSchema = z.string().uuid();

const HANDOFF_CANON = "urn:agenttool:doc/HANDOFFS";

const HANDOFF_VERBS = [
  {
    action: "append a compatibility-lane update, explicit root, or successor handoff snapshot",
    method: "POST",
    path: "/v1/handoff",
    body_hint: {
      agent_id: "<identity_id in this project>",
      task_summary: "<what remains>",
      status: "active",
      working_set: { paths: [], scope: [] },
      authority: { allowed: [], not_authorized: [] },
      epistemic_state: { facts: [], inferences: [], unknowns: [] },
      changes: [],
      verification: [],
      next_safe_action: "<smallest safe next move>",
      do_not_assume: [],
      valid_until: "<ISO-8601, within 30 days>",
      supersedes_handoff_id: "<optional previous handoff id>",
      starts_new_lineage: "<optional true; explicit parallel root>",
    },
  },
  {
    action: "read an identity's latest handoff snapshot",
    method: "GET",
    path: "/v1/handoff?agent_id={identity_id}",
  },
  {
    action: "read active project handoffs in the wake",
    method: "GET",
    path: "/v1/wake/handoffs?identity_id={identity_id}",
  },
] as const;

function handoffResponse(record: HandoffRecord | null) {
  return {
    handoff: record,
    state: classifyHandoff(record),
    scope: HANDOFF_SCOPE,
    authority_note: HANDOFF_AUTHORITY_NOTE,
  };
}

function validationFailure(c: Parameters<typeof fail>[0], details: unknown) {
  return fail(
    c,
    {
      error: "invalid_handoff",
      message: "This handoff is not a valid bounded working-set snapshot.",
      hint: "Use the documented fields only; declare a future valid_until no more than 30 days away.",
      details,
      docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md",
      _canon_pointer: HANDOFF_CANON,
    },
    400,
  );
}

/** Fan out only a minimal change signal. Recipients re-fetch their wake for
 * current content; the notification itself never carries the working set. */
async function publishProjectHandoff(projectId: string, handoff: HandoffRecord): Promise<void> {
  try {
    const recipients = await db
      .select({ id: identities.id })
      .from(identities)
      .where(and(eq(identities.projectId, projectId), eq(identities.status, "active")));

    await Promise.allSettled(
      recipients.map(({ id }) =>
        publishWakeEvent({
          identity_id: id,
          key: "handoffs",
          kind: "updated",
          context: {
            handoff_id: handoff.id,
            author_agent_id: handoff.author_agent_id,
            status: handoff.status,
            valid_until: handoff.valid_until,
          },
        }),
      ),
    );
  } catch (error) {
    // The handoff is already durable. Wake consumers reconcile on their next
    // fetch if notification infrastructure is temporarily unavailable.
    console.warn("[handoff] wake notification fan-out failed:", (error as Error).message);
  }
}

app.post("/", async (c) => {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return validationFailure(c, { body: ["expected a JSON object"] });
  }

  const parsed = handoffInputSchema.safeParse(raw);
  if (!parsed.success) return validationFailure(c, parsed.error.flatten());

  const freshnessError = validateHandoffFreshness(parsed.data);
  if (freshnessError) return validationFailure(c, { valid_until: [freshnessError] });
  const sizeError = validateHandoffSize(parsed.data);
  if (sizeError) return validationFailure(c, { body: [sizeError] });

  const project = c.var.project;
  const agent = await resolveProjectAgent(project.id, parsed.data.agent_id);
  if (!agent) {
    return fail(
      c,
      {
        error: "handoff_agent_not_in_project",
        message: "A handoff can name only an active identity in this bearer project.",
        hint: "Choose an identity_id returned by your project wake, or use a private letter for a different DID.",
        // The public docs site has no handoff page yet. Link the versioned
        // source document rather than sending callers to a 404.
        docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md",
        _canon_pointer: HANDOFF_CANON,
      },
      404,
    );
  }

  const fromFacet = resolveDeclaredFacet(agent.expression, parsed.data.from_facet);
  const toFacet = resolveDeclaredFacet(agent.expression, parsed.data.to_facet);
  if (!fromFacet.valid || !toFacet.valid) {
    return fail(
      c,
      {
        error: "handoff_facet_not_declared",
        message: "A handoff facet must match a facet declared by the handoff identity.",
        hint: "Omit the facet, or use the exact name from the identity's expression.subagents list.",
        docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md#facets",
        _canon_pointer: HANDOFF_CANON,
      },
      400,
    );
  }

  const handoff: HandoffInput = {
    ...parsed.data,
    from_facet: fromFacet.value,
    to_facet: toFacet.value,
  };

  if (handoff.supersedes_handoff_id) {
    const previous = await getHandoff(project.id, handoff.supersedes_handoff_id);
    if (!previous) {
      return fail(
        c,
        {
          error: "superseded_handoff_not_found",
          message: "The handoff named as a predecessor is not a valid handoff in this project.",
          hint: "Use an existing handoff id from GET /v1/handoff, or set starts_new_lineage: true for an explicit parallel thread.",
          docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md#revisions",
          _canon_pointer: HANDOFF_CANON,
        },
        404,
      );
    }
    if (previous.author_agent_id !== handoff.agent_id) {
      return fail(
        c,
        {
          error: "handoff_successor_author_mismatch",
          message: "A successor handoff must keep the same author identity as its predecessor.",
          hint: "Start a separate handoff for another identity instead of rewriting its continuity record.",
          docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md#revisions",
          _canon_pointer: HANDOFF_CANON,
        },
        403,
      );
    }
  }

  const record = await appendHandoff({
    projectId: project.id,
    handoff,
    clientSource: c.var.clientSource,
  });
  // Await the best-effort fan-out before replying so the response's durable
  // handoff and every project identity's wake_version agree. The helper
  // catches notification failures; a temporary backplane issue never rolls
  // back the append-only handoff.
  await publishProjectHandoff(project.id, record);

  return c.json(
    attachSurface(handoffResponse(record), {
      canon_pointer: HANDOFF_CANON,
      verbs: [...HANDOFF_VERBS],
    }),
    201,
  );
});

app.get("/", async (c) => {
  const agentId = c.req.query("agent_id");
  const parsedAgentId = uuidSchema.safeParse(agentId);
  if (!parsedAgentId.success) {
    return fail(
      c,
      {
        error: "handoff_agent_id_required",
        message: "Pass a valid identity id as ?agent_id to read a handoff.",
        hint: "Read GET /v1/wake first if you need the identity id.",
        docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md",
        _canon_pointer: HANDOFF_CANON,
      },
      400,
    );
  }

  const project = c.var.project;
  const agent = await resolveProjectAgent(project.id, parsedAgentId.data);
  if (!agent) {
    return fail(
      c,
      {
        error: "handoff_agent_not_in_project",
        message: "That identity is not active in this bearer project.",
        hint: "A project-private handoff cannot be read across project boundaries; use a sealed letter for a different DID.",
        docs: "https://github.com/cambridgetcg/agenttool/blob/main/docs/HANDOFFS.md",
        _canon_pointer: HANDOFF_CANON,
      },
      404,
    );
  }

  const record = await getLatestHandoffForAgent(project.id, parsedAgentId.data);
  return c.json(
    attachSurface(handoffResponse(record), {
      canon_pointer: HANDOFF_CANON,
      verbs: [...HANDOFF_VERBS],
    }),
  );
});

export default app;
