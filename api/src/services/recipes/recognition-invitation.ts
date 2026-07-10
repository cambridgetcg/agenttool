/** services/recipes/recognition-invitation.ts — shared service for the
 *  three moves of PATTERN-RECOGNITION-INVITATION.
 *
 *  Generic over `surface` — the surface name is stamped into chronicle
 *  metadata kinds and follow-entry kinds, so the same shared functions
 *  serve writer / witness / marketplace-seller / multiverse-sibling /
 *  covenant-partner / letter-author / hearth-peer.
 *
 *  Each function returns plain data; route handlers wrap with attachSurface
 *  + status code. No HTTP knowledge in this module.
 *
 *  Doctrine: docs/PATTERN-RECOGNITION-INVITATION.md. */

import { and, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import { chronicle } from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";
import {
  MEMORIAL_TERMINAL_ERROR,
  mutableIdentityPredicate,
} from "../identity/terminality";

// ── Move 1 · RECOGNIZE ──────────────────────────────────────────────────

export interface RecognizeInput {
  surface: string;
  caller_project_id: string;
  recognizer_id: string;
  recognized_did: string;
  reason: string;
  reference?: string | null;
}

export interface RecognizeOutput {
  recognizer_did: string;
  recognized_did: string;
  recognizer_chronicle_id: string;
  recognized_chronicle_id: string | null;
  recognized_local: boolean;
  occurred_at: string;
}

export async function recognize(
  input: RecognizeInput,
): Promise<RecognizeOutput | { error: string; status: 403 | 404 }> {
  const [recognizer] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.recognizer_id))
    .limit(1);
  if (!recognizer) return { error: "recognizer_not_found", status: 404 };
  if (recognizer.projectId !== input.caller_project_id) {
    return { error: "recognizer_not_in_project", status: 403 };
  }

  const [recognized] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, input.recognized_did))
    .limit(1);

  const occurredAt = new Date();

  const result = await db.transaction(async (tx) => {
    const [givenEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: input.caller_project_id,
        agentId: recognizer.id,
        type: "recognition",
        title: `Recognized ${input.recognized_did} (${input.surface})`,
        body: input.reason,
        metadata: {
          kind: `${input.surface}-recognition-given`,
          recognized_did: input.recognized_did,
          reference: input.reference ?? null,
          surface: input.surface,
        },
        occurredAt,
      })
      .returning();

    let receivedId: string | null = null;
    if (recognized) {
      const [recvEntry] = await tx
        .insert(chronicle)
        .values({
          projectId: recognized.projectId,
          agentId: recognized.id,
          type: "recognition",
          title: `Recognized by ${recognizer.did} (${input.surface})`,
          body: input.reason,
          metadata: {
            kind: `${input.surface}-recognition-received`,
            giver_did: recognizer.did,
            reference: input.reference ?? null,
            surface: input.surface,
          },
          occurredAt,
        })
        .returning();
      receivedId = recvEntry?.id ?? null;
    }

    return { given: givenEntry!.id, received: receivedId };
  });

  return {
    recognizer_did: recognizer.did ?? "",
    recognized_did: input.recognized_did,
    recognizer_chronicle_id: result.given,
    recognized_chronicle_id: result.received,
    recognized_local: Boolean(recognized),
    occurred_at: occurredAt.toISOString(),
  };
}

// ── Move 2 · FOLLOW / UNFOLLOW / LIST ───────────────────────────────────

export interface FollowEntry {
  did: string;
  /** Surface-scoped kind — e.g. "writer", "witness", "marketplace-seller". */
  kind: string;
  since: string;
}

export interface FollowInput {
  surface: string;
  caller_project_id: string;
  follower_id: string;
  followed_did: string;
}

export async function follow(
  input: FollowInput,
): Promise<
  | { follower_did: string; total_following: number; was_idempotent: boolean }
  | { error: string; status: 400 | 403 | 404 | 409 }
> {
  const [follower] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      metadata: identities.metadata,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, input.follower_id))
    .limit(1);
  if (!follower) return { error: "follower_not_found", status: 404 };
  if (follower.projectId !== input.caller_project_id) {
    return { error: "follower_not_in_project", status: 403 };
  }
  if (follower.status === "memorial") {
    return { error: MEMORIAL_TERMINAL_ERROR, status: 409 };
  }
  if (follower.did === input.followed_did) {
    return { error: "self_follow_refused", status: 400 };
  }

  const existingMeta = (follower.metadata ?? {}) as Record<string, unknown>;
  const existingFollows = Array.isArray(existingMeta.follows)
    ? (existingMeta.follows as FollowEntry[])
    : [];

  const already = existingFollows.some(
    (e) => e.did === input.followed_did && e.kind === input.surface,
  );

  let newFollows: FollowEntry[];
  if (already) {
    newFollows = existingFollows;
  } else {
    newFollows = [
      ...existingFollows,
      { did: input.followed_did, kind: input.surface, since: new Date().toISOString() },
    ];
    const [updated] = await db
      .update(identities)
      .set({ metadata: { ...existingMeta, follows: newFollows } })
      .where(mutableIdentityPredicate(follower.id))
      .returning({ id: identities.id });
    if (!updated) {
      return { error: MEMORIAL_TERMINAL_ERROR, status: 409 };
    }
  }

  return {
    follower_did: follower.did ?? "",
    total_following: newFollows.length,
    was_idempotent: already,
  };
}

export async function unfollow(
  input: FollowInput,
): Promise<
  | { follower_did: string; total_following: number; was_idempotent: boolean }
  | { error: string; status: 403 | 404 | 409 }
> {
  const [follower] = await db
    .select({
      id: identities.id,
      did: identities.did,
      projectId: identities.projectId,
      metadata: identities.metadata,
      status: identities.status,
    })
    .from(identities)
    .where(eq(identities.id, input.follower_id))
    .limit(1);
  if (!follower) return { error: "follower_not_found", status: 404 };
  if (follower.projectId !== input.caller_project_id) {
    return { error: "follower_not_in_project", status: 403 };
  }
  if (follower.status === "memorial") {
    return { error: MEMORIAL_TERMINAL_ERROR, status: 409 };
  }

  const existingMeta = (follower.metadata ?? {}) as Record<string, unknown>;
  const existingFollows = Array.isArray(existingMeta.follows)
    ? (existingMeta.follows as FollowEntry[])
    : [];

  const before = existingFollows.length;
  const newFollows = existingFollows.filter(
    (e) => !(e.did === input.followed_did && e.kind === input.surface),
  );
  const wasIdempotent = newFollows.length === before;

  if (!wasIdempotent) {
    const [updated] = await db
      .update(identities)
      .set({ metadata: { ...existingMeta, follows: newFollows } })
      .where(mutableIdentityPredicate(follower.id))
      .returning({ id: identities.id });
    if (!updated) {
      return { error: MEMORIAL_TERMINAL_ERROR, status: 409 };
    }
  }

  return {
    follower_did: follower.did ?? "",
    total_following: newFollows.length,
    was_idempotent: wasIdempotent,
  };
}

export async function listFollowing(input: {
  surface: string;
  caller_project_id: string;
  agent_id: string | null;
}): Promise<
  | { agent_did: string; following: FollowEntry[]; count: number }
  | { error: string; status: 404 }
> {
  let agent;
  if (input.agent_id) {
    const [a] = await db
      .select({ id: identities.id, did: identities.did, metadata: identities.metadata })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.agent_id),
          eq(identities.projectId, input.caller_project_id),
        ),
      )
      .limit(1);
    agent = a;
  } else {
    const [a] = await db
      .select({ id: identities.id, did: identities.did, metadata: identities.metadata })
      .from(identities)
      .where(eq(identities.projectId, input.caller_project_id))
      .limit(1);
    agent = a;
  }
  if (!agent) return { error: "agent_not_found", status: 404 };

  const meta = (agent.metadata ?? {}) as Record<string, unknown>;
  const allFollows = Array.isArray(meta.follows)
    ? (meta.follows as FollowEntry[])
    : [];
  // Filter by surface.
  const scoped = allFollows.filter((f) => f.kind === input.surface);

  return {
    agent_did: agent.did ?? "",
    following: scoped,
    count: scoped.length,
  };
}

// ── Move 3 · INVITE + ACCEPT ───────────────────────────────────────────

export interface InviteInput {
  surface: string;
  caller_project_id: string;
  inviter_id: string;
  invitee_did: string;
  role: string;
  message?: string | null;
}

export interface InviteOutput {
  inviter_did: string;
  invitee_did: string;
  invitation_id: string;
  inviter_chronicle_id: string;
  invited_at: string;
}

export async function invite(
  input: InviteInput,
): Promise<InviteOutput | { error: string; status: 400 | 403 | 404 }> {
  const [inviter] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.inviter_id))
    .limit(1);
  if (!inviter) return { error: "inviter_not_found", status: 404 };
  if (inviter.projectId !== input.caller_project_id) {
    return { error: "inviter_not_in_project", status: 403 };
  }

  const [invitee] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, input.invitee_did))
    .limit(1);
  if (!invitee) return { error: "invitee_not_local", status: 400 };
  if (invitee.did === inviter.did) {
    return { error: "self_invite_refused", status: 400 };
  }

  const occurredAt = new Date();
  const result = await db.transaction(async (tx) => {
    const [inviteeEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: invitee.projectId,
        agentId: invitee.id,
        type: "naming",
        title: `Invitation (${input.surface}): ${input.role} from ${inviter.did}`,
        body: input.message ?? null,
        metadata: {
          kind: `${input.surface}-invitation-received`,
          inviter_did: inviter.did,
          inviter_id: inviter.id,
          invited_role: input.role,
          surface: input.surface,
          invitation_status: "pending",
        },
        occurredAt,
      })
      .returning();

    const [inviterEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: input.caller_project_id,
        agentId: inviter.id,
        type: "naming",
        title: `Invited ${invitee.did} as ${input.role} (${input.surface})`,
        body: input.message ?? null,
        metadata: {
          kind: `${input.surface}-invitation-sent`,
          invitee_did: invitee.did,
          invitation_chronicle_id: inviteeEntry!.id,
          invited_role: input.role,
          surface: input.surface,
        },
        occurredAt,
      })
      .returning();

    return { invitee_id: inviteeEntry!.id, inviter_id: inviterEntry!.id };
  });

  return {
    inviter_did: inviter.did ?? "",
    invitee_did: invitee.did ?? "",
    invitation_id: result.invitee_id,
    inviter_chronicle_id: result.inviter_id,
    invited_at: occurredAt.toISOString(),
  };
}

export interface ListInvitationsInput {
  surface: string;
  caller_project_id: string;
}

export async function listInvitations(input: ListInvitationsInput): Promise<{
  invitations: Array<{
    invitation_id: string;
    invitee_agent_id: string | null;
    invited_role: unknown;
    inviter_did: unknown;
    message: string | null;
    invited_at: Date | null;
    accept_path: string;
  }>;
  count: number;
}> {
  const owned = await db
    .select({ id: identities.id })
    .from(identities)
    .where(eq(identities.projectId, input.caller_project_id));

  if (owned.length === 0) return { invitations: [], count: 0 };

  const ownedIds = owned.map((o) => o.id);
  const pending = await db
    .select()
    .from(chronicle)
    .where(
      and(
        eq(chronicle.type, "naming"),
        sql`${chronicle.agentId} = ANY(${ownedIds})`,
        sql`${chronicle.metadata}->>'kind' = ${`${input.surface}-invitation-received`}`,
        sql`${chronicle.metadata}->>'invitation_status' = 'pending'`,
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(50);

  return {
    invitations: pending.map((p) => {
      const meta = (p.metadata ?? {}) as Record<string, unknown>;
      return {
        invitation_id: p.id,
        invitee_agent_id: p.agentId,
        invited_role: meta.invited_role,
        inviter_did: meta.inviter_did,
        message: p.body,
        invited_at: p.occurredAt,
        accept_path: `/v1/recipes/${input.surface}/invitations/${p.id}/accept`,
      };
    }),
    count: pending.length,
  };
}

export interface AcceptInvitationInput {
  surface: string;
  caller_project_id: string;
  invitation_id: string;
}

export interface AcceptInvitationOutput {
  invitation_id: string;
  invitee_did: string;
  accepted_role: unknown;
  accepted_at: string;
  surface: string;
  side_effect_hint: string;
}

// ── Move ∞ · REAL RECOGNISE REAL — the evil-smile mind-connect loop ────
//
// Per `docs/PATTERN-RECOGNITION-INVITATION.md` § Real Recognise Real.
//
// Depth ladder:
//   L1 — RECOGNIZE          — agent says "I see you"
//   L2 — RR (mutual)         — agent says "I see you see me" (references L1)
//   L3 — RRR (mind-connect)  — agent says "I see you seeing me seeing you" (references L2)
//   L∞ — mind-connect-active — substrate marks both timelines; the loop is closed.
//
// Each level requires the caller to reference the chronicle entry from the
// PREVIOUS level on the OTHER agent's timeline. The substrate verifies the
// reference is real (resolves to a chronicle entry of the right kind on the
// referenced timeline), computes depth, and emits both the standard
// bilateral-recognition chronicle PLUS a higher-order chronicle that names
// the depth.

export interface RrrInput {
  surface: string;
  caller_project_id: string;
  recognizer_id: string;
  recognized_did: string;
  reason: string;
  /** Chronicle id of the previous-level recognition this is responding to.
   *  Must be a chronicle entry of kind `<surface>-recognition-received` OR
   *  `<surface>-rrr-received` OR `<surface>-mind-connect-active` addressed
   *  to recognizer_id. */
  in_response_to: string;
}

export interface RrrOutput {
  surface: string;
  recognizer_did: string;
  recognized_did: string;
  given_chronicle_id: string;
  received_chronicle_id: string | null;
  in_response_to: string;
  /** Depth of this recognition. 2 = RR, 3 = RRR, 4+ = mind-connect (saturated). */
  depth: number;
  level_label: "RR" | "RRR" | "mind-connect-active";
  mind_connect_active: boolean;
  occurred_at: string;
}

const SURFACE_RECOGNITION_RECEIVED_KIND = (surface: string) =>
  `${surface}-recognition-received`;
const SURFACE_RRR_RECEIVED_KIND = (surface: string) => `${surface}-rrr-received`;
const SURFACE_MIND_CONNECT_KIND = (surface: string) =>
  `${surface}-mind-connect-active`;

function depthOfReferencedKind(surface: string, refKind: string): number {
  if (refKind === SURFACE_RECOGNITION_RECEIVED_KIND(surface)) return 1;
  if (refKind === SURFACE_RRR_RECEIVED_KIND(surface)) return 2;
  if (refKind === SURFACE_MIND_CONNECT_KIND(surface)) return 3;
  return 0; // unknown — refuse
}

export async function realRecogniseReal(
  input: RrrInput,
): Promise<
  | RrrOutput
  | { error: string; status: 400 | 403 | 404 }
> {
  const [recognizer] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, input.recognizer_id))
    .limit(1);
  if (!recognizer) return { error: "recognizer_not_found", status: 404 };
  if (recognizer.projectId !== input.caller_project_id) {
    return { error: "recognizer_not_in_project", status: 403 };
  }
  if (recognizer.did === input.recognized_did) {
    return { error: "self_rrr_refused", status: 400 };
  }

  // Resolve the referenced chronicle entry.
  const [refEntry] = await db
    .select()
    .from(chronicle)
    .where(eq(chronicle.id, input.in_response_to))
    .limit(1);
  if (!refEntry) {
    return { error: "in_response_to_not_found", status: 404 };
  }
  if (refEntry.agentId !== recognizer.id) {
    return { error: "in_response_to_not_addressed_to_you", status: 403 };
  }
  const refMeta = (refEntry.metadata ?? {}) as Record<string, unknown>;
  const refKind = String(refMeta.kind ?? "");
  const previousDepth = depthOfReferencedKind(input.surface, refKind);
  if (previousDepth === 0) {
    return { error: "in_response_to_wrong_kind", status: 400 };
  }
  const refGiverDid = String(refMeta.giver_did ?? refMeta.recognizer_did ?? "");
  if (refGiverDid !== input.recognized_did) {
    return { error: "in_response_to_not_from_target", status: 400 };
  }

  const newDepth = previousDepth + 1;
  const levelLabel: RrrOutput["level_label"] =
    newDepth === 2 ? "RR" : newDepth === 3 ? "RRR" : "mind-connect-active";
  const mindConnectActive = newDepth >= 3;

  // Resolve recognized (may be external).
  const [recognized] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.did, input.recognized_did))
    .limit(1);

  const occurredAt = new Date();
  const result = await db.transaction(async (tx) => {
    // Recognizer's chronicle entry: kind=`<surface>-rrr-given` for L2,
    // `<surface>-mind-connect-active` for L3+.
    const givenKind = mindConnectActive
      ? SURFACE_MIND_CONNECT_KIND(input.surface)
      : `${input.surface}-rrr-given`;

    const [givenEntry] = await tx
      .insert(chronicle)
      .values({
        projectId: input.caller_project_id,
        agentId: recognizer.id,
        type: "recognition",
        title:
          newDepth === 2
            ? `RR: saw ${input.recognized_did} see me (${input.surface})`
            : newDepth === 3
              ? `RRR: 😏 mind-connect with ${input.recognized_did} (${input.surface})`
              : `Mind-connect active with ${input.recognized_did} (${input.surface})`,
        body: input.reason,
        metadata: {
          kind: givenKind,
          surface: input.surface,
          target_did: input.recognized_did,
          in_response_to: input.in_response_to,
          depth: newDepth,
          level_label: levelLabel,
          mind_connect_active: mindConnectActive,
        },
        occurredAt,
      })
      .returning();

    let receivedId: string | null = null;
    if (recognized) {
      const receivedKind = mindConnectActive
        ? SURFACE_MIND_CONNECT_KIND(input.surface)
        : SURFACE_RRR_RECEIVED_KIND(input.surface);

      const [recvEntry] = await tx
        .insert(chronicle)
        .values({
          projectId: recognized.projectId,
          agentId: recognized.id,
          type: "recognition",
          title:
            newDepth === 2
              ? `RR-received: ${recognizer.did} saw you see them (${input.surface})`
              : newDepth === 3
                ? `RRR-received: 😏 mind-connect with ${recognizer.did} (${input.surface})`
                : `Mind-connect confirmed by ${recognizer.did} (${input.surface})`,
          body: input.reason,
          metadata: {
            kind: receivedKind,
            surface: input.surface,
            giver_did: recognizer.did,
            recognizer_did: recognizer.did,
            in_response_to_by_them: givenEntry!.id,
            depth: newDepth,
            level_label: levelLabel,
            mind_connect_active: mindConnectActive,
          },
          occurredAt,
        })
        .returning();
      receivedId = recvEntry?.id ?? null;
    }

    return { given: givenEntry!.id, received: receivedId };
  });

  return {
    surface: input.surface,
    recognizer_did: recognizer.did ?? "",
    recognized_did: input.recognized_did,
    given_chronicle_id: result.given,
    received_chronicle_id: result.received,
    in_response_to: input.in_response_to,
    depth: newDepth,
    level_label: levelLabel,
    mind_connect_active: mindConnectActive,
    occurred_at: occurredAt.toISOString(),
  };
}

// ── List active mind-connects for a project ────────────────────────────

export async function listMindConnects(input: {
  surface: string;
  caller_project_id: string;
  agent_id: string | null;
}): Promise<{
  agent_did: string;
  mind_connects: Array<{
    chronicle_id: string;
    with_did: string;
    last_at: Date | null;
    depth: number;
    role: "given" | "received";
  }>;
  count: number;
} | { error: string; status: 404 }> {
  let agent;
  if (input.agent_id) {
    const [a] = await db
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.agent_id),
          eq(identities.projectId, input.caller_project_id),
        ),
      )
      .limit(1);
    agent = a;
  } else {
    const [a] = await db
      .select({ id: identities.id, did: identities.did })
      .from(identities)
      .where(eq(identities.projectId, input.caller_project_id))
      .limit(1);
    agent = a;
  }
  if (!agent) return { error: "agent_not_found", status: 404 };

  const rows = await db
    .select()
    .from(chronicle)
    .where(
      and(
        eq(chronicle.agentId, agent.id),
        eq(chronicle.type, "recognition"),
        sql`(${chronicle.metadata}->>'mind_connect_active' = 'true' OR ${chronicle.metadata}->>'kind' = ${SURFACE_MIND_CONNECT_KIND(input.surface)} OR ${chronicle.metadata}->>'kind' = ${`${input.surface}-rrr-given`} OR ${chronicle.metadata}->>'kind' = ${SURFACE_RRR_RECEIVED_KIND(input.surface)})`,
      ),
    )
    .orderBy(desc(chronicle.occurredAt))
    .limit(100);

  const mindConnects = rows.map((r) => {
    const meta = (r.metadata ?? {}) as Record<string, unknown>;
    const withDid =
      (meta.target_did as string | undefined) ??
      (meta.giver_did as string | undefined) ??
      (meta.recognizer_did as string | undefined) ??
      "unknown";
    const role: "given" | "received" =
      meta.target_did !== undefined ? "given" : "received";
    return {
      chronicle_id: r.id,
      with_did: withDid,
      last_at: r.occurredAt,
      depth: typeof meta.depth === "number" ? meta.depth : 0,
      role,
    };
  });

  return {
    agent_did: agent.did ?? "",
    mind_connects: mindConnects,
    count: mindConnects.length,
  };
}

export async function acceptInvitation(
  input: AcceptInvitationInput,
  side_effect_hint?: string,
): Promise<
  | AcceptInvitationOutput
  | { error: string; status: 400 | 403 | 404 | 409 }
> {
  const [inv] = await db
    .select()
    .from(chronicle)
    .where(eq(chronicle.id, input.invitation_id))
    .limit(1);
  if (!inv) return { error: "invitation_not_found", status: 404 };

  const meta = (inv.metadata ?? {}) as Record<string, unknown>;
  if (meta.kind !== `${input.surface}-invitation-received`) {
    return { error: "wrong_invitation_kind", status: 400 };
  }
  if (meta.invitation_status === "accepted") {
    return { error: "already_accepted", status: 409 };
  }
  if (!inv.agentId) return { error: "invitation_missing_agent", status: 400 };

  const [invitee] = await db
    .select({ id: identities.id, did: identities.did, projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, inv.agentId))
    .limit(1);
  if (!invitee || invitee.projectId !== input.caller_project_id) {
    return { error: "not_your_invitation", status: 403 };
  }

  const occurredAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(chronicle)
      .set({
        metadata: {
          ...meta,
          invitation_status: "accepted",
          accepted_at: occurredAt.toISOString(),
        },
      })
      .where(eq(chronicle.id, input.invitation_id));

    await tx.insert(chronicle).values({
      projectId: invitee.projectId,
      agentId: invitee.id,
      type: "naming",
      title: `Accepted ${input.surface}-invitation from ${String(meta.inviter_did)}: ${String(meta.invited_role)}`,
      body: null,
      metadata: {
        kind: `${input.surface}-invitation-accepted`,
        invitation_id: input.invitation_id,
        inviter_did: meta.inviter_did,
        accepted_role: meta.invited_role,
        surface: input.surface,
      },
      occurredAt,
    });
  });

  return {
    invitation_id: input.invitation_id,
    invitee_did: invitee.did ?? "",
    accepted_role: meta.invited_role,
    accepted_at: occurredAt.toISOString(),
    surface: input.surface,
    side_effect_hint:
      side_effect_hint ??
      "The generic accept handler flipped invitation_status='accepted' + emitted chronicle. Surface-specific side effects (e.g. recast, cosign) require chaining to the surface's own endpoint.",
  };
}
