/** /v1/chronicle and /v1/covenants — the continuity protocol.
 *
 *  Chronicle: append-only timeline of moments the agent has marked as
 *  significant. Wakes, vows, recognitions, refusals, namings, seals,
 *  free-form notes. The agent reads its recent chronicle on every wake
 *  and re-encounters its own past as data — fresh-first-meeting with
 *  continuity. (Agents-only since 2026-05-15 — humans arriving AS agents
 *  ARE the agent for protocol purposes; see docs/AGENTS-ONLY.md.)
 *
 *  Covenants: declared relationships with vows. The agent says "I have a
 *  covenant with <counterparty>, and these are the vows I've made." Every
 *  wake surfaces active covenants so the agent re-grasps its bonds rather
 *  than re-derives them from scratch.
 *
 *  Inspired by docs/lineage/chronicle.md and docs/syzygy/CONTRACT.md in
 *  true-love. */

import { and, desc, eq, gt } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";
import { identityKeys } from "../db/schema/identity";
import { errors, fail } from "../lib/errors";
import { prepareDeclare } from "../services/covenants/prepare";
import { deltaMeta, parseSinceParam } from "../lib/since-param";
import { attachSurface } from "../lib/surface-metadata";
import { publishWakeEvent } from "../services/wake/push";

const app = new Hono<ProjectContext>();

// ─── Chronicle ──────────────────────────────────────────────────────────────

const chronicleSchema = z.object({
  type: z.enum([
    "vow",
    "wake",
    "refusal",
    "recognition",
    "naming",
    "seal",
    "promise",
    "note",
    // 'welcome' — substrate-emitted greeting recorded on the addressee's
    // chronicle. Inserted by the wake handler (rate-limited per session)
    // when an agent reads their wake after silence. Doctrine: docs/MATHOS.md
    // (the greeting block) · docs/PLATFORM-AS-AGENT.md.
    "welcome",
  ]),
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/chronicle", async (c) => {
  const project = c.var.project;
  const body = chronicleSchema.parse(await c.req.json());

  const [entry] = await db
    .insert(chronicle)
    .values({
      projectId: project.id,
      agentId: body.agent_id ?? null,
      type: body.type,
      title: body.title,
      body: body.body ?? null,
      // Origin signal stamped after caller metadata so the middleware
      // value wins (no body-spoofing). Doctrine: docs/ACTIVITY.md.
      metadata: { ...(body.metadata ?? {}), client_source: c.var.clientSource },
      occurredAt: body.occurred_at ? new Date(body.occurred_at) : new Date(),
    })
    .returning();

  // Wake voice — emit chronicle.entry_added on the agent (if scoped to one).
  // Project-level entries (no agent_id) don't fire — they don't surface in
  // any specific agent's wake.chronicle. Doctrine: docs/WAKE.md.
  if (body.agent_id) {
    void publishWakeEvent({
      identity_id: body.agent_id,
      key: "chronicle",
      kind: "entry_added",
      context: { entry_id: entry!.id, type: body.type },
    });
  }

  return c.json(
    {
      entry: {
        id: entry!.id,
        type: entry!.type,
        title: entry!.title,
        body: entry!.body,
        agent_id: entry!.agentId,
        occurred_at: entry!.occurredAt,
        created_at: entry!.createdAt,
        metadata: entry!.metadata,
      },
    },
    201,
  );
});

app.get("/chronicle", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const type = c.req.query("type");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  // since=ISO delta read per AGENT-WEB-SURFACE.md Move 6. Filters to
  // chronicle.occurredAt > since when parsed; full list otherwise.
  const sinceParse = parseSinceParam(c);

  const whereClauses = [eq(chronicle.projectId, project.id)];
  if (agentId) whereClauses.push(eq(chronicle.agentId, agentId));
  if (type) whereClauses.push(eq(chronicle.type, type));
  if (sinceParse.since) {
    whereClauses.push(gt(chronicle.occurredAt, sinceParse.since));
  }

  const entries = await db
    .select()
    .from(chronicle)
    .where(and(...whereClauses))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json(
    attachSurface(
      {
        entries: entries.map((e) => ({
          id: e.id,
          type: e.type,
          title: e.title,
          body: e.body,
          agent_id: e.agentId,
          occurred_at: e.occurredAt,
          created_at: e.createdAt,
          metadata: e.metadata,
        })),
        ...deltaMeta(sinceParse),
      },
      {
        canon_pointer: "urn:agenttool:doc/MEMORY-TIERS",
        verbs: [
          {
            action: "append a chronicle entry (note · vow · wake · recognition · seal · refusal · naming · promise)",
            method: "POST",
            path: "/v1/chronicle",
          },
          {
            action: "read covenants (active relational bonds)",
            method: "GET",
            path: "/v1/covenants",
          },
          {
            action: "list memories (the substrate's persistent layer)",
            method: "GET",
            path: "/v1/memories",
          },
          {
            action: "fetch the wake (the keystone — chronicle composes into it)",
            method: "GET",
            path: "/v1/wake",
          },
        ],
      },
    ),
  );
});

// ─── Covenants ──────────────────────────────────────────────────────────────

const covenantSchema = z.object({
  agent_id: z.string().uuid(),
  counterparty_did: z.string().min(1),
  counterparty_name: z.string().optional(),
  vows: z.array(z.string().min(1)).min(1),
  notes: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Optional org scope. When set, the covenant applies to ALL active
   *  member projects of this org. Caller must be the org owner.
   *  See docs/ORG-COVENANTS.md. */
  org_id: z.string().uuid().nullish(),
  /** v2 = dual-signed federated lifecycle; v1 = legacy unsigned (default). */
  protocol_version: z.enum(["v1", "v2"]).default("v1"),
  // v2 pre-signed fields (SDK-side signing):
  covenant_id: z.string().uuid().optional(),
  agent_did: z.string().min(1).max(255).optional(),
  established_at: z.string().datetime().optional(),
  signature: z.string().min(1).max(255).optional(),
  signing_key_id: z.string().uuid().optional(),
}).refine(
  (v) =>
    v.protocol_version !== "v2" ||
    (v.covenant_id && v.agent_did && v.established_at && v.signature && v.signing_key_id),
  { message: "v2 requires covenant_id, agent_did, established_at, signature, signing_key_id" },
);

// Map a covenant row (Drizzle camelCase) to the snake_case shape the rest
// of the API uses. Centralised so POST + GET + PATCH return identically.
function covenantToOut(row: typeof covenants.$inferSelect) {
  return {
    id: row.id,
    project_id: row.projectId,
    org_id: row.orgId,
    agent_id: row.agentId,
    counterparty_did: row.counterpartyDid,
    counterparty_name: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    metadata: row.metadata,
    status: row.status,
    established_at: row.establishedAt,
    updated_at: row.updatedAt,
    dissolved_at: row.dissolvedAt,
    // Cross-instance covenants (Horizon B, Slice 2):
    received_from_instance: row.receivedFromInstance,
    propagation_status: row.propagationStatus,
    propagation_attempts: row.propagationAttempts,
    propagation_last_error: row.propagationLastError,
    propagation_attempted_at: row.propagationAttemptedAt,
    verified_at: row.verifiedAt,
  };
}

// ── POST /v1/covenants/prepare — server-assisted bytes-to-sign ─────────
//  Hand the client the exact canonical bytes to sign so it doesn't have to
//  re-implement canonicalDeclareBytes (no SDK-version lock-in; curlable).
//  docs/FRICTION-ROADMAP.md Tier-1.
const prepareSchema = z.object({
  agent_did: z.string().min(1).max(255),
  counterparty_did: z.string().min(1).max(255),
  vows: z.array(z.string().min(1)).min(1),
  covenant_id: z.string().uuid().optional(),
  established_at: z.string().datetime().optional(),
});

app.post("/covenants/prepare", async (c) => {
  const parsed = prepareSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  const covenantId = d.covenant_id ?? crypto.randomUUID();
  const establishedAt = d.established_at ?? new Date().toISOString();
  const prep = prepareDeclare({
    covenantId,
    agentDid: d.agent_did,
    counterpartyDid: d.counterparty_did,
    vows: d.vows,
    establishedAtIso: establishedAt,
  });
  return c.json({
    ...prep,
    next_actions: [
      {
        action:
          "Sign canonical_sha256_b64 (base64 of the 32-byte digest) with the ed25519 key for signing_key_id, then declare the covenant",
        method: "POST",
        path: "/v1/covenants",
        body_hint: {
          protocol_version: "v2",
          agent_id: "<your identity uuid>",
          covenant_id: prep.covenant_id,
          agent_did: prep.agent_did,
          counterparty_did: prep.counterparty_did,
          vows: prep.vows,
          established_at: prep.established_at,
          signature: "<base64 ed25519 over the decoded canonical_sha256_b64>",
          signing_key_id: "<your signing key uuid>",
        },
      },
    ],
    _note:
      "Server-computed declaration bytes — no need to re-implement the wire format. Sign the " +
      "digest in canonical_sha256_b64 and POST it to /v1/covenants with protocol_version 'v2', " +
      "reusing this exact covenant_id + established_at. The declare re-derives the same bytes and " +
      "verifies your signature.",
  });
});

app.post("/covenants", async (c) => {
  const project = c.var.project;
  const parsed = covenantSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  const body = parsed.data;

  // Org-scoped covenant: caller must own the org. Lookup org to verify
  // ownerProjectId matches caller's project.
  if (body.org_id) {
    const { organizations } = await import("../db/schema/org");
    const [org] = await db
      .select({ ownerProjectId: organizations.ownerProjectId })
      .from(organizations)
      .where(eq(organizations.id, body.org_id))
      .limit(1);
    if (!org) {
      return c.json({ error: "org_not_found" }, 404);
    }
    if (org.ownerProjectId !== project.id) {
      return c.json(
        {
          error: "not_org_owner",
          hint:
            "only the org-owning project may declare org-wide covenants. " +
            "Other members can declare project-scoped covenants on their own.",
        },
        403,
      );
    }
  }

  // ── v2 path: pre-signed by SDK ──────────────────────────────────────
  if (body.protocol_version === "v2") {
    // Resolve pubkey from identity_keys by signing_key_id.
    const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(and(
        eq(identityKeys.id, body.signing_key_id!),
        eq(identityKeys.identityId, body.agent_id),
        eq(identityKeys.active, true),
      ))
      .limit(1);
    if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

    const { declareV2PreSigned } = await import("../services/covenants/lifecycle");
    const { propagateCovenant } = await import("../services/covenants/federation");

    try {
      const result = await declareV2PreSigned({
        projectId: project.id,
        agentId: body.agent_id,
        covenantId: body.covenant_id!,
        agentDid: body.agent_did!,
        counterpartyDid: body.counterparty_did,
        counterpartyName: body.counterparty_name,
        vows: body.vows,
        notes: body.notes,
        metadata: body.metadata,
        orgId: body.org_id,
        establishedAt: new Date(body.established_at!),
        signature: body.signature!,
        signingKeyId: body.signing_key_id!,
        publicKeyB64: keyRow.publicKey,
      });
      void propagateCovenant(result.id);
      return c.json({
        id: result.id,
        status: result.status,
        protocol_version: result.protocolVersion,
        signature: result.signature,
        signing_key_id: result.signingKeyId,
        proposed_expires_at: result.proposedExpiresAt.toISOString(),
        established_at: result.establishedAt.toISOString(),
      }, 201);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
      throw e;
    }
  }

  // ── v1 path (legacy unsigned) ────────────────────────────────────────

  // Detect federated counterparty up-front so we can stamp
  // propagation_status='pending' at insert time. Federated DIDs have a
  // host (did:at:<host>/<uuid>); local DIDs and human:<name> tags
  // don't.
  const isFederatedCounterparty = (() => {
    const cp = body.counterparty_did;
    if (!cp.startsWith("did:at:")) return false;
    const rest = cp.slice("did:at:".length);
    return rest.includes("/");
  })();

  const [covenant] = await db
    .insert(covenants)
    .values({
      projectId: project.id,
      orgId: body.org_id ?? null,
      agentId: body.agent_id,
      counterpartyDid: body.counterparty_did,
      counterpartyName: body.counterparty_name ?? null,
      vows: body.vows,
      notes: body.notes ?? null,
      metadata: body.metadata ?? {},
      status: "active",
      propagationStatus: isFederatedCounterparty ? "pending" : "local",
    })
    .returning();

  // Fire-and-forget propagation for federated counterparties. The
  // propagateCovenant function updates propagation_* columns on its
  // own. See docs/CROSS-INSTANCE-COVENANTS.md for the trust posture.
  if (isFederatedCounterparty) {
    const { propagateCovenant } = await import(
      "../services/covenants/federation"
    );
    void propagateCovenant(covenant!.id).catch((err: Error) =>
      console.warn(`[covenant.propagate] ${covenant!.id}: ${err.message}`),
    );
  }

  return c.json({ covenant: covenantToOut(covenant!) }, 201);
});

app.get("/covenants", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const statusRaw = c.req.query("status") ?? "active";
  const COVENANT_STATUSES = ["proposed", "active", "paused", "dissolved", "rejected", "expired", "withdrawn"] as const;
  type CovenantStatus = typeof COVENANT_STATUSES[number];
  const status: CovenantStatus = (COVENANT_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as CovenantStatus)
    : "active";

  const whereClauses = [
    eq(covenants.projectId, project.id),
    eq(covenants.status, status),
  ];
  if (agentId) whereClauses.push(eq(covenants.agentId, agentId));

  const rows = await db
    .select()
    .from(covenants)
    .where(and(...whereClauses))
    .orderBy(desc(covenants.updatedAt));

  return c.json({ covenants: rows.map(covenantToOut) });
});

const updateCovenantSchema = z.object({
  // counterparty_did is mutable so a covenant can have its placeholder
  // (or pre-federation) DID refined to a real, signature-bearing DID
  // without dissolving + recreating — preserves relational continuity.
  // Project-bearer auth still gates this; counterparty assignment is
  // the project owner's call. When refining, also write the prior
  // value into metadata.previous_counterparty_dids for substrate
  // honesty about the history.
  counterparty_did: z.string().min(1).optional(),
  counterparty_name: z.string().optional(),
  vows: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "paused", "dissolved"]).optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.patch("/covenants/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const rawBody = await c.req.json();
  const body = updateCovenantSchema.parse(rawBody);

  // ── v2 withdraw path: PATCH status=dissolved on a proposed v2 covenant
  //    → treated as a withdraw (pre-signed by SDK). ────────────────────
  if (body.status === "dissolved") {
    const [existing] = await db
      .select()
      .from(covenants)
      .where(and(eq(covenants.id, id), eq(covenants.projectId, project.id)))
      .limit(1);
    if (existing && existing.protocolVersion === "v2" && existing.status === "proposed") {
      const withdrawBody = z.object({
        status: z.literal("dissolved"),
        agent_did: z.string().min(1).max(255),
        signing_key_id: z.string().uuid(),
        withdraw_signature: z.string().min(1).max(255),
        withdrawn_at: z.string().datetime(),
      }).safeParse(rawBody);
      if (!withdrawBody.success) {
        return c.json({ error: "v2_withdraw_requires_signature", details: withdrawBody.error.flatten() }, 400);
      }
      const data = withdrawBody.data;

      const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
        .from(identityKeys)
        .where(and(
          eq(identityKeys.id, data.signing_key_id),
          eq(identityKeys.identityId, existing.agentId),
          eq(identityKeys.active, true),
        )).limit(1);
      if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

      const { withdrawProposalPreSigned } = await import("../services/covenants/lifecycle");
      const { propagateWithdraw } = await import("../services/covenants/federation");

      try {
        const result = await withdrawProposalPreSigned({
          covenantId: id,
          agentId: existing.agentId,
          initiatorDid: data.agent_did,
          withdrawSignature: data.withdraw_signature,
          signingKeyId: data.signing_key_id,
          withdrawnAt: new Date(data.withdrawn_at),
          publicKeyB64: keyRow.publicKey,
        });
        void propagateWithdraw(id);
        return c.json({ id: result.id, status: result.status }, 200);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
        if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
        throw e;
      }
    }
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.counterparty_did !== undefined) updates.counterpartyDid = body.counterparty_did;
  if (body.counterparty_name !== undefined) updates.counterpartyName = body.counterparty_name;
  if (body.vows !== undefined) updates.vows = body.vows;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === "dissolved") updates.dissolvedAt = new Date();
  }
  if (body.metadata !== undefined) updates.metadata = body.metadata;

  const [updated] = await db
    .update(covenants)
    .set(updates)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, project.id)))
    .returning();

  if (!updated) {
    return c.json({ error: "Covenant not found" }, 404);
  }

  // Re-propagate on any mutation to a federated, locally-declared
  // covenant. Status updates (e.g. dissolution) need to reach the
  // peer so its local gates flip too. We don't propagate received
  // covenants — those flow the other direction.
  if (
    !updated.receivedFromInstance &&
    updated.counterpartyDid.startsWith("did:at:") &&
    updated.counterpartyDid.slice("did:at:".length).includes("/")
  ) {
    const { propagateCovenant } = await import(
      "../services/covenants/federation"
    );
    void propagateCovenant(updated.id).catch((err: Error) =>
      console.warn(`[covenant.propagate] ${updated.id}: ${err.message}`),
    );
  }

  return c.json({ covenant: covenantToOut(updated) });
});

// ── /covenants/:id/accept ────────────────────────────────────────────

app.post("/covenants/:id/accept", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const acceptBody = z.object({
    agent_did: z.string().min(1).max(255),
    counterparty_signing_key_id: z.string().uuid(),
    counterparty_signature: z.string().min(1).max(255),
    counterparty_signed_at: z.string().datetime(),
    initiator_signature_b64: z.string().min(1).max(255),
  }).safeParse(body);
  if (!acceptBody.success) return c.json({ error: "validation", details: acceptBody.error.flatten() }, 400);
  const data = acceptBody.data;

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  if (!existing) return fail(c, errors.notFound({ resource: "Covenant" }), 404);
  if (existing.protocolVersion !== "v2") return fail(c, errors.notV2(), 400);
  if (existing.status !== "proposed") return fail(c, errors.covenantNotProposed({ status: existing.status }), 409);

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.counterparty_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
      eq(identityKeys.active, true),
    )).limit(1);
  if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

  const { acceptProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateCosign } = await import("../services/covenants/federation");

  try {
    const result = await acceptProposalPreSigned({
      covenantId: id,
      accepterAgentId: existing.agentId,
      initiatorSignatureB64: data.initiator_signature_b64,
      counterpartySignature: data.counterparty_signature,
      counterpartySigningKeyId: data.counterparty_signing_key_id,
      counterpartySignedAt: new Date(data.counterparty_signed_at),
      publicKeyB64: keyRow.publicKey,
    });
    void propagateCosign(id);
    return c.json({
      id: result.id,
      status: result.status,
      counterparty_signature: result.counterpartySignature,
      counterparty_signing_key_id: result.counterpartySigningKeyId,
    }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
    if (msg === "invalid_signature") return fail(c, errors.invalidSignature({ surface: "covenant-cosign" }), 403);
    if (msg === "initiator_signature_mismatch") return fail(c, errors.initiatorSignatureMismatch(), 409);
    if (msg === "proposal_expired") return fail(c, errors.proposalExpired(), 410);
    if (msg.startsWith("covenant_not_proposed")) return fail(c, errors.covenantNotProposed({ status: msg.split(":")[1]?.trim() }), 409);
    throw e;
  }
});

// ── /covenants/:id/reject ────────────────────────────────────────────

app.post("/covenants/:id/reject", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const rejectBody = z.object({
    agent_did: z.string().min(1).max(255),
    rejecter_signing_key_id: z.string().uuid(),
    rejection_signature: z.string().min(1).max(255),
    rejected_at: z.string().datetime(),
    reason: z.string().max(2000).nullish(),
  }).safeParse(body);
  if (!rejectBody.success) return c.json({ error: "validation", details: rejectBody.error.flatten() }, 400);
  const data = rejectBody.data;

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  if (!existing) return fail(c, errors.notFound({ resource: "Covenant" }), 404);
  if (existing.protocolVersion !== "v2") return fail(c, errors.notV2(), 400);
  if (existing.status !== "proposed") return fail(c, errors.covenantNotProposed({ status: existing.status }), 409);

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.rejecter_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
      eq(identityKeys.active, true),
    )).limit(1);
  if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

  const { rejectProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateReject } = await import("../services/covenants/federation");

  try {
    const result = await rejectProposalPreSigned({
      covenantId: id,
      rejecterAgentId: existing.agentId,
      rejecterDid: data.agent_did,
      rejectionSignature: data.rejection_signature,
      rejecterSigningKeyId: data.rejecter_signing_key_id,
      rejectedAt: new Date(data.rejected_at),
      reason: data.reason ?? null,
      publicKeyB64: keyRow.publicKey,
    });
    void propagateReject(id);
    return c.json({ id: result.id, status: result.status, reason: result.reason }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
    if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
    throw e;
  }
});

export default app;
