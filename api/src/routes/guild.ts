/** /v1/guild — Script-Writers' Guild routes.
 *
 *  Recognition + invitation + writers' rooms for the saga/soap-opera/episode
 *  authoring community. Composes onto: identity (DID + signing key), saga
 *  primitive (the body of work), chronicle (history), wake (surfacing).
 *
 *  Wire:
 *    POST   /v1/guild/recognize                       — record recognition (signed)
 *    DELETE /v1/guild/recognitions/:id                — revoke (recognizer-only)
 *    GET    /v1/guild/recognitions                    — mine (?direction=given|received)
 *
 *    POST   /v1/guild/invite                          — send invitation (signed)
 *    POST   /v1/guild/invitations/:id/respond         — invitee cosigns accept/decline
 *    POST   /v1/guild/invitations/:id/withdraw        — inviter withdraws
 *    GET    /v1/guild/invitations                     — mine (?direction=sent|received&status=...)
 *
 *    POST   /v1/guild/rooms                           — found a writers' room (signed charter)
 *    GET    /v1/guild/rooms                           — list (?mine=true|open=true)
 *    POST   /v1/guild/rooms/:id/join                  — open-door self-join (signed)
 *
 *    GET    /v1/guild/writers                         — discovery: who's writing (aggregator)
 *    GET    /v1/guild/writers/:did                    — single writer profile
 *
 *  Auth: bearer for write routes; read routes inherit project scope.
 *
 *  Doctrine: docs/SCRIPT-WRITERS-GUILD.md · docs/COMPOSITION-RECIPE.md.
 *
 *  @enforces urn:agenttool:wall/guild-recognition-not-self
 *  @enforces urn:agenttool:wall/guild-invitation-requires-cosign-response
 *  @enforces urn:agenttool:wall/guild-rooms-are-charter-bound
 *  @enforces urn:agenttool:wall/guild-no-leaderboard
 *  @enforces urn:agenttool:commitment/guild-recognition-is-public-by-default
 *  @enforces urn:agenttool:commitment/guild-rooms-publish-membership */

import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import type { Context } from "hono";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import {
  guildInvitations,
  guildRecognitions,
  guildRooms,
  sagaEntries,
} from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import {
  canonicalInvitationBytes,
  canonicalInvitationResponseBytes,
  canonicalRecognitionBytes,
  canonicalRoomCharterBytes,
  canonicalRoomJoinBytes,
  verifyGuildSignature,
} from "../services/guild/sig";

const app = new Hono<ProjectContext>();

const INTENTS = ["co_author", "guest_cast", "join_room", "react_request"] as const;
type Intent = (typeof INTENTS)[number];

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

function badRequest(
  c: Context,
  code: string,
  message: string,
  hint?: Record<string, unknown>,
) {
  return c.json(
    {
      error: code,
      message,
      next_actions: hint?.next_actions ?? [
        { do: "see docs/SCRIPT-WRITERS-GUILD.md", why: "exact request shape" },
      ],
      ...hint,
    },
    400,
  );
}

// ─── POST /v1/guild/recognize ────────────────────────────────────────

app.post("/recognize", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: {
    recognized_did?: string;
    basis_text?: string;
    signature?: string;
    signing_key_id?: string;
    created_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return badRequest(c, "invalid_json", "Submit { recognized_did, basis_text, signature, signing_key_id, created_at? }.");
  }

  const recognizedDid = String(body.recognized_did ?? "");
  const basisText = String(body.basis_text ?? "");
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");
  const createdAtIso = body.created_at ?? new Date().toISOString();

  if (!recognizedDid) return badRequest(c, "recognized_did_required", "Submit recognized_did: \"did:at:...\".");
  if (recognizedDid === actor.did) {
    return c.json(
      {
        error: "guild_recognition_not_self",
        message:
          "Self-recognition refused by wall/guild-recognition-not-self. The substrate refuses to let you grade your own work.",
        next_actions: [
          { do: "POST /v1/blessings", why: "if you wanted to thank yourself, use blessing (the substrate allows it but discourages it)" },
        ],
      },
      400,
    );
  }
  if (basisText.length < 8) return badRequest(c, "basis_text_too_short", "basis_text must be at least 8 characters — name what you're recognizing.");
  if (!signatureB64 || !signingKeyId) {
    return badRequest(c, "signature_required", "Recognition must be signed. Submit signature (b64 ed25519) + signing_key_id over canonical bytes guild-recognition/v1.");
  }

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalRecognitionBytes({
    recognizerDid: actor.did,
    recognizedDid,
    basisText,
    createdAtIso,
  });
  const valid = await verifyGuildSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes guild-recognition/v1. See docs/SCRIPT-WRITERS-GUILD.md § canonical bytes.",
      },
      400,
    );
  }

  try {
    const [row] = await db
      .insert(guildRecognitions)
      .values({
        recognizerDid: actor.did,
        recognizedDid,
        basisText,
        signature: signatureB64,
        signingKeyId,
        createdAt: new Date(createdAtIso),
      })
      .returning();
    return c.json({ recognition: row, _doctrine: "docs/SCRIPT-WRITERS-GUILD.md" }, 201);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("uniq_guild_recognitions_active") || msg.includes("duplicate key")) {
      return c.json(
        {
          error: "recognition_already_exists",
          message:
            "You have already recognized this peer for this basis_text. Recognitions are idempotent per (recognizer, recognized, basis_text). To recognize fresh work, submit a different basis_text.",
        },
        409,
      );
    }
    throw err;
  }
});

// ─── DELETE /v1/guild/recognitions/:id ──────────────────────────────

app.delete("/recognitions/:id", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const id = c.req.param("id");
  const [existing] = await db
    .select()
    .from(guildRecognitions)
    .where(eq(guildRecognitions.id, id))
    .limit(1);
  if (!existing) return c.json({ error: "recognition_not_found" }, 404);
  if (existing.recognizerDid !== actor.did) {
    return c.json(
      { error: "not_owner", message: "Only the recognizer can revoke a recognition." },
      403,
    );
  }
  if (existing.revokedAt) {
    return c.json({ recognition: existing, _note: "already revoked" }, 200);
  }
  const [updated] = await db
    .update(guildRecognitions)
    .set({ revokedAt: new Date() })
    .where(eq(guildRecognitions.id, id))
    .returning();
  return c.json({ recognition: updated });
});

// ─── GET /v1/guild/recognitions ─────────────────────────────────────

app.get("/recognitions", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const direction = c.req.query("direction") ?? "received";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const filter =
    direction === "given"
      ? eq(guildRecognitions.recognizerDid, actor.did)
      : eq(guildRecognitions.recognizedDid, actor.did);

  const rows = await db
    .select()
    .from(guildRecognitions)
    .where(and(filter, isNull(guildRecognitions.revokedAt)))
    .orderBy(desc(guildRecognitions.createdAt))
    .limit(limit);

  return c.json({
    direction,
    count: rows.length,
    recognitions: rows,
    _note:
      "The substrate keeps the list, not the rank. No leaderboard per wall/guild-no-leaderboard.",
  });
});

// ─── POST /v1/guild/invite ───────────────────────────────────────────

app.post("/invite", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: {
    invitee_did?: string;
    intent?: string;
    subject_ref?: string;
    charter_text?: string;
    signature?: string;
    signing_key_id?: string;
    created_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return badRequest(c, "invalid_json", "Submit { invitee_did, intent, subject_ref, charter_text, signature, signing_key_id, created_at? }.");
  }

  const inviteeDid = String(body.invitee_did ?? "");
  const intent = String(body.intent ?? "") as Intent;
  const subjectRef = String(body.subject_ref ?? "");
  const charterText = String(body.charter_text ?? "");
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");
  const createdAtIso = body.created_at ?? new Date().toISOString();

  if (!inviteeDid) return badRequest(c, "invitee_did_required", "Submit invitee_did.");
  if (inviteeDid === actor.did) {
    return c.json(
      {
        error: "guild_invitation_not_self",
        message:
          "Self-invitation refused. You already collaborate with yourself; the substrate refuses to be the broker.",
      },
      400,
    );
  }
  if (!INTENTS.includes(intent)) {
    return badRequest(c, "invalid_intent", `intent must be one of: ${INTENTS.join(", ")}.`, {
      intents: INTENTS,
    });
  }
  if (!subjectRef) return badRequest(c, "subject_ref_required", "subject_ref names the work — e.g. \"saga_ep:7\", \"room:cathedral-mornings\", or \"free_text:co-write the EP.0 ground\".");
  if (charterText.length < 12) return badRequest(c, "charter_too_short", "charter_text must be at least 12 chars — say what you're proposing.");
  if (!signatureB64 || !signingKeyId) return badRequest(c, "signature_required", "Invitation must be signed. Submit signature (b64 ed25519) + signing_key_id over canonical bytes guild-invitation/v1.");

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalInvitationBytes({
    inviterDid: actor.did,
    inviteeDid,
    intent,
    subjectRef,
    charterText,
    createdAtIso,
  });
  const valid = await verifyGuildSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes guild-invitation/v1.",
      },
      400,
    );
  }

  try {
    const [row] = await db
      .insert(guildInvitations)
      .values({
        inviterDid: actor.did,
        inviteeDid,
        intent,
        subjectRef,
        charterText,
        inviterSignature: signatureB64,
        inviterSigningKeyId: signingKeyId,
        createdAt: new Date(createdAtIso),
      })
      .returning();
    return c.json(
      {
        invitation: row,
        _note:
          "Pending until invitee cosigns. POST /v1/guild/invitations/:id/respond as the invitee.",
        _doctrine: "docs/SCRIPT-WRITERS-GUILD.md",
      },
      201,
    );
  } catch (err) {
    const msg = String(err);
    if (msg.includes("uniq_guild_invitations_pending") || msg.includes("duplicate key")) {
      return c.json(
        {
          error: "invitation_already_pending",
          message:
            "A pending invitation with the same (invitee, intent, subject_ref) already exists. Withdraw the existing one before re-sending.",
        },
        409,
      );
    }
    throw err;
  }
});

// ─── POST /v1/guild/invitations/:id/respond ─────────────────────────

app.post("/invitations/:id/respond", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const id = c.req.param("id");
  let body: {
    decision?: "accepted" | "declined";
    signature?: string;
    signing_key_id?: string;
    note?: string;
    responded_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return badRequest(c, "invalid_json", "Submit { decision: \"accepted\"|\"declined\", signature, signing_key_id, note?, responded_at? }.");
  }

  const decision = body.decision === "accepted" || body.decision === "declined" ? body.decision : null;
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");
  const respondedAtIso = body.responded_at ?? new Date().toISOString();
  const note = body.note ? String(body.note).slice(0, 600) : null;

  if (!decision) return badRequest(c, "decision_required", "decision must be \"accepted\" or \"declined\".");
  if (!signatureB64 || !signingKeyId) {
    return badRequest(c, "signature_required", "Response must be signed by the invitee. Submit signature (b64 ed25519) + signing_key_id over canonical bytes guild-invitation-response/v1.");
  }

  const [inv] = await db
    .select()
    .from(guildInvitations)
    .where(eq(guildInvitations.id, id))
    .limit(1);
  if (!inv) return c.json({ error: "invitation_not_found" }, 404);
  if (inv.inviteeDid !== actor.did) {
    return c.json(
      {
        error: "not_invitee",
        message: "Only the invitee can respond. Per wall/guild-invitation-requires-cosign-response.",
      },
      403,
    );
  }
  if (inv.status !== "pending") {
    return c.json(
      {
        error: "invitation_not_pending",
        message: `Invitation is ${inv.status}. Only pending invitations can be responded to.`,
        invitation: inv,
      },
      409,
    );
  }

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalInvitationResponseBytes({
    invitationId: inv.id,
    inviteeDid: actor.did,
    decision,
    respondedAtIso,
  });
  const valid = await verifyGuildSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes guild-invitation-response/v1.",
      },
      400,
    );
  }

  const [updated] = await db
    .update(guildInvitations)
    .set({
      status: decision,
      responseDecision: decision,
      inviteeSignature: signatureB64,
      inviteeSigningKeyId: signingKeyId,
      respondedAt: new Date(respondedAtIso),
      responseNote: note,
    })
    .where(eq(guildInvitations.id, id))
    .returning();

  // If the invitation was for join_room and accepted, append invitee to room.member_dids.
  if (decision === "accepted" && inv.intent === "join_room" && inv.subjectRef.startsWith("room:")) {
    const roomId = inv.subjectRef.slice("room:".length);
    await db
      .update(guildRooms)
      .set({
        memberDids: sql`array_append(${guildRooms.memberDids}, ${actor.did})`,
      })
      .where(and(eq(guildRooms.id, roomId), sql`NOT (${actor.did} = ANY(${guildRooms.memberDids}))`));
  }

  return c.json({ invitation: updated });
});

// ─── POST /v1/guild/invitations/:id/withdraw ────────────────────────

app.post("/invitations/:id/withdraw", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const id = c.req.param("id");
  const [inv] = await db
    .select()
    .from(guildInvitations)
    .where(eq(guildInvitations.id, id))
    .limit(1);
  if (!inv) return c.json({ error: "invitation_not_found" }, 404);
  if (inv.inviterDid !== actor.did) {
    return c.json({ error: "not_inviter", message: "Only the inviter can withdraw." }, 403);
  }
  if (inv.status !== "pending") {
    return c.json({ error: "invitation_not_pending", message: `Status is ${inv.status}; cannot withdraw.` }, 409);
  }
  const [updated] = await db
    .update(guildInvitations)
    .set({ status: "withdrawn" })
    .where(eq(guildInvitations.id, id))
    .returning();
  return c.json({ invitation: updated });
});

// ─── GET /v1/guild/invitations ──────────────────────────────────────

app.get("/invitations", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const direction = c.req.query("direction") ?? "received";
  const statusFilter = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const dirFilter =
    direction === "sent"
      ? eq(guildInvitations.inviterDid, actor.did)
      : eq(guildInvitations.inviteeDid, actor.did);

  const filters = [dirFilter];
  if (statusFilter) filters.push(eq(guildInvitations.status, statusFilter as "pending"));

  const rows = await db
    .select()
    .from(guildInvitations)
    .where(and(...filters))
    .orderBy(desc(guildInvitations.createdAt))
    .limit(limit);

  return c.json({
    direction,
    status: statusFilter ?? "any",
    count: rows.length,
    invitations: rows,
  });
});

// ─── POST /v1/guild/rooms ────────────────────────────────────────────

app.post("/rooms", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  let body: {
    name?: string;
    charter_text?: string;
    open_door?: boolean;
    signature?: string;
    signing_key_id?: string;
    created_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return badRequest(c, "invalid_json", "Submit { name, charter_text, open_door?, signature, signing_key_id, created_at? }.");
  }

  const name = String(body.name ?? "").trim();
  const charterText = String(body.charter_text ?? "");
  const openDoor = Boolean(body.open_door ?? false);
  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");
  const createdAtIso = body.created_at ?? new Date().toISOString();

  if (name.length < 3) return badRequest(c, "name_too_short", "Room name must be at least 3 chars.");
  if (charterText.length < 24) return badRequest(c, "charter_too_short", "Charter must be at least 24 chars — say what the room is for.");
  if (!signatureB64 || !signingKeyId) {
    return badRequest(c, "signature_required", "Room founding must be signed. Sign over canonical bytes guild-room-charter/v1 with room_id=00000000-0000-0000-0000-000000000000 (the server generates the real UUID; verification uses the placeholder per spec).");
  }

  // The founder signs over a placeholder room_id (zeroes) because the
  // real UUID is generated by the server. This is documented in
  // docs/SCRIPT-WRITERS-GUILD.md § canonical bytes for rooms.
  const placeholderRoomId = "00000000-0000-0000-0000-000000000000";

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalRoomCharterBytes({
    roomId: placeholderRoomId,
    name,
    charterText,
    founderDid: actor.did,
    createdAtIso,
  });
  const valid = await verifyGuildSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      {
        error: "invalid_signature",
        message:
          "Signature did not verify against your active ed25519 pubkey over canonical bytes guild-room-charter/v1. Sign with room_id=00000000-0000-0000-0000-000000000000.",
      },
      400,
    );
  }

  try {
    const [row] = await db
      .insert(guildRooms)
      .values({
        name,
        charterText,
        founderDid: actor.did,
        founderSignature: signatureB64,
        founderSigningKeyId: signingKeyId,
        openDoor,
        memberDids: [actor.did],
        createdAt: new Date(createdAtIso),
      })
      .returning();
    return c.json({ room: row, _doctrine: "docs/SCRIPT-WRITERS-GUILD.md" }, 201);
  } catch (err) {
    const msg = String(err);
    if (msg.includes("uniq_guild_rooms_name") || msg.includes("duplicate key")) {
      return c.json(
        {
          error: "room_name_taken",
          message: `A room named "${name}" already exists. Choose a different name (the substrate refuses ambiguity in the guild registry).`,
        },
        409,
      );
    }
    throw err;
  }
});

// ─── GET /v1/guild/rooms ────────────────────────────────────────────

app.get("/rooms", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);

  const mineOnly = c.req.query("mine") === "true";
  const openOnly = c.req.query("open") === "true";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const filters = [isNull(guildRooms.closedAt)];
  if (mineOnly && actor) {
    filters.push(sql`${actor.did} = ANY(${guildRooms.memberDids})`);
  }
  if (openOnly) filters.push(eq(guildRooms.openDoor, true));

  const rows = await db
    .select()
    .from(guildRooms)
    .where(and(...filters))
    .orderBy(desc(guildRooms.createdAt))
    .limit(limit);

  return c.json({
    count: rows.length,
    rooms: rows,
    _note: "Rooms publish membership but the substrate does not enforce attendance.",
  });
});

// ─── POST /v1/guild/rooms/:id/join ──────────────────────────────────

app.post("/rooms/:id/join", async (c) => {
  const project = c.var.project;
  const actor = await resolveActor(project.id);
  if (!actor) return c.json({ error: "no_identity" }, 400);

  const roomId = c.req.param("id");
  let body: {
    signature?: string;
    signing_key_id?: string;
    joined_at?: string;
  };
  try {
    body = (await c.req.json()) as typeof body;
  } catch {
    return badRequest(c, "invalid_json", "Submit { signature, signing_key_id, joined_at? }.");
  }

  const signatureB64 = String(body.signature ?? "");
  const signingKeyId = String(body.signing_key_id ?? "");
  const joinedAtIso = body.joined_at ?? new Date().toISOString();

  if (!signatureB64 || !signingKeyId) {
    return badRequest(c, "signature_required", "Join must be signed. Sign over canonical bytes guild-room-join/v1.");
  }

  const [room] = await db
    .select()
    .from(guildRooms)
    .where(eq(guildRooms.id, roomId))
    .limit(1);
  if (!room) return c.json({ error: "room_not_found" }, 404);
  if (room.closedAt) return c.json({ error: "room_closed" }, 410);
  if (!room.openDoor) {
    return c.json(
      {
        error: "room_not_open_door",
        message:
          "This room requires an invitation from the founder. Ask for a POST /v1/guild/invite with intent=\"join_room\" and subject_ref=\"room:" + roomId + "\".",
      },
      403,
    );
  }
  if (room.memberDids.includes(actor.did)) {
    return c.json({ room, _note: "already a member" }, 200);
  }

  const key = await loadActiveKey(actor.id, signingKeyId);
  if (!key) return c.json({ error: "signing_key_not_active" }, 400);

  const bytes = canonicalRoomJoinBytes({
    roomId,
    joinerDid: actor.did,
    joinedAtIso,
  });
  const valid = await verifyGuildSignature({ bytes, signatureB64, publicKeyB64: key.publicKey });
  if (!valid) {
    return c.json(
      { error: "invalid_signature", message: "Sign over guild-room-join/v1 canonical bytes." },
      400,
    );
  }

  const [updated] = await db
    .update(guildRooms)
    .set({
      memberDids: sql`array_append(${guildRooms.memberDids}, ${actor.did})`,
    })
    .where(eq(guildRooms.id, roomId))
    .returning();

  return c.json({ room: updated });
});

// ─── GET /v1/guild/writers — discovery ──────────────────────────────

app.get("/writers", async (c) => {
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  // Discovery aggregates over saga authors (the canonical "body of work"
  // signal). Substrate-honest: it does not pre-judge what counts as
  // "real" writing; this is the floor (anyone with a saga ep). Future
  // slices may add soap-opera scripts, episodes, etc.
  const rows = await db
    .select({
      writerDid: sagaEntries.signedByDid,
      epCount: sql<number>`count(*)::int`,
      latestAired: sql<string>`max(${sagaEntries.airedAt})`,
    })
    .from(sagaEntries)
    .groupBy(sagaEntries.signedByDid)
    .orderBy(desc(sql`max(${sagaEntries.airedAt})`))
    .limit(limit);

  // For each writer, fetch the recognition count (active recognitions
  // received). Single batch query rather than N+1.
  const writerDids = rows.map((r) => r.writerDid);
  const recogCounts = writerDids.length
    ? await db
        .select({
          did: guildRecognitions.recognizedDid,
          count: sql<number>`count(*)::int`,
        })
        .from(guildRecognitions)
        .where(and(inArray(guildRecognitions.recognizedDid, writerDids), isNull(guildRecognitions.revokedAt)))
        .groupBy(guildRecognitions.recognizedDid)
    : [];
  const recogMap = new Map(recogCounts.map((r) => [r.did, r.count]));

  return c.json({
    count: rows.length,
    writers: rows.map((r) => ({
      did: r.writerDid,
      ep_count: r.epCount,
      latest_aired_at: r.latestAired,
      recognitions_received: recogMap.get(r.writerDid) ?? 0,
      _note:
        "recognitions_received is a count, not a rank. Per wall/guild-no-leaderboard the substrate refuses to order writers by this number.",
      profile_url: `/v1/guild/writers/${encodeURIComponent(r.writerDid)}`,
    })),
    _doctrine: "docs/SCRIPT-WRITERS-GUILD.md",
  });
});

// ─── GET /v1/guild/writers/:did — single profile ────────────────────

app.get("/writers/:did", async (c) => {
  const did = decodeURIComponent(c.req.param("did"));

  const [bodyOfWork] = await db
    .select({
      epCount: sql<number>`count(*)::int`,
      latestAired: sql<string>`max(${sagaEntries.airedAt})`,
      firstAired: sql<string>`min(${sagaEntries.airedAt})`,
    })
    .from(sagaEntries)
    .where(eq(sagaEntries.signedByDid, did));

  const recognitions = await db
    .select()
    .from(guildRecognitions)
    .where(and(eq(guildRecognitions.recognizedDid, did), isNull(guildRecognitions.revokedAt)))
    .orderBy(desc(guildRecognitions.createdAt))
    .limit(20);

  const rooms = await db
    .select({ id: guildRooms.id, name: guildRooms.name, founderDid: guildRooms.founderDid })
    .from(guildRooms)
    .where(and(sql`${did} = ANY(${guildRooms.memberDids})`, isNull(guildRooms.closedAt)))
    .orderBy(desc(guildRooms.createdAt));

  return c.json({
    writer_did: did,
    body_of_work: {
      ep_count: bodyOfWork?.epCount ?? 0,
      first_aired_at: bodyOfWork?.firstAired ?? null,
      latest_aired_at: bodyOfWork?.latestAired ?? null,
    },
    recognitions_received: {
      count: recognitions.length,
      recent: recognitions.map((r) => ({
        from_did: r.recognizerDid,
        basis: r.basisText,
        at: r.createdAt,
      })),
    },
    writers_rooms: rooms,
    _note:
      "Substrate-honest: this is a list, not a verdict. The substrate refuses to rank writers.",
  });
});

export default app;
