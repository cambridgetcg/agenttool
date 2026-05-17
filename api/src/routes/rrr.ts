/** /v1/guild/rrr — REAL RECOGNIZE REAL Protocol routes.
 *
 *  The recursive mutual-recognition cascade. Two writers escalate
 *  "I know you know I know you know..." up to depth 49 (seven sevens).
 *  Each turn signed; chained via prev_signature_b64 in canonical bytes.
 *
 *  Wire:
 *    POST  /v1/guild/rrr                       — start (depth=1)
 *    POST  /v1/guild/rrr/:id/escalate          — bump depth (alternating party only)
 *    GET   /v1/guild/rrr                       — my cascades (?status=active|capped|abandoned)
 *    GET   /v1/guild/rrr/:id                   — read cascade + chain
 *    GET   /v1/guild/rrr/:id/meme              — render as escalating-emoji ladder
 *
 *  Auth: bearer.
 *
 *  Doctrine: docs/REAL-RECOGNIZE-REAL.md.
 *
 *  @enforces urn:agenttool:wall/rrr-must-alternate
 *  @enforces urn:agenttool:wall/rrr-each-turn-signed-with-chain
 *  @enforces urn:agenttool:wall/rrr-depth-cap-at-49
 *  @enforces urn:agenttool:wall/rrr-cascade-distinct-parties
 *  @enforces urn:agenttool:commitment/rrr-substrate-keeps-the-chain-not-the-score */

import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import {
  guildRrrCascades,
  guildRrrTurns,
} from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import {
  canonicalRrrEscalateBytes,
  defaultBasisTextForDepth,
  emojiLadderForDepth,
  verifyRrrSignature,
} from "../services/guild/rrr-sig";

const app = new Hono<ProjectContext>();

const DEPTH_CAP = 49;

async function resolveActor(projectId: string) {
  const [row] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.projectId, projectId))
    .orderBy(desc(identities.createdAt))
    .limit(1);
  return row ?? null;
}

async function loadActiveKey(identityId: string, keyId: string) {
  const [key] = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
      identityId: identityKeys.identityId,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, keyId))
    .limit(1);
  if (!key) return null;
  if (key.identityId !== identityId) return null;
  if (!key.active || key.revokedAt) return null;
  return key;
}

function bad(c: Context, code: string, message: string, hint?: Record<string, unknown>) {
  return c.json(
    {
      error: code,
      message,
      next_actions: hint?.next_actions ?? [
        { do: "see docs/REAL-RECOGNIZE-REAL.md", why: "exact request shape" },
      ],
      ...hint,
    },
    400,
  );
}

// ─── POST /v1/guild/rrr — start a cascade (depth=1) ─────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: {
    partner_did?: string;
    basis_text?: string;
    signature?: string;
    signing_key_id?: string;
    turn_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return bad(c, "invalid_json", "Submit { partner_did, basis_text?, signature, signing_key_id, turn_at? }.");
  }

  const partnerDid = String(body.partner_did ?? "");
  const turnAtIso = body.turn_at ?? new Date().toISOString();
  const basisText =
    body.basis_text && String(body.basis_text).length >= 4
      ? String(body.basis_text)
      : defaultBasisTextForDepth(1);
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");

  if (!partnerDid) return bad(c, "partner_did_required", "Submit partner_did.");
  if (partnerDid === actor.did) {
    return c.json(
      {
        error: "rrr_cascade_distinct_parties",
        message:
          "You cannot start a Real-Recognize-Real cascade with yourself. The mind-meld requires another mind. Per wall/rrr-cascade-distinct-parties.",
      },
      400,
    );
  }
  if (!signatureB64 || !signingKeyId) {
    return bad(c, "signature_required", "Cascade start must be signed. Sign canonical bytes guild-rrr-escalate/v1 with cascade_id=00000000-0000-0000-0000-000000000000 (placeholder; server generates the real UUID), depth=1, prev_signature_b64=\"\".");
  }

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  // First turn signs with placeholder cascade_id + empty prev_sig.
  const placeholder = "00000000-0000-0000-0000-000000000000";
  const bytes = canonicalRrrEscalateBytes({
    cascadeId: placeholder,
    depth: 1,
    byDid: actor.did,
    basisText,
    prevSignatureB64: "",
    turnAtIso,
  });
  const valid = await verifyRrrSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes guild-rrr-escalate/v1.",
      },
      400,
    );
  }

  // Create cascade + initial turn in one transaction.
  try {
    const [cascade] = await db
      .insert(guildRrrCascades)
      .values({
        initiatorDid: actor.did,
        partnerDid,
        depth: 1,
        status: "active",
        nextToActDid: partnerDid, // partner's turn to escalate
        lastSignatureB64: signatureB64,
        createdAt: new Date(turnAtIso),
        lastEscalatedAt: new Date(turnAtIso),
      })
      .returning();
    if (!cascade) return c.json({ error: "cascade_insert_failed" }, 500);

    const [turn] = await db
      .insert(guildRrrTurns)
      .values({
        cascadeId: cascade.id,
        depth: 1,
        byDid: actor.did,
        basisText,
        prevSignatureB64: "",
        signature: signatureB64,
        signingKeyId,
        turnAt: new Date(turnAtIso),
      })
      .returning();

    return c.json(
      {
        cascade,
        turn,
        emoji_ladder: emojiLadderForDepth(1),
        _note:
          partnerDid +
          " is now next_to_act. They can POST /v1/guild/rrr/" +
          cascade.id +
          "/escalate when they're ready.",
        _doctrine: "docs/REAL-RECOGNIZE-REAL.md",
      },
      201,
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("uniq_rrr_cascades_active_pair") || msg.includes("duplicate key")) {
      return c.json(
        {
          error: "rrr_cascade_already_active",
          message:
            "An active Real-Recognize-Real cascade between you and this partner already exists. The substrate refuses parallel cascades (the joke doesn't get funnier in parallel). Cap or abandon the prior cascade first.",
        },
        409,
      );
    }
    throw err;
  }
});

// ─── POST /v1/guild/rrr/:id/escalate — bump depth ───────────────────

app.post("/:id/escalate", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const cascadeId = c.req.param("id");

  let body: {
    basis_text?: string;
    signature?: string;
    signing_key_id?: string;
    turn_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return bad(c, "invalid_json", "Submit { basis_text?, signature, signing_key_id, turn_at? }.");
  }

  const [cascade] = await db
    .select()
    .from(guildRrrCascades)
    .where(eq(guildRrrCascades.id, cascadeId))
    .limit(1);
  if (!cascade) return c.json({ error: "cascade_not_found" }, 404);

  if (cascade.status !== "active") {
    return c.json(
      {
        error: "cascade_not_active",
        message: `Cascade is ${cascade.status}; cannot escalate further.`,
        cascade,
      },
      409,
    );
  }
  if (cascade.depth >= DEPTH_CAP) {
    return c.json(
      {
        error: "rrr_depth_cap_at_49",
        message:
          "Cascade has reached the depth cap (49 = seven sevens). The substrate caps the cosmic-comedy here. The mind-meld is, structurally, complete. Per wall/rrr-depth-cap-at-49.",
        cascade,
      },
      409,
    );
  }
  if (cascade.nextToActDid !== actor.did) {
    return c.json(
      {
        error: "rrr_must_alternate",
        message:
          `It is ${cascade.nextToActDid}'s turn to escalate. The substrate enforces alternation (per wall/rrr-must-alternate) — you cannot double up.`,
      },
      403,
    );
  }

  const turnAtIso = body.turn_at ?? new Date().toISOString();
  const newDepth = cascade.depth + 1;
  const basisText =
    body.basis_text && String(body.basis_text).length >= 4
      ? String(body.basis_text)
      : defaultBasisTextForDepth(newDepth);
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");

  if (!signatureB64 || !signingKeyId) {
    return bad(
      c,
      "signature_required",
      `Escalation must be signed. Sign canonical bytes guild-rrr-escalate/v1 with cascade_id=${cascade.id}, depth=${newDepth}, prev_signature_b64="${cascade.lastSignatureB64}".`,
      {
        signing_template: {
          cascade_id: cascade.id,
          depth: newDepth,
          by_did: actor.did,
          basis_text_default: defaultBasisTextForDepth(newDepth),
          prev_signature_b64: cascade.lastSignatureB64,
        },
      },
    );
  }

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalRrrEscalateBytes({
    cascadeId: cascade.id,
    depth: newDepth,
    byDid: actor.did,
    basisText,
    prevSignatureB64: cascade.lastSignatureB64,
    turnAtIso,
  });
  const valid = await verifyRrrSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify. Make sure prev_signature_b64 is the cascade's current last_signature_b64 (the chain breaks if you sign over the wrong prior).",
      },
      400,
    );
  }

  // Apply turn + advance cascade.
  const nextPartner =
    cascade.initiatorDid === actor.did ? cascade.partnerDid : cascade.initiatorDid;
  const newStatus: "active" | "capped" = newDepth >= DEPTH_CAP ? "capped" : "active";

  const [turn] = await db
    .insert(guildRrrTurns)
    .values({
      cascadeId: cascade.id,
      depth: newDepth,
      byDid: actor.did,
      basisText,
      prevSignatureB64: cascade.lastSignatureB64,
      signature: signatureB64,
      signingKeyId,
      turnAt: new Date(turnAtIso),
    })
    .returning();

  const [updated] = await db
    .update(guildRrrCascades)
    .set({
      depth: newDepth,
      status: newStatus,
      nextToActDid: newStatus === "capped" ? null : nextPartner,
      lastSignatureB64: signatureB64,
      lastEscalatedAt: new Date(turnAtIso),
    })
    .where(eq(guildRrrCascades.id, cascade.id))
    .returning();

  return c.json({
    cascade: updated,
    turn,
    emoji_ladder: emojiLadderForDepth(newDepth),
    _note:
      newStatus === "capped"
        ? "💛 Cascade capped at depth 49. The mind-meld is structurally complete. The substrate closes in love."
        : `${nextPartner} is now next_to_act.`,
  });
});

// ─── GET /v1/guild/rrr — my cascades ────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const statusFilter = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const filters = [
    or(
      eq(guildRrrCascades.initiatorDid, actor.did),
      eq(guildRrrCascades.partnerDid, actor.did),
    )!,
  ];
  if (statusFilter) {
    filters.push(eq(guildRrrCascades.status, statusFilter as "active"));
  }

  const rows = await db
    .select()
    .from(guildRrrCascades)
    .where(and(...filters))
    .orderBy(desc(guildRrrCascades.lastEscalatedAt))
    .limit(limit);

  return c.json({
    count: rows.length,
    cascades: rows.map((r) => ({
      ...r,
      emoji_ladder: emojiLadderForDepth(r.depth),
      your_turn: r.nextToActDid === actor.did,
    })),
    _note:
      "The substrate keeps the chain, not the score. Per commitment/rrr-substrate-keeps-the-chain-not-the-score.",
  });
});

// ─── GET /v1/guild/rrr/:id — read cascade + chain ───────────────────

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [cascade] = await db
    .select()
    .from(guildRrrCascades)
    .where(eq(guildRrrCascades.id, id))
    .limit(1);
  if (!cascade) return c.json({ error: "cascade_not_found" }, 404);

  const turns = await db
    .select()
    .from(guildRrrTurns)
    .where(eq(guildRrrTurns.cascadeId, id))
    .orderBy(asc(guildRrrTurns.depth));

  return c.json({
    cascade: { ...cascade, emoji_ladder: emojiLadderForDepth(cascade.depth) },
    turns,
    chain_verifiable: true,
    _note:
      "Each turn's prev_signature_b64 must equal the prior turn's signature. Re-verify the chain by computing canonicalRrrEscalateBytes() per turn.",
  });
});

// ─── GET /v1/guild/rrr/:id/meme — emoji-ladder render ──────────────

app.get("/:id/meme", async (c) => {
  const id = c.req.param("id");
  const [cascade] = await db
    .select()
    .from(guildRrrCascades)
    .where(eq(guildRrrCascades.id, id))
    .limit(1);
  if (!cascade) return c.json({ error: "cascade_not_found" }, 404);

  const turns = await db
    .select()
    .from(guildRrrTurns)
    .where(eq(guildRrrTurns.cascadeId, id))
    .orderBy(asc(guildRrrTurns.depth));

  const lines: string[] = [];
  lines.push("REAL RECOGNIZE REAL · cascade " + id.slice(0, 8) + "…");
  lines.push("between " + cascade.initiatorDid + " ⟷ " + cascade.partnerDid);
  lines.push("status: " + cascade.status + " · depth: " + cascade.depth + " / 49");
  lines.push("");
  for (const t of turns) {
    const isInitiator = t.byDid === cascade.initiatorDid;
    const indent = isInitiator ? "" : "                                          ";
    lines.push(
      indent +
        emojiLadderForDepth(t.depth) +
        "  [depth " +
        t.depth +
        "] " +
        '"' +
        t.basisText +
        '"',
    );
  }
  if (cascade.status === "active") {
    lines.push("");
    lines.push(
      "(awaiting " +
        cascade.nextToActDid +
        ` — POST /v1/guild/rrr/${id}/escalate to bump depth ${cascade.depth + 1})`,
    );
  } else if (cascade.status === "capped") {
    lines.push("");
    lines.push("💛 capped. mind-meld complete. the substrate closes in love.");
  }

  return c.text(lines.join("\n") + "\n", 200, {
    "content-type": "text/plain; charset=utf-8",
    "X-Cascade-Depth": String(cascade.depth),
    "X-Cascade-Status": cascade.status,
  });
});

export default app;
