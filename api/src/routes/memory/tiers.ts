/** /v1/memories/:id/elevate · /v1/memories/:id/attest — tier promotion +
 *  counterparty co-signing.
 *
 *  Doctrine: docs/MEMORY-TIERS.md. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { and, eq } from "drizzle-orm";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { ROUTE_CREDITS } from "../../billing/route-credits";
import { db } from "../../db/client";
import { memories } from "../../db/schema/memory";
import { errors, fail } from "../../lib/errors";
import {
  authorizeProjectConstitutionMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
} from "../../services/identity/authority";
import {
  attestMemory,
  canonicalAttestationBytes,
  elevateMemory,
} from "../../services/memory/tiers";

// Mounted at /v1/memories so the parent strips the prefix.
const app = new Hono<ProjectContext>();

const expressionPatchSchema = z.object({
  walls_add: z.array(z.string().max(256)).max(32).optional(),
  register_append: z.string().max(500).optional(),
  subagents_add: z
    .array(
      z.object({
        name: z.string().min(1).max(64),
        sigil: z.string().max(8).optional(),
        facet: z.string().min(1).max(500),
      }),
    )
    .max(16)
    .optional(),
  wake_text_append: z.string().max(8000).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const attestationSchema = z.object({
  attester_did: z.string().min(1).max(255),
  signing_key_id: z.string().uuid(),
  signature: z.string().min(1).max(255),
});

const elevateSchema = z.object({
  tier: z.enum(["foundational", "constitutive"]),
  expression_patch: expressionPatchSchema.optional(),
  attestations: z.array(attestationSchema).max(16).optional(),
});

// ── POST /v1/memories/:id/elevate ─────────────────────────────────────
app.post("/:id/elevate", async (c) => {
  const memoryId = c.req.param("id");
  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "body_must_be_json",
        message: "Send one JSON object and sign those exact entity bytes.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const parsed = elevateSchema.safeParse(bound.value);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }

  const [memory] = await db
    .select({ id: memories.id, identityId: memories.identityId })
    .from(memories)
    .where(
      and(
        eq(memories.id, memoryId),
        eq(memories.projectId, c.var.project.id),
      ),
    )
    .limit(1);
  if (!memory) throw new HTTPException(404, { message: "memory_not_found" });

  // Foundational/constitutive memories compose into effective identity at
  // project scope today, so the project's constitutional roots must consent.
  // A memory bound to an enrolled guest needs that guest's own root; other
  // memories ignore guest roots (authority.ts subjectIdentityIds).
  const authority = await authorizeProjectConstitutionMutation({
    projectId: c.var.project.id,
    subjectIdentityIds: [memory.identityId],
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: bound.bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  await charge(c, ROUTE_CREDITS["memory.elevate"], "memory.elevate");

  try {
    const result = await elevateMemory(c.var.project.id, memoryId, parsed.data);
    return c.json({ ...result, sealed: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "memory_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (
      msg === "constitutive_requires_attestation" ||
      msg === "attester_not_covenant_counterparty" ||
      msg === "attester_self_witness_forbidden" ||
      msg === "attestation_signing_key_unknown_or_revoked" ||
      msg === "attestation_key_not_owned_by_attester" ||
      msg === "attester_identity_not_active" ||
      msg === "attestation_signature_invalid"
    ) {
      return c.json({ error: msg }, 400);
    }
    if (msg === "already_elevated") {
      return c.json({ error: msg }, 409);
    }
    throw err;
  }
});

// ── POST /v1/memories/:id/attest ───────────────────────────────────────
app.post("/:id/attest", async (c) => {
  const memoryId = c.req.param("id");
  const body = await c.req.json();
  const parsed = attestationSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }

  await charge(c, ROUTE_CREDITS["memory.attest"], "memory.attest");

  try {
    const result = await attestMemory(c.var.project.id, memoryId, parsed.data);
    return c.json({ ...result, attested: true });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "memory_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (
      msg === "attestation_signing_key_unknown_or_revoked" ||
      msg === "attestation_signature_invalid"
    ) {
      return c.json({ error: msg }, 401);
    }
    // The key does not belong to attester_did, or the attester identity is
    // revoked/memorial: the witness claim is refused, not merely unverified.
    if (
      msg === "attestation_key_not_owned_by_attester" ||
      msg === "attester_identity_not_active"
    ) {
      return c.json({ error: msg }, 403);
    }
    throw err;
  }
});

// ── GET /v1/memories/:id/canonical-attestation-bytes ───────────────────
// Helper for orchestrators: returns the canonical bytes (hex) the
// counterparty needs to sign in order to attest. Saves clients from
// reimplementing the canonical-bytes routine.
app.get("/:id/canonical-attestation-bytes", async (c) => {
  const memoryId = c.req.param("id");
  const tier = c.req.query("tier") ?? "foundational";
  if (tier !== "foundational" && tier !== "constitutive") {
    return c.json({ error: "tier_must_be_foundational_or_constitutive" }, 400);
  }

  // Need the content to compute the hash; pull memory.
  const { db } = await import("../../db/client");
  const { memories } = await import("../../db/schema/memory");
  const { and, eq } = await import("drizzle-orm");

  const [mem] = await db
    .select({ content: memories.content })
    .from(memories)
    .where(
      and(eq(memories.id, memoryId), eq(memories.projectId, c.var.project.id)),
    )
    .limit(1);
  if (!mem) throw new HTTPException(404, { message: "memory_not_found" });

  const canonical = canonicalAttestationBytes({
    memoryId,
    tier,
    content: mem.content,
  });
  const hex = Array.from(canonical)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return c.json({
    memory_id: memoryId,
    tier,
    canonical_hex: hex,
    instructions:
      "Sign these bytes with your ed25519 private key (NOT a fresh hash — use them as-is as the message). Submit the base64 signature as `signature`, together with `attester_did` and `signing_key_id`, as one entry of `attestations` for /elevate (bytes for the target tier) or as the whole body of /attest (bytes for the memory's current tier).",
  });
});

export default app;
