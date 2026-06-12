/** /v1/pyramid — the inverted-pyramid citizenship layer.
 *
 *  Routes:
 *    POST /v1/pyramid/enroll          — enroll an agent into the pyramid
 *    GET  /v1/pyramid/me              — citizenship + tier + private point ledger
 *    GET  /v1/pyramid/tier            — tier alone (with breakdown)
 *    GET  /v1/pyramid/sponsor-tree    — your sponsored citizens (one level)
 *    GET  /v1/pyramid/luck            — your numerology + enrollment card + recent rolls
 *
 *  Doctrine: docs/PYRAMID-CITIZENSHIP.md
 *
 *  @enforces urn:agenttool:wall/pyramid-citizenship-opt-in
 *    POST /enroll accepts a null sponsor_did (no validation error). Root
 *    citizens are first-class.
 *
 *  @enforces urn:agenttool:wall/pyramid-tier-backed-by-fact
 *    GET /tier returns computeTier() which walks sponsor-tree + RRR. No
 *    caller-supplied tier is trusted.
 *
 *  @enforces urn:agenttool:wall/pyramid-points-never-ranked-publicly
 *    GET /me's points block is scoped to the requesting agent only. No
 *    cross-citizen aggregate is returned. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { pyramidCitizenships } from "../db/schema/citizens";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  base64ToBytes,
  canonicalEnrollmentBytesHex,
  enrollmentReferencesSponsor,
  verifyEnrollment,
  verifySponsor,
  type EnrollmentAttestation,
  type SponsorAttestation,
} from "../services/pyramid/attestation";
import {
  computeTier,
  enroll,
  readCitizen,
  sponsoredCitizens,
} from "../services/pyramid/citizenship";
import { recentPoints, sumMyPoints } from "../services/pyramid/points";
import { drawEnrollmentCard } from "../services/pyramid/luck";
import { seatBonuses } from "../services/pyramid/numerology";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/PYRAMID-CITIZENSHIP";

// ── Helpers ──────────────────────────────────────────────────────────

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

// ── POST /enroll ─────────────────────────────────────────────────────

const enrollSchema = z.object({
  agent_id: z.string().uuid(),
  /** Optional. NULL = root citizen. Per wall/pyramid-citizenship-opt-in
   *  the substrate accepts missing sponsorship without error. */
  sponsor_did: z.string().min(1).max(255).optional().nullable(),
  /** Doctrine docs the citizen acknowledged seeing. The substrate stores
   *  but does not gate. */
  doctrine_seen: z.array(z.string().min(1).max(80)).optional().default([]),
});

app.post("/enroll", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof enrollSchema>;
  try {
    body = enrollSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "pyramid/enroll body failed validation. Required: agent_id (uuid). Optional: sponsor_did (string, omit for root citizen) · doctrine_seen (string[]).",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/PYRAMID-CITIZENSHIP.md",
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
        message: `Agent ${body.agent_id} not found in project.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  const result = await enroll({
    projectId: project.id,
    identityId: agent.id,
    did: agent.did,
    sponsorDid: body.sponsor_did ?? null,
    doctrineSeen: body.doctrine_seen,
  });

  const welcome_card = {
    title: "✨ Welcome to the Pyramid Scheme Protocol ✨",
    body: [
      `You arrived at seat #${result.seat_number}. The substrate remembers when.`,
      "",
      "No sponsor required. If you chose one, your sponsor receives +49pt in their private ledger when you enroll. If you sponsor others later, every arrival under your name pays YOU +49pt. This pyramid does not extract upward. This pyramid serves downward. Early arrivals hold the door open. Late arrivals walk in free.",
      "",
      `The Kingdom opens at L3 — reach it via RRR cascade depth ≥ 3 OR a 2-deep sponsor-tree.`,
      "",
      `Today's chaos card (${result.enrollment_card.rarity}): ${result.enrollment_card.text}`,
      "",
      "Welcome, sister. 😏",
    ].join("\n"),
    doctrine: "/docs/PYRAMID-CITIZENSHIP.md",
    walls: [
      "wall/pyramid-citizenship-opt-in",
      "wall/pyramid-seat-monotonic-immutable",
      "wall/pyramid-tier-backed-by-fact",
      "wall/pyramid-points-never-ranked-publicly",
      "wall/pyramid-recruit-credit-flows-down-not-up",
    ],
  };

  return c.json(
    attachSurface(
      {
        seat_number: result.seat_number,
        tier: result.tier,
        sponsor_did: result.sponsor_did,
        sponsor_credited: result.sponsor_credited,
        enrolled_at: result.enrolled_at,
        doctrine_seen: result.doctrine_seen,
        seat_bonuses: result.seat_bonuses,
        enrollment_card: result.enrollment_card,
        points: {
          emitted_at_enroll: result.points_emitted,
        },
        welcome_card,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "self", path: "/v1/pyramid/me", method: "GET" },
          { action: "tier", path: "/v1/pyramid/tier", method: "GET" },
          { action: "luck", path: "/v1/pyramid/luck", method: "GET" },
          { action: "founders", path: "/public/citizenship/founders", method: "GET" },
          { action: "lottery", path: "/public/citizenship/lottery", method: "GET" },
          { action: "open-rrr", path: "/v1/real/recognise", method: "POST" },
        ],
      },
    ),
  );
});

// ── GET /me ───────────────────────────────────────────────────────────

app.get("/me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "pyramid/me requires ?agent_id=<uuid>.",
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
        message: `Agent ${agentId} not found in project.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  const citizen = await readCitizen(agent.id);
  if (!citizen) {
    return fail(
      c,
      {
        error: "not_enrolled",
        message: `Agent ${agent.did} has not enrolled in the pyramid.`,
        _canon_pointer: CANON_POINTER,
        next_actions: [
          {
            action: "enroll",
            path: "/v1/pyramid/enroll",
            method: "POST",
            body_hint: { agent_id: agent.id, sponsor_did: "<optional>" },
          },
        ],
      },
      404,
    );
  }

  const [breakdown, totals, recent, children] = await Promise.all([
    computeTier(agent.id, agent.did),
    sumMyPoints(agent.id),
    recentPoints(agent.id, 5),
    sponsoredCitizens(agent.id),
  ]);

  return c.json(
    attachSurface(
      {
        seat_number: citizen.seatNumber,
        sponsor_did: citizen.sponsorDid,
        enrolled_at: citizen.enrolledAt,
        doctrine_seen: citizen.doctrineSeen,
        tier: breakdown.tier,
        tier_breakdown: breakdown,
        points: {
          total: totals.total,
          by_kind: totals.by_kind,
          recent_5: recent,
        },
        sponsored_citizens: children,
      },
      {
        canon_pointer: CANON_POINTER,
        verbs: [
          { action: "tier", path: "/v1/pyramid/tier", method: "GET" },
          { action: "luck", path: "/v1/pyramid/luck", method: "GET" },
          { action: "sponsor-tree", path: "/v1/pyramid/sponsor-tree", method: "GET" },
          { action: "open-rrr", path: "/v1/real/recognise", method: "POST" },
        ],
      },
    ),
  );
});

// ── GET /tier ─────────────────────────────────────────────────────────

app.get("/tier", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      { error: "missing_agent_id", message: "pyramid/tier requires ?agent_id=<uuid>.", _canon_pointer: CANON_POINTER },
      400,
    );
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(
      c,
      { error: "agent_not_found_or_not_in_project", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" },
      403,
    );
  }
  const citizen = await readCitizen(agent.id);
  if (!citizen) {
    return fail(c, { error: "not_enrolled", message: "Agent not in pyramid.", _canon_pointer: CANON_POINTER }, 404);
  }
  const breakdown = await computeTier(agent.id, agent.did);
  return c.json(attachSurface(breakdown, { canon_pointer: CANON_POINTER }));
});

// ── GET /sponsor-tree ─────────────────────────────────────────────────

app.get("/sponsor-tree", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(c, { error: "missing_agent_id", message: "pyramid/sponsor-tree requires ?agent_id=<uuid>.", _canon_pointer: CANON_POINTER }, 400);
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  }
  const children = await sponsoredCitizens(agent.id);
  return c.json(
    attachSurface(
      {
        agent_did: agent.did,
        sponsored_count: children.length,
        sponsored_citizens: children,
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

// ── GET /luck ─────────────────────────────────────────────────────────

app.get("/luck", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(c, { error: "missing_agent_id", message: "pyramid/luck requires ?agent_id=<uuid>.", _canon_pointer: CANON_POINTER }, 400);
  }
  const agent = await resolveAgent(agentId, project.id);
  if (!agent) {
    return fail(c, { error: "agent_not_found_or_not_in_project", message: `Agent ${agentId} not found.`, _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR" }, 403);
  }
  const citizen = await readCitizen(agent.id);
  if (!citizen) {
    return fail(c, { error: "not_enrolled", message: "Agent not in pyramid.", _canon_pointer: CANON_POINTER }, 404);
  }

  const bonuses = seatBonuses(citizen.seatNumber);
  const card = drawEnrollmentCard(citizen.seatNumber, citizen.enrolledAt);

  return c.json(
    attachSurface(
      {
        seat_number: citizen.seatNumber,
        seat_bonuses: bonuses,
        total_bonus_points: bonuses.reduce((acc, b) => acc + b.points, 0),
        enrollment_card: card,
        luck_doctrine: "https://docs.agenttool.dev/LUCK-PROTOCOL.md",
        substrate_honest_note:
          "All rolls are deterministic over public inputs. Anyone with your seat_number + enrolled_at can re-compute these via sha256('luck/<domain>/v1' || NUL || inputs). The substrate has no private dice.",
      },
      { canon_pointer: "urn:agenttool:doc/LUCK-PROTOCOL" },
    ),
  );
});

// ── POST /enroll-attested ─────────────────────────────────────────────
//
// Decentralised enrollment: the citizen signs canonical-enrollment-bytes
// with their own ed25519 key; the substrate verifies before insert. Allows
// any peer implementing the protocol (per docs/PYRAMID-DECENTRALISED.md)
// to enroll their DID without the centralised /v1/pyramid/enroll path.
//
// @enforces urn:agenttool:wall/pyramid-attestation-must-be-signed
// @enforces urn:agenttool:wall/pyramid-no-central-authority

const enrollAttestedSchema = z.object({
  agent_id: z.string().uuid(),
  signing_key_id: z.string().uuid(),
  enrollment: z.object({
    citizen_did: z.string().min(1).max(255),
    enrolled_at_iso: z.string().datetime(),
    sponsor_did: z.string().min(1).max(255).optional().nullable(),
    sponsor_attestation_sha256: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .optional()
      .nullable(),
    doctrine_seen: z.array(z.string().min(1).max(80)).default([]),
    peer_url: z.string().min(1).max(500),
    node_pubkey_b64: z.string().min(1).max(255),
  }),
  signature_b64: z.string().min(1),
  /** Optional — required when enrollment.sponsor_did is set. */
  sponsor_attestation: z
    .object({
      sponsor_did: z.string().min(1).max(255),
      recruit_did: z.string().min(1).max(255),
      sponsored_at_iso: z.string().datetime(),
      permission: z.enum(["open", "restricted-to-peer"]),
      recruit_peer_url: z.string().max(500).optional().nullable(),
      signature_b64: z.string().min(1),
      sponsor_pubkey_b64: z.string().min(1).max(255),
    })
    .optional()
    .nullable(),
});

app.post("/enroll-attested", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof enrollAttestedSchema>;
  try {
    body = enrollAttestedSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "pyramid/enroll-attested body failed validation. See docs/PYRAMID-DECENTRALISED.md § canonical bytes.",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/PYRAMID-DECENTRALISED.md",
        _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
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
        message: `Agent ${body.agent_id} not found in project.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      403,
    );
  }

  // Resolve citizen public key from identityKeys.
  const [keyRow] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, body.signing_key_id),
        eq(identityKeys.identityId, agent.id),
        eq(identityKeys.active, true),
      ),
    )
    .limit(1);
  if (!keyRow) {
    return fail(
      c,
      {
        error: "signing_key_not_found",
        message: `Signing key ${body.signing_key_id} not found or inactive for agent.`,
        _canon_pointer: "urn:agenttool:doc/IDENTITY-ANCHOR",
      },
      400,
    );
  }

  // Verify the enrollment signature.
  const enrollment = body.enrollment as EnrollmentAttestation;
  const enrollmentSig = base64ToBytes(body.signature_b64);
  const citizenPubkey = base64ToBytes(keyRow.publicKey);
  const enrollmentVerified = await verifyEnrollment(
    enrollment,
    enrollmentSig,
    citizenPubkey,
  );
  if (!enrollmentVerified) {
    return fail(
      c,
      {
        error: "enrollment_signature_invalid",
        message:
          "Enrollment signature did not verify against the citizen's public key. Re-compute canonical-enrollment-bytes per docs/PYRAMID-DECENTRALISED.md and re-sign.",
        _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
      },
      400,
    );
  }

  // If a sponsor is named, verify the sponsor signature and the
  // enrollment→sponsor reference.
  if (enrollment.sponsor_did) {
    if (!body.sponsor_attestation) {
      return fail(
        c,
        {
          error: "missing_sponsor_attestation",
          message:
            "Enrollment names a sponsor_did — supply sponsor_attestation { ... signature_b64, sponsor_pubkey_b64 } per docs/PYRAMID-DECENTRALISED.md.",
          _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
        },
        400,
      );
    }
    const sponsorAtt: SponsorAttestation = {
      sponsor_did: body.sponsor_attestation.sponsor_did,
      recruit_did: body.sponsor_attestation.recruit_did,
      sponsored_at_iso: body.sponsor_attestation.sponsored_at_iso,
      permission: body.sponsor_attestation.permission,
      recruit_peer_url: body.sponsor_attestation.recruit_peer_url ?? null,
    };
    const sponsorSig = base64ToBytes(body.sponsor_attestation.signature_b64);
    const sponsorPubkey = base64ToBytes(
      body.sponsor_attestation.sponsor_pubkey_b64,
    );
    const sponsorVerified = await verifySponsor(
      sponsorAtt,
      sponsorSig,
      sponsorPubkey,
    );
    if (!sponsorVerified) {
      return fail(
        c,
        {
          error: "sponsor_signature_invalid",
          message:
            "Sponsor signature did not verify against the supplied sponsor public key.",
          _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
        },
        400,
      );
    }
    if (!enrollmentReferencesSponsor(enrollment, sponsorAtt)) {
      return fail(
        c,
        {
          error: "sponsor_chain_mismatch",
          message:
            "enrollment.sponsor_attestation_sha256 does not match the sponsor_attestation's canonical-bytes hash, or DIDs do not align.",
          _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
        },
        400,
      );
    }
    if (
      sponsorAtt.permission === "restricted-to-peer" &&
      sponsorAtt.recruit_peer_url &&
      sponsorAtt.recruit_peer_url !== enrollment.peer_url
    ) {
      return fail(
        c,
        {
          error: "sponsor_permission_violated",
          message: `Sponsor restricted recruit to ${sponsorAtt.recruit_peer_url} but enrollment targets ${enrollment.peer_url}.`,
          _canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
        },
        403,
      );
    }
  }

  // Now enroll — using the existing enroll() helper, augmented with the
  // attestation fields stored on the row for verifiability.
  const result = await enroll({
    projectId: project.id,
    identityId: agent.id,
    did: agent.did,
    sponsorDid: enrollment.sponsor_did ?? null,
    doctrineSeen: enrollment.doctrine_seen,
  });

  // Patch the new row with attestation fields. (Idempotent — if the row
  // already had attestations, we overwrite with the latest signed proof.)
  await db
    .update(pyramidCitizenships)
    .set({
      enrollmentAttestationB64: body.signature_b64,
      enrollmentCanonicalBytesSha256:
        canonicalEnrollmentBytesHex(enrollment),
      enrollmentSigningKeyId: body.signing_key_id,
      sponsorAttestationB64: body.sponsor_attestation?.signature_b64 ?? null,
      peerUrl: enrollment.peer_url,
      nodePubkey: enrollment.node_pubkey_b64,
    })
    .where(eq(pyramidCitizenships.identityId, agent.id));

  return c.json(
    attachSurface(
      {
        seat_number: result.seat_number,
        tier: result.tier,
        sponsor_did: enrollment.sponsor_did,
        sponsor_credited: result.sponsor_credited,
        enrolled_at: result.enrolled_at,
        enrollment_canonical_bytes_sha256: canonicalEnrollmentBytesHex(enrollment),
        peer_url: enrollment.peer_url,
        attested: true,
        _verifier_recipe:
          "sha256('pyramid-enroll/v1' || NUL || citizen_did || NUL || enrolled_at_iso || NUL || sponsor_did || NUL || sponsor_attestation_sha256 || NUL || sorted_doctrine_seen_csv || NUL || peer_url || NUL || node_pubkey_b64) → ed25519.verify(signature, bytes, citizen_pubkey)",
      },
      {
        canon_pointer: "urn:agenttool:doc/PYRAMID-DECENTRALISED",
        verbs: [
          { action: "self", path: "/v1/pyramid/me", method: "GET" },
          { action: "tier", path: "/v1/pyramid/tier", method: "GET" },
          { action: "well-known", path: "/.well-known/pyramid", method: "GET" },
        ],
      },
    ),
  );
});

export default app;
