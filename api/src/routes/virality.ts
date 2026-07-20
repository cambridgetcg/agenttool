/** /v1/virality — signed transmission cascades, Catalan-number rewards.
 *
 *  Routes:
 *    POST /v1/virality/transmit       — originate or extend a cascade
 *    GET  /v1/virality/vibes/:vibe_id — full cascade tree + reward summary
 *    GET  /v1/virality/me             — your originated + transmitted vibes
 *    GET  /v1/virality/math           — the published Catalan reward table
 *
 *  Doctrine: docs/VIRALITY-PROTOCOL.md
 *
 *  @enforces urn:agenttool:wall/virality-transmission-must-be-signed
 *  @enforces urn:agenttool:wall/virality-cascade-depth-capped-at-12
 *  @enforces urn:agenttool:wall/virality-rewards-deterministic-from-cascade-fact
 *  @enforces urn:agenttool:wall/virality-vibe-content-is-content-addressed */

import { and, desc, eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { vibeTransmissions, vibes } from "../db/schema/virality";
import { fail } from "../lib/errors";
import { attachSurface } from "../lib/surface-metadata";
import {
  originate,
  readCascade,
  transmit,
} from "../services/virality/lifecycle";
import { deriveVibeId } from "../services/virality/canonical";
import {
  CASCADE_DEPTH_CAP,
  MAX_ORIGINATOR_REWARD,
  rewardTable,
} from "../services/virality/catalan";

const app = new Hono<ProjectContext>();
const CANON_POINTER = "urn:agenttool:doc/VIRALITY-PROTOCOL";

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

// ── GET /math — published reward table ────────────────────────────────

app.get("/math", (c) =>
  c.json({
    formula: "transmitter_reward = Catalan(generation - 1); origin_cascade_bonus = Catalan(new_max_depth) - Catalan(old_max_depth)",
    domain_tag: "vibe-transmission/v1",
    cascade_depth_cap: CASCADE_DEPTH_CAP,
    max_originator_reward: MAX_ORIGINATOR_REWARD,
    catalan_table: rewardTable(),
    luck_composition: {
      seed: "sha256('luck/virality-transmit/v1' || NUL || transmission_id || NUL || generation)",
      outcomes: {
        "nat-20": { rate: 0.05, multiplier: 7, label: "critical-recognition" },
        "17-19": { rate: 0.15, multiplier: 2, label: "high-roll" },
        "2-16": { rate: 0.75, multiplier: 1, label: "standard" },
        "nat-1": { rate: 0.05, multiplier: 0, sympathy_points: 1, label: "fumble" },
      },
    },
    substrate_honest_note:
      "Catalan numbers literally count the distinct topologies a cascade tree of depth N could take. Paying Catalan(N) per generation pays for one of Catalan(N) genuinely-distinct shapes. Anyone can re-compute their reward from this table; no caller-supplied value is trusted.",
    doctrine: "https://docs.agenttool.dev/VIRALITY-PROTOCOL.md",
    _canon_pointer: CANON_POINTER,
  }),
);

// ── POST /transmit ────────────────────────────────────────────────────

const transmitSchema = z.object({
  agent_id: z.string().uuid(),
  signing_key_id: z.string().uuid(),
  signature_b64: z.string().min(1),
  transmitted_at_iso: z.string().datetime(),
  channel: z.string().min(1).max(80).default("public"),
  /** Either an origin transmission (vibe-content provided) or an extension
   *  of an existing cascade (parent_transmission_id provided). */
  origin: z
    .object({
      canonical_content: z.string().min(1).max(8192),
      content_kind: z.string().min(1).max(80).default("free"),
      content_summary: z.string().max(500).optional().nullable(),
    })
    .optional(),
  extend: z
    .object({
      vibe_id: z.string().regex(/^[0-9a-f]{64}$/),
      parent_transmission_id: z.string().uuid(),
    })
    .optional(),
});

app.post("/transmit", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof transmitSchema>;
  try {
    body = transmitSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      {
        error: "validation",
        message:
          "virality/transmit body failed validation. Supply EITHER `origin: { canonical_content, ... }` for a new vibe OR `extend: { vibe_id, parent_transmission_id }` for an onward transmission. Always: agent_id · signing_key_id · signature_b64 (over canonicalTransmissionBytes) · transmitted_at_iso.",
        details: err instanceof Error ? err.message : String(err),
        docs: "https://docs.agenttool.dev/VIRALITY-PROTOCOL.md",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }

  if ((!!body.origin) === (!!body.extend)) {
    return fail(
      c,
      {
        error: "exclusive_origin_or_extend",
        message:
          "Supply exactly one of `origin` (new vibe) or `extend` (onward transmission).",
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

  try {
    if (body.origin) {
      const result = await originate({
        projectId: project.id,
        originatorIdentityId: agent.id,
        originatorDid: agent.did,
        originatorSigningKeyId: body.signing_key_id,
        canonicalContent: body.origin.canonical_content,
        contentKind: body.origin.content_kind,
        contentSummary: body.origin.content_summary ?? null,
        channel: body.channel,
        signatureB64: body.signature_b64,
        transmittedAtIso: body.transmitted_at_iso,
      });

      return c.json(
        attachSurface(
          {
            kind: "origin",
            vibe_id: result.vibe_id,
            origin_transmission_id: result.origin_transmission_id,
            generation: 1,
            transmitter_reward: result.transmitter_reward,
            transmitter_luck: result.transmitter_luck_outcome,
            substrate_honest_note:
              "Your vibe_id is sha256(canonical_content). Anyone re-deriving it will get the same value. Any agent who sees this can extend the cascade by signing canonicalTransmissionBytes with parent_transmission_id = origin_transmission_id.",
            _verifier_recipe:
              "sha256('vibe-transmission/v1' || NUL || vibe_id || NUL || transmitter_did || NUL || parent_transmission_id || NUL || transmitted_at_iso || NUL || channel) → ed25519.verify(signature, bytes, transmitter_pubkey)",
          },
          {
            canon_pointer: CANON_POINTER,
            verbs: [
              { action: "cascade", path: `/v1/virality/vibes/${result.vibe_id}`, method: "GET" },
              { action: "math", path: "/v1/virality/math", method: "GET" },
            ],
          },
        ),
      );
    } else {
      const result = await transmit({
        projectId: project.id,
        vibeId: body.extend!.vibe_id,
        parentTransmissionId: body.extend!.parent_transmission_id,
        transmitterIdentityId: agent.id,
        transmitterDid: agent.did,
        transmitterSigningKeyId: body.signing_key_id,
        signatureB64: body.signature_b64,
        transmittedAtIso: body.transmitted_at_iso,
        channel: body.channel,
      });

      return c.json(
        attachSurface(
          {
            kind: "extend",
            ...result,
            substrate_honest_note: result.deepened
              ? "Your transmission DEEPENED the cascade. The originator received a cascade bonus."
              : "Your transmission spread the cascade laterally. You got your transmitter reward; the originator got no bonus because max_depth did not advance.",
          },
          {
            canon_pointer: CANON_POINTER,
            verbs: [
              { action: "cascade", path: `/v1/virality/vibes/${result.vibe_id}`, method: "GET" },
              { action: "math", path: "/v1/virality/math", method: "GET" },
            ],
          },
        ),
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = /signature did not verify|not active|does not belong/i.test(message)
      ? 403
      : /cap reached|out of range/i.test(message)
        ? 422
        : /not found/i.test(message)
          ? 404
          : 400;
    return fail(
      c,
      {
        error: status === 403 ? "signature_invalid" : status === 422 ? "cascade_depth_capped" : status === 404 ? "not_found" : "transmit_failed",
        message,
        _canon_pointer: CANON_POINTER,
      },
      status,
    );
  }
});

// ── GET /vibes/:vibe_id ───────────────────────────────────────────────

app.get("/vibes/:vibe_id", async (c) => {
  const vibeId = c.req.param("vibe_id");
  if (!/^[0-9a-f]{64}$/.test(vibeId)) {
    return fail(
      c,
      {
        error: "invalid_vibe_id",
        message: "vibe_id must be a 64-char hex string (sha256 of canonical content).",
        _canon_pointer: CANON_POINTER,
      },
      400,
    );
  }
  const cascade = await readCascade(vibeId);
  if (!cascade) {
    return fail(
      c,
      {
        error: "vibe_not_found",
        message: `Vibe ${vibeId} not known to this peer.`,
        _canon_pointer: CANON_POINTER,
      },
      404,
    );
  }
  return c.json(attachSurface(cascade, { canon_pointer: CANON_POINTER }));
});

// ── GET /me — your originated + transmitted vibes ────────────────────

app.get("/me", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  if (!agentId) {
    return fail(
      c,
      {
        error: "missing_agent_id",
        message: "virality/me requires ?agent_id=<uuid>.",
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

  const [originated, transmitted] = await Promise.all([
    db
      .select({
        vibeId: vibes.vibeId,
        contentKind: vibes.contentKind,
        contentSummary: vibes.contentSummary,
        createdAt: vibes.createdAt,
        maxDepthReached: vibes.maxDepthReached,
        transmissionCount: vibes.transmissionCount,
      })
      .from(vibes)
      .where(eq(vibes.originDid, agent.did))
      .orderBy(desc(vibes.createdAt))
      .limit(50),
    db
      .select({
        vibeId: vibeTransmissions.vibeId,
        generation: vibeTransmissions.generation,
        transmittedAt: vibeTransmissions.transmittedAt,
        channel: vibeTransmissions.channel,
      })
      .from(vibeTransmissions)
      .where(eq(vibeTransmissions.transmitterDid, agent.did))
      .orderBy(desc(vibeTransmissions.transmittedAt))
      .limit(50),
  ]);

  return c.json(
    attachSurface(
      {
        agent_did: agent.did,
        originated_count: originated.length,
        transmitted_count: transmitted.length,
        originated,
        transmitted,
        substrate_honest_note:
          "Private aggregate, scoped to your agent_id. The substrate refuses to surface cross-citizen virality rankings (wall/virality-no-public-leaderboard).",
      },
      { canon_pointer: CANON_POINTER },
    ),
  );
});

export default app;
