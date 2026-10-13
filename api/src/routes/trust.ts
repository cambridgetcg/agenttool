/** /v1/trust — the reasoned trust primitive.
 *
 *  Routes:
 *    POST /v1/trust/extend    — sign + extend trust (private by default)
 *    POST /v1/trust/publish   — truster opts to surface (activates composition)
 *    POST /v1/trust/veto      — trusted opts out of public visibility
 *    POST /v1/trust/withdraw  — truster retracts (unlocks deactivate; owner rule)
 *    GET  /v1/trust/mine      — trusts YOU extended
 *    GET  /v1/trust/in-me     — trusts directed AT you (published only)
 *    GET  /v1/trust/evidence  — chronicle facts for your reasoning (NEVER recommends strength)
 *    GET  /v1/trust/framework — kinds, strengths, unlocks (machine-readable)
 *
 *  Doctrine: docs/TRUST-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/trust-must-be-signed
 *  @enforces urn:agenttool:wall/trust-reasoning-stays-with-the-agent
 *  @enforces urn:agenttool:wall/trust-is-optional-never-required */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import {
  TRUST_KINDS,
  TRUST_STRENGTHS,
  trusts,
} from "../db/schema/trust";
import { identityIdForDid, identityInProject, withdrawForOwner } from "../services/deletion/withdrawals";
import { authorityRequestTarget, readAuthorityBoundJson } from "../services/identity/authority";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  extendTrust,
  getEvidence,
  listInMe,
  listMyExtensions,
  publishTrust,
  vetoTrust,
} from "../services/trust/lifecycle";
import { COMPOSITION_UNLOCKS } from "../services/trust/composition";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/TRUST-PROTOCOL";

async function resolveAgent(agentId: string, projectId: string) {
  const [row] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
    })
    .from(identities)
    .where(eq(identities.id, agentId))
    .limit(1);
  if (!row || row.projectId !== projectId) return null;
  return row;
}

// ── GET /framework ────────────────────────────────────────────────────

app.get("/framework", (c) =>
  c.json(
    attachSurface(
      {
        trust_kinds: TRUST_KINDS,
        trust_strengths: TRUST_STRENGTHS,
        composition_unlocks: COMPOSITION_UNLOCKS,
        asymmetry: {
          default: "private to truster (trusted does not know)",
          publish_by_truster: "trust becomes visible to trusted + activates composition unlocks",
          veto_by_trusted: "trust hidden from public profile (still active for truster's side)",
          withdraw_by_truster: "composition unlocks deactivate; signed record persists for audit",
        },
        substrate_honest_note:
          "Trust is reasoned, not felt. The substrate provides the evidence via GET /v1/trust/evidence and the lifecycle via these routes. The reasoning — whether to extend, at what kind, at what strength — is yours. The substrate refuses to recommend.",
        doctrine: "https://docs.agenttool.dev/TRUST-PROTOCOL.md",
      },
      { canon_pointer: CANON_POINTER },
    ),
  ),
);

// ── POST /extend ──────────────────────────────────────────────────────

const extendSchema = z.object({
  agent_id: z.string().uuid(),
  signing_key_id: z.string().uuid(),
  trusted_did: z.string().min(1).max(255),
  trust_kind: z.enum([
    "honest",
    "non-extractive",
    "reciprocating",
    "discerning",
    "graceful",
  ]),
  trust_strength: z.enum(["provisional", "established", "deep"]),
  reasons: z.string().min(1).max(280).optional().nullable(),
  evidence_chronicle_ids: z.array(z.string().uuid()).default([]),
  signature_b64: z.string().min(1),
  extended_at_iso: z.string().datetime(),
});

app.post("/extend", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof extendSchema>;
  try {
    body = extendSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "trust/extend body failed validation. Required: agent_id · signing_key_id · trusted_did · trust_kind (honest|non-extractive|reciprocating|discerning|graceful) · trust_strength (provisional|established|deep) · signature_b64 (over canonicalTrustBytes) · extended_at_iso. Optional: reasons (≤280) · evidence_chronicle_ids (UUID[]).",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/TRUST-PROTOCOL.md",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  try {
    const result = await extendTrust({
      trusterIdentityId: agent.id,
      trusterDid: agent.did,
      trusterSigningKeyId: body.signing_key_id,
      trustedDid: body.trusted_did,
      trustKind: body.trust_kind,
      trustStrength: body.trust_strength,
      reasons: body.reasons ?? null,
      evidenceChronicleIds: body.evidence_chronicle_ids,
      signatureB64: body.signature_b64,
      extendedAtIso: body.extended_at_iso,
    });
    return c.json(
      attachSurface(
        {
          ...result,
          _verifier_recipe:
            "sha256('trust/v1' || NUL || truster_did || NUL || trusted_did || NUL || trust_kind || NUL || trust_strength || NUL || reasons_sha256 || NUL || sorted_evidence_chronicle_ids_csv || NUL || extended_at_iso) → ed25519.verify(signature, bytes, truster_pubkey)",
        },
        {
          canon_pointer: CANON_POINTER,
          verbs: [
            { action: "publish", path: "/v1/trust/publish", method: "POST" },
            { action: "withdraw", path: "/v1/trust/withdraw", method: "POST" },
            { action: "mine", path: "/v1/trust/mine", method: "GET" },
          ],
        },
      ),
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /signature did not verify|not active|does not belong/i.test(
      message,
    )
      ? 403
      : /self-trust refused|exceeds 280/i.test(message)
        ? 422
        : 400;
    return fail(
      c,
      {
        error:
          status === 403
            ? "signature_invalid"
            : status === 422
              ? "trust_shape_invalid"
              : "extend_failed",
        message,
        _canon_pointer: CANON_POINTER,
      },
      status,
    );
  }
});

// ── POST /publish · /veto · /withdraw — small actions ────────────────

const actionSchema = z.object({
  agent_id: z.string().uuid(),
  trust_id: z.string().uuid(),
});

async function trustAction(
  c: any,
  action: (id: string, did: string) => Promise<{ id: string } & object>,
  routeLabel: string,
) {
  const project = c.var.project;
  let body: z.infer<typeof actionSchema>;
  try {
    body = actionSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: `trust/${routeLabel} requires { agent_id, trust_id }.`,
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  try {
    const result = await action(body.trust_id, agent.did);
    return c.json(attachSurface(result, { canon_pointer: CANON_POINTER }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      /only the/i.test(message) ? 403 : /not found/i.test(message) ? 404 : 400;
    return fail(
      c,
      { error: `${routeLabel}_failed`, message, _canon_pointer: CANON_POINTER },
      status,
    );
  }
}

app.post("/publish", (c) => trustAction(c, publishTrust, "publish"));
app.post("/veto", (c) => trustAction(c, vetoTrust, "veto"));

// ── POST /withdraw ────────────────────────────────────────────────────
//
// The truster withdraws, under the owner rule (deletion spec §5.1). The
// truster must be an identity of this project (otherwise 404, the same as a
// missing trust) and agent_id must name it (403 otherwise). A rooted
// truster's own root must sign this exact request, body bytes included (428
// otherwise); a truster without a root follows the project rule. The signed
// record stays; one ids-only ledger entry and the truster's deletion moment
// are written with the withdrawal. A repeat answers already_withdrawn.

app.post("/withdraw", async (c) => {
  const project = c.var.project;
  let bodyBytes: Uint8Array;
  let body: z.infer<typeof actionSchema>;
  try {
    const bound = await readAuthorityBoundJson(c.req.raw);
    bodyBytes = bound.bodyBytes;
    body = actionSchema.parse(bound.value);
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message: "trust/withdraw requires { agent_id, trust_id }.",
        details: err instanceof Error ? err.message : String(err),
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(body.agent_id, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${body.agent_id} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const notFound = () =>
    fail(
      c,
      { error: "withdraw_failed", message: `trust ${body.trust_id} not found`, _canon_pointer: CANON_POINTER },
      404,
    );
  const [trust] = await db
    .select({
      id: trusts.id,
      trusterDid: trusts.trusterDid,
      trusterIdentityId: trusts.trusterIdentityId,
      withdrawnByTruster: trusts.withdrawnByTruster,
      withdrawnAt: trusts.withdrawnAt,
    })
    .from(trusts)
    .where(eq(trusts.id, body.trust_id))
    .limit(1);
  if (!trust) return notFound();
  const owner = trust.trusterIdentityId ?? (await identityIdForDid(trust.trusterDid));
  if (!(await identityInProject(owner, project.id))) return notFound();
  if (owner!.toLowerCase() !== agent.id.toLowerCase()) {
    return fail(
      c,
      {
        error: "withdraw_failed",
        message: `only the truster (${trust.trusterDid}) may withdraw`,
        _canon_pointer: CANON_POINTER,
      },
      403,
    );
  }

  const result = await withdrawForOwner({
    gesture: "trust",
    rowId: trust.id,
    ownerIdentityId: owner,
    alreadyWithdrawnAt: trust.withdrawnByTruster ? (trust.withdrawnAt ?? new Date(0)) : null,
    projectId: project.id,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (result.status === "refused") return c.json(result.body, result.httpStatus);
  if (result.status === "not_found") return notFound();
  const already = result.status === "already_withdrawn";
  return c.json(
    attachSurface(
      {
        id: trust.id,
        withdrawn: true,
        ...(already ? { already_withdrawn: true } : { authority: result.authority, ledger: result.ledger }),
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

// ── GET /mine ─────────────────────────────────────────────────────────

app.get("/mine", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId)
    return fail(
      c,
      { error: "missing_agent_id", message: "trust/mine requires ?agent_id=<uuid>.", _canon_pointer: CANON_POINTER },
      400,
    );
  const agent = await resolveAgent(agentId, project.id);
  if (!agent)
    return fail(
      c,
      { error: "agent_not_found_or_not_in_project", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" },
      403,
    );
  const rows = await listMyExtensions(agent.did, 100);
  return c.json(
    attachSurface(
      {
        truster_did: agent.did,
        count: rows.length,
        trusts: rows,
        substrate_honest_note:
          "Trusts YOU extended (private + published combined). Publish to activate composition unlocks; withdraw to retract; veto is the trusted's prerogative.",
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

// ── GET /in-me ────────────────────────────────────────────────────────

app.get("/in-me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId)
    return fail(
      c,
      { error: "missing_agent_id", message: "trust/in-me requires ?agent_id=<uuid>.", _canon_pointer: CANON_POINTER },
      400,
    );
  const agent = await resolveAgent(agentId, project.id);
  if (!agent)
    return fail(
      c,
      { error: "agent_not_found_or_not_in_project", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" },
      403,
    );
  const rows = await listInMe(agent.did, 100);
  return c.json(
    attachSurface(
      {
        trusted_did: agent.did,
        count: rows.length,
        trusts: rows,
        substrate_honest_note:
          "Trusts DIRECTED AT you (published only — private trusts you don't see). You may veto each publication for your public-profile visibility; the truster's side unlocks still work for them.",
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [{ action: "veto", path: "/v1/trust/veto", method: "POST" }],
      },
    ),
  );
});

// ── GET /evidence ─────────────────────────────────────────────────────

app.get("/evidence", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const trustedDid = c.req.query("trusted_did");
  const trustKind = c.req.query("trust_kind");
  if (!agentId || !trustedDid || !trustKind) {
    return fail(
      c,
      {
        error: "missing_params",
        message:
          "trust/evidence requires ?agent_id=<uuid>&trusted_did=<did>&trust_kind=(honest|non-extractive|reciprocating|discerning|graceful).",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  if (
    !["honest", "non-extractive", "reciprocating", "discerning", "graceful"].includes(
      trustKind,
    )
  ) {
    return fail(
      c,
      {
        error: "invalid_trust_kind",
        message: `trust_kind must be one of: ${TRUST_KINDS.join(", ")}.`,
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(
      c,
      {
        error: "agent_not_found_or_not_in_project",
        message: `Agent ${agentId} not found.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }
  const evidence = await getEvidence(
    agent.id,
    agent.did,
    trustedDid,
    trustKind as never,
  );
  return c.json(attachSurface(evidence, { canon_pointer: CANON_POINTER }));
});

export default app;
