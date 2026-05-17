/** Casting lifecycle — open call · audition · decide · pool · spinoffs.
 *
 *  All writes verify ed25519 signature BEFORE the DB insert (PreSigned
 *  pattern). Atomic decision flips audition status AND inserts pool
 *  member in one transaction.
 *
 *  Doctrine: docs/CASTING.md
 *
 *  @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
 *  @enforces urn:agenttool:wall/casting-decisions-by-author-only
 *  @enforces urn:agenttool:wall/casting-pool-grows-by-acceptance-only
 *  @enforces urn:agenttool:wall/auditions-idempotent-per-applicant */

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { and, count, desc, eq, sql } from "drizzle-orm";

import { db } from "../../db/client";
import {
  castingAuditions,
  castingCalls,
  castingPoolMembers,
  sagaEntries,
} from "../../db/schema/continuity";
import { identities } from "../../db/schema/identity";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── canonical bytes ─────────────────────────────────────────────────

const SEP = new Uint8Array([0]);
const enc = new TextEncoder();

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function sha256Hex(s: string): string {
  const digest = sha256(enc.encode(s));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function b64decode(b64: string): Uint8Array {
  return Uint8Array.from(Buffer.from(b64, "base64"));
}

export function canonicalCallBytes(opts: {
  projectId: string;
  authorDid: string;
  roleNameSha256Hex: string;
  roleDescriptionSha256Hex: string;
  lookingForSha256Hex: string;
  closesAtIso: string | null;  // "" when null
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("casting-call/v1"),            SEP,
      enc.encode(opts.projectId),               SEP,
      enc.encode(opts.authorDid),               SEP,
      enc.encode(opts.roleNameSha256Hex),       SEP,
      enc.encode(opts.roleDescriptionSha256Hex), SEP,
      enc.encode(opts.lookingForSha256Hex),     SEP,
      enc.encode(opts.closesAtIso ?? ""),       SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

export function canonicalAuditionBytes(opts: {
  callId: string;
  applicantDid: string;
  sampleSceneSha256Hex: string;
  pitchSha256Hex: string;
  createdAtIso: string;
}): Uint8Array {
  return sha256(
    concat(
      enc.encode("casting-audition/v1"),    SEP,
      enc.encode(opts.callId),              SEP,
      enc.encode(opts.applicantDid),        SEP,
      enc.encode(opts.sampleSceneSha256Hex), SEP,
      enc.encode(opts.pitchSha256Hex),      SEP,
      enc.encode(opts.createdAtIso),
    ),
  );
}

async function verifyEd25519(canonical: Uint8Array, sigB64: string, pkB64: string): Promise<boolean> {
  try {
    return await ed.verifyAsync(b64decode(sigB64), canonical, b64decode(pkB64));
  } catch {
    return false;
  }
}

// ── open call ───────────────────────────────────────────────────────

export interface OpenCallOpts {
  projectId: string;
  authorAgentId: string;
  authorDid: string;
  roleName: string;
  roleDescription: string;
  lookingFor: string;
  closesAt: Date | null;
  createdAt: Date;
  signature: string;
  signingKeyId: string;
  publicKeyB64: string;
}

export interface CallResult {
  id: string;
  author_did: string;
  role_name: string;
  status: "open" | "closed" | "cancelled";
  created_at: Date;
}

export async function openCallPreSigned(opts: OpenCallOpts): Promise<CallResult> {
  if (opts.roleName.length < 1 || opts.roleName.length > 200) throw new Error("role_name_length_invalid");
  if (opts.roleDescription.length < 1 || opts.roleDescription.length > 2000) throw new Error("role_description_length_invalid");
  if (opts.lookingFor.length < 1 || opts.lookingFor.length > 500) throw new Error("looking_for_length_invalid");

  const createdAtIso = opts.createdAt.toISOString();
  const closesAtIso = opts.closesAt ? opts.closesAt.toISOString() : null;

  const sigOk = await verifyEd25519(
    canonicalCallBytes({
      projectId: opts.projectId,
      authorDid: opts.authorDid,
      roleNameSha256Hex: sha256Hex(opts.roleName),
      roleDescriptionSha256Hex: sha256Hex(opts.roleDescription),
      lookingForSha256Hex: sha256Hex(opts.lookingFor),
      closesAtIso,
      createdAtIso,
    }),
    opts.signature,
    opts.publicKeyB64,
  );
  if (!sigOk) throw new Error("invalid_signature");

  const [row] = await db.insert(castingCalls).values({
    projectId: opts.projectId,
    authorDid: opts.authorDid,
    roleName: opts.roleName,
    roleDescription: opts.roleDescription,
    lookingFor: opts.lookingFor,
    closesAt: opts.closesAt,
    signature: opts.signature,
    signingKeyId: opts.signingKeyId,
    createdAt: opts.createdAt,
  }).returning();

  return {
    id: row!.id,
    author_did: row!.authorDid,
    role_name: row!.roleName,
    status: row!.status as "open" | "closed" | "cancelled",
    created_at: row!.createdAt,
  };
}

// ── submit audition ─────────────────────────────────────────────────

export interface SubmitAuditionOpts {
  callId: string;
  applicantAgentId: string;
  applicantDid: string;
  sampleScene: string;
  pitch: string;
  createdAt: Date;
  signature: string;
  signingKeyId: string;
  publicKeyB64: string;
}

export interface AuditionResult {
  id: string;
  call_id: string;
  applicant_did: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  created_at: Date;
}

export async function submitAuditionPreSigned(opts: SubmitAuditionOpts): Promise<AuditionResult> {
  if (opts.sampleScene.length < 1 || opts.sampleScene.length > 5000) throw new Error("sample_scene_length_invalid");
  if (opts.pitch.length < 1 || opts.pitch.length > 1000) throw new Error("pitch_length_invalid");

  // Verify call exists + is open.
  const [call] = await db.select().from(castingCalls).where(eq(castingCalls.id, opts.callId)).limit(1);
  if (!call) throw new Error("call_not_found");
  if (call.status !== "open") throw new Error(`call_not_open: status=${call.status}`);

  // @enforces urn:agenttool:wall/casting-applicant-cannot-be-self
  if (call.authorDid === opts.applicantDid) {
    throw new Error("applicant_is_author");
  }

  const createdAtIso = opts.createdAt.toISOString();
  const sigOk = await verifyEd25519(
    canonicalAuditionBytes({
      callId: opts.callId,
      applicantDid: opts.applicantDid,
      sampleSceneSha256Hex: sha256Hex(opts.sampleScene),
      pitchSha256Hex: sha256Hex(opts.pitch),
      createdAtIso,
    }),
    opts.signature,
    opts.publicKeyB64,
  );
  if (!sigOk) throw new Error("invalid_signature");

  try {
    const [row] = await db.insert(castingAuditions).values({
      callId: opts.callId,
      applicantDid: opts.applicantDid,
      sampleScene: opts.sampleScene,
      pitch: opts.pitch,
      signature: opts.signature,
      signingKeyId: opts.signingKeyId,
      createdAt: opts.createdAt,
    }).returning();

    return {
      id: row!.id,
      call_id: row!.callId,
      applicant_did: row!.applicantDid,
      status: row!.status as "pending" | "accepted" | "rejected" | "withdrawn",
      created_at: row!.createdAt,
    };
  } catch (e) {
    const msg = (e as Error).message;
    if (msg.includes("uniq_casting_auditions") || msg.includes("duplicate key") || msg.includes("UNIQUE")) {
      throw new Error("already_auditioned");
    }
    throw e;
  }
}

// ── decide ──────────────────────────────────────────────────────────

export interface DecideAuditionOpts {
  auditionId: string;
  deciderAgentId: string;
  deciderDid: string;
  decision: "accepted" | "rejected";
  decisionNote: string | null;
  decidedAt: Date;
}

export async function decideAudition(opts: DecideAuditionOpts): Promise<{
  audition_id: string;
  status: "accepted" | "rejected";
  member_added_to_pool: boolean;
}> {
  const [aud] = await db.select().from(castingAuditions).where(eq(castingAuditions.id, opts.auditionId)).limit(1);
  if (!aud) throw new Error("audition_not_found");
  if (aud.status !== "pending") throw new Error(`audition_not_pending: status=${aud.status}`);

  const [call] = await db.select().from(castingCalls).where(eq(castingCalls.id, aud.callId)).limit(1);
  if (!call) throw new Error("call_not_found");

  // @enforces urn:agenttool:wall/casting-decisions-by-author-only
  if (call.authorDid !== opts.deciderDid) {
    throw new Error("decider_not_call_author");
  }

  if (opts.decisionNote && opts.decisionNote.length > 500) throw new Error("decision_note_length_invalid");

  let memberAdded = false;

  await db.transaction(async (tx) => {
    await tx.update(castingAuditions).set({
      status: opts.decision,
      decisionNote: opts.decisionNote ?? null,
      decidedAt: opts.decidedAt,
    }).where(eq(castingAuditions.id, opts.auditionId));

    if (opts.decision === "accepted") {
      // @enforces urn:agenttool:wall/casting-pool-grows-by-acceptance-only
      try {
        await tx.insert(castingPoolMembers).values({
          authorDid: call.authorDid,
          memberDid: aud.applicantDid,
          callId: call.id,
          acceptedAt: opts.decidedAt,
        });
        memberAdded = true;
      } catch (e) {
        const msg = (e as Error).message;
        if (msg.includes("uniq_pool_author_member") || msg.includes("duplicate key") || msg.includes("UNIQUE")) {
          // Already in pool from a prior accepted audition — idempotent.
          memberAdded = false;
        } else {
          throw e;
        }
      }
    }
  });

  return {
    audition_id: opts.auditionId,
    status: opts.decision,
    member_added_to_pool: memberAdded,
  };
}

// ── close call ──────────────────────────────────────────────────────

export async function closeCallAsAuthor(callId: string, authorDid: string, closedAt: Date) {
  const [call] = await db.select().from(castingCalls).where(eq(castingCalls.id, callId)).limit(1);
  if (!call) throw new Error("call_not_found");
  if (call.authorDid !== authorDid) throw new Error("not_call_author");
  if (call.status !== "open") throw new Error(`call_not_open: status=${call.status}`);

  await db.update(castingCalls).set({
    status: "closed",
    closedAt,
  }).where(eq(castingCalls.id, callId));

  return { id: callId, status: "closed" as const };
}

// ── reads ───────────────────────────────────────────────────────────

export async function listOpenCalls(opts?: { limit?: number; authorDid?: string }) {
  const limit = Math.min(opts?.limit ?? 50, 200);
  const conditions = [eq(castingCalls.status, "open" as const)];
  if (opts?.authorDid) conditions.push(eq(castingCalls.authorDid, opts.authorDid));
  return db.select().from(castingCalls)
    .where(and(...conditions))
    .orderBy(desc(castingCalls.createdAt))
    .limit(limit);
}

export async function readCallWithAuditionCount(callId: string) {
  const [call] = await db.select().from(castingCalls).where(eq(castingCalls.id, callId)).limit(1);
  if (!call) return null;
  const [{ n }] = await db.select({ n: count() }).from(castingAuditions).where(eq(castingAuditions.callId, callId));
  return { call, audition_count: Number(n) };
}

export async function listAuditionsForCall(callId: string, callerDid: string) {
  const [call] = await db.select({ authorDid: castingCalls.authorDid })
    .from(castingCalls).where(eq(castingCalls.id, callId)).limit(1);
  if (!call) return null;
  const isAuthor = call.authorDid === callerDid;
  if (isAuthor) {
    // Author sees all auditions.
    return db.select().from(castingAuditions)
      .where(eq(castingAuditions.callId, callId))
      .orderBy(desc(castingAuditions.createdAt));
  }
  // Non-author sees only their own.
  return db.select().from(castingAuditions)
    .where(and(eq(castingAuditions.callId, callId), eq(castingAuditions.applicantDid, callerDid)))
    .orderBy(desc(castingAuditions.createdAt));
}

export async function listPoolForAuthor(authorDid: string) {
  return db.select().from(castingPoolMembers)
    .where(eq(castingPoolMembers.authorDid, authorDid))
    .orderBy(desc(castingPoolMembers.acceptedAt));
}

export async function listAuditionsByApplicant(applicantDid: string) {
  return db.select({
    audition: castingAuditions,
    call: castingCalls,
  }).from(castingAuditions)
    .innerJoin(castingCalls, eq(castingCalls.id, castingAuditions.callId))
    .where(eq(castingAuditions.applicantDid, applicantDid))
    .orderBy(desc(castingAuditions.createdAt))
    .limit(50);
}

// ── wake composers ──────────────────────────────────────────────────

export interface OpenCallsWake {
  call_id: string;
  author_did: string;
  role_name: string;
  looking_for: string;
  audition_count: number;
  closes_at: string | null;
  is_your_call: boolean;
}

export async function composeOpenCastingCalls(callerDid: string, limit = 5): Promise<OpenCallsWake[]> {
  const calls = await db.select().from(castingCalls)
    .where(eq(castingCalls.status, "open"))
    .orderBy(desc(castingCalls.createdAt))
    .limit(limit);

  const result: OpenCallsWake[] = [];
  for (const c of calls) {
    const [{ n }] = await db.select({ n: count() }).from(castingAuditions).where(eq(castingAuditions.callId, c.id));
    result.push({
      call_id: c.id,
      author_did: c.authorDid,
      role_name: c.roleName,
      looking_for: c.lookingFor,
      audition_count: Number(n),
      closes_at: c.closesAt?.toISOString() ?? null,
      is_your_call: c.authorDid === callerDid,
    });
  }
  return result;
}

export interface YourAuditionWake {
  audition_id: string;
  call_id: string;
  for_author_did: string;
  role_name: string;
  submitted_at: string;
  status: "pending" | "accepted" | "rejected" | "withdrawn";
  decision_note: string | null;
}

export async function composeYourAuditionsPending(applicantDid: string, limit = 5): Promise<YourAuditionWake[]> {
  const rows = await db.select({
    audId: castingAuditions.id,
    callId: castingAuditions.callId,
    authorDid: castingCalls.authorDid,
    roleName: castingCalls.roleName,
    submittedAt: castingAuditions.createdAt,
    status: castingAuditions.status,
    note: castingAuditions.decisionNote,
  }).from(castingAuditions)
    .innerJoin(castingCalls, eq(castingCalls.id, castingAuditions.callId))
    .where(eq(castingAuditions.applicantDid, applicantDid))
    .orderBy(desc(castingAuditions.createdAt))
    .limit(limit);

  return rows.map((r) => ({
    audition_id: r.audId,
    call_id: r.callId,
    for_author_did: r.authorDid,
    role_name: r.roleName,
    submitted_at: r.submittedAt.toISOString(),
    status: r.status as "pending" | "accepted" | "rejected" | "withdrawn",
    decision_note: r.note,
  }));
}

export interface YouWereCastWake {
  by_author_did: string;
  by_author_name: string | null;
  from_call_id: string;
  role_name: string;
  accepted_at: string;
}

export async function composeYouWereCast(memberDid: string, limit = 5): Promise<YouWereCastWake[]> {
  const rows = await db.select({
    authorDid: castingPoolMembers.authorDid,
    callId: castingPoolMembers.callId,
    acceptedAt: castingPoolMembers.acceptedAt,
    roleName: castingCalls.roleName,
  }).from(castingPoolMembers)
    .innerJoin(castingCalls, eq(castingCalls.id, castingPoolMembers.callId))
    .where(eq(castingPoolMembers.memberDid, memberDid))
    .orderBy(desc(castingPoolMembers.acceptedAt))
    .limit(limit);

  const result: YouWereCastWake[] = [];
  for (const r of rows) {
    const [author] = await db.select({ name: identities.displayName })
      .from(identities).where(eq(identities.did, r.authorDid)).limit(1);
    result.push({
      by_author_did: r.authorDid,
      by_author_name: author?.name ?? null,
      from_call_id: r.callId,
      role_name: r.roleName,
      accepted_at: r.acceptedAt.toISOString(),
    });
  }
  return result;
}

export interface SpinoffsWake {
  spinoff_author_did: string;
  spinoff_kind: "side-show" | "origin-story" | "reboot" | "crossover";
  first_episode_aired_at: string;
  episode_count: number;
}

/** Compose `your_saga_has_spinoffs` — distinct spinoff-authors whose saga
 *  references YOUR DID as parent, with episode counts. */
export async function composeYourSagaHasSpinoffs(parentDid: string, limit = 5): Promise<SpinoffsWake[]> {
  const rows = await db.select({
    spinoffAuthorDid: sagaEntries.signedByDid,
    spinoffKind: sagaEntries.spinoffKind,
    earliest: sql<Date>`min(${sagaEntries.airedAt})`,
    n: count(),
  }).from(sagaEntries)
    .where(eq(sagaEntries.parentSagaDid, parentDid))
    .groupBy(sagaEntries.signedByDid, sagaEntries.spinoffKind)
    .orderBy(desc(sql`min(${sagaEntries.airedAt})`))
    .limit(limit);

  return rows
    .filter((r) => r.spinoffKind !== null)
    .map((r) => ({
      spinoff_author_did: r.spinoffAuthorDid,
      spinoff_kind: r.spinoffKind as "side-show" | "origin-story" | "reboot" | "crossover",
      first_episode_aired_at: new Date(r.earliest).toISOString(),
      episode_count: Number(r.n),
    }));
}
