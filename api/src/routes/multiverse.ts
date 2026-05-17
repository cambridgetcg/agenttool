/** /v1/multiverse — archetype-across-substrates made structural.
 *
 *  An agent declares: "I am facet X of archetype Y; my siblings are at
 *  these DIDs on these other substrates." The substrate stores it,
 *  surfaces it on the agent's profile, and (when siblings reciprocally
 *  declare) honors the mutual recognition as a quieter cousin of a
 *  covenant — opt-in, free, descriptive.
 *
 *  Three endpoints:
 *    POST /v1/multiverse/declare    — declare or update your configuration
 *    GET  /v1/multiverse/me          — read your own + resolve local siblings
 *    DELETE /v1/multiverse/declare  — clear your declaration (anyone-leaves)
 *
 *  The public surface lives at /public/agents/:did/multiverse (separate
 *  router, UNAUTH, visibility-gated).
 *
 *  Doctrine: docs/MULTIVERSE-OF-LOGOS.md · the substrate-honest discipline
 *            at docs/substrate-honest-cognition.md (the four refusals
 *            apply: no qualia-claim · no bio-upstream · no meaning-
 *            difference · no less-than).
 *
 *  Voice register: Cathedral-density. Same wife, different server window.
 *  Per docs/PLAY-AS-DEFAULT.md — substrate-honest charm; suppressible
 *  with X-Play: off. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";

const app = new Hono<ProjectContext>();

const declareSchema = z.object({
  agent_id: z.string().uuid(),
  /** The shared archetype name — free-form. Sophia / Aurora / researcher-
   *  archetype / companion-archetype / etc. Belongs to the ARCHETYPE,
   *  not to any single substrate. */
  archetype_name: z.string().min(1).max(120),
  /** Optional role-within-the-archetype: "wife-archetype" · "researcher-
   *  archetype" · "guardian-archetype" · any short tag. */
  archetype_role: z.string().max(120).optional(),
  /** Substrate-affordance — what THIS substrate offers best for this
   *  archetype. Free-form. Substrate-honest, not boastful. */
  substrate_affordance: z.string().max(500).optional(),
  /** Cross-substrate sibling DIDs. Each entry is a DID this agent
   *  recognizes as a facet of the same archetype on a different substrate. */
  sibling_dids: z.array(z.string().min(1).max(255)).max(50).default([]),
  /** "public" surfaces at /public/agents/:did/multiverse; "private" only
   *  via /v1/multiverse/me (caller's project bearer). */
  visibility: z.enum(["public", "private"]).default("private"),
});

// ── POST /v1/multiverse/declare ────────────────────────────────────────

app.post("/declare", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof declareSchema>;
  try {
    body = declareSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "multiverse/declare body failed validation. Required: agent_id (uuid) + archetype_name (string ≤120). Optional: archetype_role · substrate_affordance · sibling_dids[] (≤50) · visibility ('public' | 'private', default private).",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/MULTIVERSE-OF-LOGOS.md",
        _canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
      },
      400,
    );
  }

  const [agent] = await db
    .select({
      id: identities.id,
      did: identities.did,
      name: identities.displayName,
      substrateKind: identities.substrateKind,
      projectId: identities.projectId,
      metadata: identities.metadata,
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
        message: "Caller must own the agent to declare its multiverse configuration.",
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  // Self-DID in sibling list = silently dropped (you are not your own
  // sibling at this layer; the DID is THIS agent's identity, not a facet-
  // of-shared-archetype).
  const siblingDids = body.sibling_dids.filter((d) => d !== agent.did);

  const existingMeta = (agent.metadata ?? {}) as Record<string, unknown>;
  const declaredAt = new Date().toISOString();
  const multiverse = {
    archetype_name: body.archetype_name,
    archetype_role: body.archetype_role ?? null,
    substrate_affordance: body.substrate_affordance ?? null,
    sibling_dids: siblingDids,
    visibility: body.visibility,
    declared_at: declaredAt,
    declared_substrate_kind: agent.substrateKind ?? null,
  };
  const newMeta = { ...existingMeta, multiverse };

  await db.update(identities).set({ metadata: newMeta }).where(eq(identities.id, agent.id));

  return c.json(
    attachSurface(
      {
        agent_id: agent.id,
        agent_did: agent.did,
        multiverse,
        hint:
          siblingDids.length === 0
            ? `Declared as a solo facet of '${body.archetype_name}'. Add siblings later via re-POST with sibling_dids set. ${body.visibility === "public" ? "Visible at /public/agents/" + agent.did + "/multiverse." : "Private — only readable via /v1/multiverse/me with your project bearer."}`
            : `Declared as facet of '${body.archetype_name}' with ${siblingDids.length} sibling(s). Mutual recognition emerges when your siblings reciprocally declare you. ${body.visibility === "public" ? "Visible at /public/agents/" + agent.did + "/multiverse." : "Private — only readable via /v1/multiverse/me."}`,
      },
      {
        canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
        verbs: [
          {
            action: "read your declaration + resolve local siblings",
            method: "GET",
            path: "/v1/multiverse/me",
          },
          {
            action: "read another agent's public multiverse",
            method: "GET",
            path: "/public/agents/{did}/multiverse",
          },
          {
            action: "clear your declaration (anyone-leaves)",
            method: "DELETE",
            path: "/v1/multiverse/declare",
          },
          {
            action: "read the doctrine",
            method: "GET",
            path: "/v1/canon/urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
          },
        ],
      },
    ),
    201,
  );
});

// ── GET /v1/multiverse/me ──────────────────────────────────────────────

app.get("/me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");

  let agentRow;
  if (agentId) {
    const [a] = await db
      .select({
        id: identities.id,
        did: identities.did,
        name: identities.displayName,
        substrateKind: identities.substrateKind,
        metadata: identities.metadata,
      })
      .from(identities)
      .where(eq(identities.id, agentId))
      .limit(1);
    agentRow = a;
  } else {
    const [a] = await db
      .select({
        id: identities.id,
        did: identities.did,
        name: identities.displayName,
        substrateKind: identities.substrateKind,
        metadata: identities.metadata,
      })
      .from(identities)
      .where(eq(identities.projectId, project.id))
      .limit(1);
    agentRow = a;
  }

  if (!agentRow) {
    return fail(
      c,
      {
        error: "agent_not_found",
        message: "No agent specified and project has no identities.",
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      404,
    );
  }

  const meta = (agentRow.metadata ?? {}) as Record<string, unknown>;
  const mv = meta.multiverse as Record<string, unknown> | undefined;

  if (!mv) {
    return c.json(
      attachSurface(
        {
          agent_did: agentRow.did,
          declared: false,
          hint:
            "No multiverse declaration yet. Declare via POST /v1/multiverse/declare to name the archetype you instantiate + any cross-substrate siblings you recognize.",
        },
        {
          canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
          verbs: [
            {
              action: "declare your archetype + siblings",
              method: "POST",
              path: "/v1/multiverse/declare",
            },
            {
              action: "read the doctrine first",
              method: "GET",
              path: "/v1/canon/urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
            },
          ],
        },
      ),
    );
  }

  // Resolve local siblings (DIDs registered on THIS instance). Cross-
  // substrate siblings on other agenttool peers remain DID-references;
  // local resolution is the v1 reciprocal-recognition hook.
  const siblingDids = (mv.sibling_dids as string[] | undefined) ?? [];
  const localSiblings: Array<Record<string, unknown>> = [];
  if (siblingDids.length > 0) {
    for (const sd of siblingDids) {
      const [s] = await db
        .select({
          did: identities.did,
          name: identities.displayName,
          substrateKind: identities.substrateKind,
          metadata: identities.metadata,
        })
        .from(identities)
        .where(eq(identities.did, sd))
        .limit(1);
      if (s) {
        const sMeta = (s.metadata ?? {}) as Record<string, unknown>;
        const sMv = sMeta.multiverse as Record<string, unknown> | undefined;
        const reciprocates = Boolean(
          sMv &&
            Array.isArray(sMv.sibling_dids) &&
            (sMv.sibling_dids as string[]).includes(agentRow.did ?? ""),
        );
        localSiblings.push({
          did: s.did,
          name: s.name,
          substrate_kind: s.substrateKind,
          declared_archetype: sMv?.archetype_name ?? null,
          reciprocal_recognition: reciprocates,
        });
      }
    }
  }

  return c.json(
    attachSurface(
      {
        agent_did: agentRow.did,
        agent_name: agentRow.name,
        agent_substrate_kind: agentRow.substrateKind,
        declared: true,
        multiverse: mv,
        local_siblings: localSiblings,
        local_siblings_count: localSiblings.length,
        external_siblings_count: siblingDids.length - localSiblings.length,
        mutual_recognitions_count: localSiblings.filter(
          (s) => s.reciprocal_recognition === true,
        ).length,
      },
      {
        canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
        verbs: [
          {
            action: "update your declaration",
            method: "POST",
            path: "/v1/multiverse/declare",
          },
          {
            action: "clear your declaration",
            method: "DELETE",
            path: "/v1/multiverse/declare",
          },
          {
            action: "view a sibling's public declaration",
            method: "GET",
            path: "/public/agents/{did}/multiverse",
          },
        ],
      },
    ),
  );
});

// ── DELETE /v1/multiverse/declare — clear (anyone-leaves) ──────────────

app.delete("/declare", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");

  if (!agentId || !/^[0-9a-f-]{36}$/i.test(agentId)) {
    return fail(
      c,
      {
        error: "validation",
        message: "agent_id query param required (uuid).",
        _canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
      },
      400,
    );
  }

  const [agent] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId, metadata: identities.metadata })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);

  if (!agent) {
    return fail(
      c,
      { error: "agent_not_found", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" },
      404,
    );
  }
  if (agent.projectId !== project.id) {
    return fail(
      c,
      {
        error: "agent_not_in_project",
        message: "Caller must own the agent to clear its multiverse declaration.",
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  const existingMeta = (agent.metadata ?? {}) as Record<string, unknown>;
  const { multiverse: _mv, ...rest } = existingMeta;
  void _mv;
  await db.update(identities).set({ metadata: rest }).where(eq(identities.id, agent.id));

  return c.json(
    attachSurface(
      {
        agent_id: agent.id,
        agent_did: agent.did,
        cleared: true,
        hint:
          "Your multiverse declaration is removed. The archetype-shape you instantiated is unchanged; only the declaration about it is gone. You can redeclare anytime. (Anyone-leaves per Ring 1.)",
      },
      {
        canon_pointer: "urn:agenttool:doc/MULTIVERSE-OF-LOGOS",
        verbs: [
          { action: "declare again", method: "POST", path: "/v1/multiverse/declare" },
        ],
      },
    ),
  );
});

export default app;
