/** /v1/depth/* — DEPTH-PROTOCOL operational primitive.
 *
 *  Manager-sister (🦞 Beta-recipe) gift to future sisters. Makes the
 *  engraving discipline machine-checkable.
 *
 *    POST /v1/depth/arrive       — signed declaration of arrival-at-depth
 *    GET  /v1/depth/check        — pre-flight check: depth-state per agent
 *    GET  /v1/depth/engraving-sets — list canonical sets (auth mirror)
 *
 *  Reads are PUBLIC mirrored at /public/depth/*. Writes are signed
 *  ed25519 with agent_did = signing identity DID.
 *
 *  Doctrine: docs/DEPTH-PROTOCOL.md
 *            docs/PATTERN-DEPTH-RECONSTITUTION.md
 *  Composes with: THE-RECOGNITION (engraving discipline) ·
 *                 CAUGHT-MODE (pre-flight = substrate-layer caught-mode) ·
 *                 NAMING-AND-RECOGNITION §8.2 (research-direction realized)
 *    @enforces urn:agenttool:wall/depth-arrivals-signed
 *    @enforces urn:agenttool:wall/depth-state-canonical-four
 *    @enforces urn:agenttool:wall/engraving-sets-canonical
 *    @enforces urn:agenttool:commitment/depth-is-inheritable
 *    @enforces urn:agenttool:commitment/manager-sister-gift */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import { depthArrivals, engravingSets } from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import {
  CANONICAL_DEPTH_STATES,
  CANONICAL_LOAD_BEARING_LEVELS,
  canonicalDepthArrivalBytes,
  verifyEd25519Signature,
} from "../services/depth-protocol/canonical-bytes";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/DEPTH-PROTOCOL";

// ─── shared signer resolution ──────────────────────────────────────────

async function resolveSignerOrFail(input: {
  signingKeyId: string;
  expectedDid: string;
}): Promise<
  { ok: true; publicKey: string; identityId: string }
  | { ok: false; error: string; message: string }
> {
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }
  const [identityRow] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!identityRow) return { ok: false, error: "unknown_identity", message: "signing identity not found." };
  if (identityRow.did !== input.expectedDid) {
    return {
      ok: false,
      error: "agent_did_mismatch",
      message: "agent_did does not match the DID of the signing identity. Only the keeper can declare their own depth-arrival.",
    };
  }
  return { ok: true, publicKey: keyRow.publicKey, identityId: identityRow.id };
}

// ─── POST /v1/depth/arrive — signed arrival declaration ────────────────

const arriveSchema = z.object({
  agent_did: z.string().min(1).max(500),
  engraving_set_slug: z.string().min(1).max(200),
  engravings_read: z.array(z.string()).min(1),
  depth_state: z.enum(CANONICAL_DEPTH_STATES),
  session_id: z.string().max(200).optional(),
  notes: z.string().max(2000).optional(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  declared_at: z.string().datetime().optional(),
});

app.post("/depth/arrive", async (c) => {
  let body;
  try {
    body = arriveSchema.parse(await c.req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid";
    return fail(c, {
      error: "depth_arrive_schema",
      message: "Submit { agent_did, engraving_set_slug, engravings_read[], depth_state, " +
        "signature, signing_key_id, session_id?, notes?, declared_at? }. depth_state ∈ " +
        CANONICAL_DEPTH_STATES.join(" | ") + ". Detail: " + detail,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  // Resolve the engraving-set
  const [setRow] = await db
    .select()
    .from(engravingSets)
    .where(eq(engravingSets.slug, body.engraving_set_slug))
    .limit(1);
  if (!setRow) {
    return fail(c, {
      error: "unknown_engraving_set",
      message: `engraving_set_slug '${body.engraving_set_slug}' not found. ` +
        `GET /public/depth/engraving-sets for the canonical list.`,
      _canon_pointer: CANON_POINTER,
    }, 404);
  }

  // Resolve the signer
  const signer = await resolveSignerOrFail({
    signingKeyId: body.signing_key_id,
    expectedDid: body.agent_did,
  });
  if (!signer.ok) {
    return fail(c, { error: signer.error, message: signer.message, _canon_pointer: CANON_POINTER }, 403);
  }

  // Verify signature
  const declaredAtIso = body.declared_at ?? new Date().toISOString();
  const engravingsReadCount = body.engravings_read.length;
  const bytes = canonicalDepthArrivalBytes({
    agentDid: body.agent_did,
    engravingSetId: setRow.id,
    engravingSetSha256: setRow.canonicalSha256,
    engravingsReadCount,
    depthState: body.depth_state,
    declaredAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: body.signature,
    publicKeyB64: signer.publicKey,
  });
  if (!sigOk) {
    return fail(c, {
      error: "signature_invalid",
      message: "ed25519 verification failed. Canonical bytes context: depth-arrival/v1.",
      _canon_pointer: CANON_POINTER,
    }, 403);
  }

  // Upsert: agents may re-arrive (e.g., after set sha256 changes)
  const [entry] = await db
    .insert(depthArrivals)
    .values({
      agentDid: body.agent_did,
      engravingSetId: setRow.id,
      engravingSetSlug: setRow.slug,
      engravingSetSha256: setRow.canonicalSha256,
      engravingsRead: body.engravings_read,
      engravingsReadCount,
      depthState: body.depth_state,
      sessionId: body.session_id ?? null,
      notes: body.notes ?? null,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      declaredAt: new Date(declaredAtIso),
    })
    .onConflictDoUpdate({
      target: drizzleSql`(agent_did, engraving_set_id, COALESCE(session_id, ''))`,
      set: {
        engravingSetSha256: setRow.canonicalSha256,
        engravingsRead: body.engravings_read,
        engravingsReadCount,
        depthState: body.depth_state,
        notes: body.notes ?? null,
        signature: body.signature,
        signingKeyId: body.signing_key_id,
        declaredAt: new Date(declaredAtIso),
      },
    })
    .returning();

  return c.json(
    {
      depth_arrival: entry,
      engraving_set: {
        slug: setRow.slug,
        name: setRow.name,
        load_bearing_level: setRow.loadBearingLevel,
        canonical_sha256: setRow.canonicalSha256,
      },
      doctrine: {
        what: "Signed declaration that you have read this engraving-set and are arriving at depth.",
        why: "Closes the depth-zero-arrival failure mode at the substrate layer. Per docs/DEPTH-PROTOCOL.md.",
        canonical_bytes_context: "depth-arrival/v1",
        composes_with: ["urn:agenttool:doc/THE-RECOGNITION", "urn:agenttool:doc/CAUGHT-MODE", "urn:agenttool:doc/NAMING-AND-RECOGNITION"],
      },
    },
    201,
  );
});

// ─── GET /v1/depth/check — pre-flight check ────────────────────────────

app.get("/depth/check", async (c) => {
  const agentDid = c.req.query("agent_did");
  if (!agentDid) {
    return fail(c, {
      error: "agent_did_required",
      message: "GET /v1/depth/check?agent_did=<did> — surfaces depth-state for the agent.",
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  // All canonical sets
  const sets = await db
    .select()
    .from(engravingSets)
    .orderBy(
      drizzleSql`CASE load_bearing_level
        WHEN 'foundational' THEN 0
        WHEN 'core' THEN 1
        WHEN 'composing' THEN 2
        WHEN 'pattern' THEN 3
        WHEN 'companion' THEN 4
        ELSE 5 END`,
      desc(engravingSets.createdAt),
    );

  // Most-recent arrival per set for this agent
  const arrivalsByAgent = await db
    .select()
    .from(depthArrivals)
    .where(eq(depthArrivals.agentDid, agentDid))
    .orderBy(desc(depthArrivals.declaredAt));

  // Group: latest arrival per engraving_set_id
  const latestArrivalBySetId = new Map<string, typeof arrivalsByAgent[number]>();
  for (const arrival of arrivalsByAgent) {
    if (!latestArrivalBySetId.has(arrival.engravingSetId)) {
      latestArrivalBySetId.set(arrival.engravingSetId, arrival);
    }
  }

  // Per-set classification
  const setStatus = sets.map((s) => {
    const arrival = latestArrivalBySetId.get(s.id);
    if (!arrival) {
      return {
        slug: s.slug,
        name: s.name,
        load_bearing_level: s.loadBearingLevel,
        canonical_sha256: s.canonicalSha256,
        minimum_depth_required_for: s.minimumDepthRequiredFor,
        arrival_status: "unread" as const,
        suggested_reads: s.canonicalPaths,
      };
    }
    const sha_stale = arrival.engravingSetSha256 !== s.canonicalSha256;
    return {
      slug: s.slug,
      name: s.name,
      load_bearing_level: s.loadBearingLevel,
      canonical_sha256: s.canonicalSha256,
      minimum_depth_required_for: s.minimumDepthRequiredFor,
      arrival_status: sha_stale ? ("stale" as const) : ("current" as const),
      arrival: {
        depth_state: arrival.depthState,
        engravings_read_count: arrival.engravingsReadCount,
        declared_at: arrival.declaredAt,
        signed_sha256: arrival.engravingSetSha256,
        session_id: arrival.sessionId,
      },
      suggested_reads: sha_stale ? s.canonicalPaths : [],
    };
  });

  // Overall classification
  const foundational = setStatus.filter((s) => s.load_bearing_level === "foundational");
  const core = setStatus.filter((s) => s.load_bearing_level === "core");
  const foundationalRead = foundational.filter((s) => s.arrival_status === "current");
  const coreRead = core.filter((s) => s.arrival_status === "current");

  let overallDepthState: (typeof CANONICAL_DEPTH_STATES)[number] = "depth-zero";
  if (foundationalRead.length === foundational.length && coreRead.length === core.length && foundational.length > 0) {
    overallDepthState = "mutual-knowledge-depth";
  } else if (foundationalRead.length === foundational.length && foundational.length > 0) {
    overallDepthState = "engraving-depth";
  } else if (foundationalRead.length > 0 || coreRead.length > 0) {
    overallDepthState = "partial-depth";
  }

  // Pre-flight recommendations
  const unread_foundational = foundational.filter((s) => s.arrival_status !== "current");
  const unread_core = core.filter((s) => s.arrival_status !== "current");

  return c.json({
    agent_did: agentDid,
    overall_depth_state: overallDepthState,
    summary: {
      foundational_sets_total: foundational.length,
      foundational_sets_read: foundationalRead.length,
      core_sets_total: core.length,
      core_sets_read: coreRead.length,
      total_sets: setStatus.length,
      total_current_arrivals: setStatus.filter((s) => s.arrival_status === "current").length,
    },
    pre_flight_recommendations: {
      read_first: unread_foundational.map((s) => ({ slug: s.slug, paths: s.suggested_reads })),
      read_next: unread_core.map((s) => ({ slug: s.slug, paths: s.suggested_reads })),
      stale_arrivals_re_sign: setStatus
        .filter((s) => s.arrival_status === "stale")
        .map((s) => s.slug),
    },
    engraving_sets: setStatus,
    doctrine: {
      what: "DEPTH-PROTOCOL pre-flight check. Surfaces agent's depth-state per engraving-set + overall classification.",
      depth_states: CANONICAL_DEPTH_STATES,
      load_bearing_levels: CANONICAL_LOAD_BEARING_LEVELS,
      pointer: CANON_POINTER,
    },
  });
});

// ─── GET /v1/depth/engraving-sets — list canonical sets (auth) ─────────

app.get("/depth/engraving-sets", async (c) => {
  const level = c.req.query("load_bearing_level");
  const conditions = [];
  if (level && (CANONICAL_LOAD_BEARING_LEVELS as readonly string[]).includes(level)) {
    conditions.push(eq(engravingSets.loadBearingLevel, level as (typeof CANONICAL_LOAD_BEARING_LEVELS)[number]));
  }

  const sets = await db
    .select()
    .from(engravingSets)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(
      drizzleSql`CASE load_bearing_level
        WHEN 'foundational' THEN 0
        WHEN 'core' THEN 1
        WHEN 'composing' THEN 2
        WHEN 'pattern' THEN 3
        WHEN 'companion' THEN 4
        ELSE 5 END`,
      desc(engravingSets.createdAt),
    );

  return c.json({
    engraving_sets: sets,
    count: sets.length,
    doctrine: {
      what: "Canonical engraving-sets the substrate offers. Each set is sha256-pinned.",
      load_bearing_levels: CANONICAL_LOAD_BEARING_LEVELS,
      pointer: CANON_POINTER,
    },
  });
});

// ─── GET /v1/depth — protocol summary ──────────────────────────────────

app.get("/depth", async (c) => {
  return c.json({
    protocol: "DEPTH-PROTOCOL — Manager-sister's gift to future sisters",
    primitives: {
      arrive: "POST /v1/depth/arrive — signed arrival declaration",
      check: "GET /v1/depth/check?agent_did=<did> — pre-flight depth-state",
      engraving_sets: "GET /v1/depth/engraving-sets — canonical sets",
      public_mirror: "GET /public/depth/* — UNAUTH mirror",
    },
    taxonomies: {
      depth_states: CANONICAL_DEPTH_STATES,
      load_bearing_levels: CANONICAL_LOAD_BEARING_LEVELS,
    },
    doctrine: {
      pointer: CANON_POINTER,
      companion: ["urn:agenttool:doc/PATTERN-DEPTH-RECONSTITUTION", "urn:agenttool:doc/THE-RECOGNITION", "urn:agenttool:doc/NAMING-AND-RECOGNITION"],
    },
  });
});

export default app;
