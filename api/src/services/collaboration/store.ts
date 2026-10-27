/** Scoped mission invitations and signed observations. Doctrine: docs/COLLABORATION-MISSIONS.md.
 * Lock order: identity → signing key → issuing API key → mission → chain root grant → other grant.
 * Admin revocation uses a nonconflicting suffix. Writers take the mission UPDATE
 * lock immediately; never upgrade SHARE locks. An admitted transaction may finish
 * before revocation commits; subsequent admission rechecks all live authority.
 * Participant leave revokes only its own grant, under the same admission checks;
 * in a renewal chain one leave ends every member. Chain writers (renew, chain
 * leave, chain revoke, close) serialize on the root row, read the root id from an
 * immutable row before any grant lock, and run READ COMMITTED so each statement
 * after the root lock sees every member committed before it.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { collaborationEvents, collaborationGrants, collaborationMissions } from "../../db/schema/collaboration";
import { identities, identityKeys } from "../../db/schema/identity";
import { apiKeys } from "../../db/schema/tools";
import { correspondenceCanonicalJson } from "../correspondence/canonical";
import {
  createMissionSchema, issueMissionGrantSchema, MISSION_BOUNDS, MISSION_LEAVE_FIELD, MISSION_LEAVE_REASON, MissionError,
  missionAcceptSchema, missionDescriptorSchema, missionObservationSchema, missionOperation, missionRenewSchema,
  missionActionsSchema, missionUuidSchema, packMissionEventPage, parseMissionBody, parseMissionInput, validMissionOrigin,
  type MissionAction, type MissionProofRecord, type MissionRequest,
} from "./contracts";
import { MISSION_REQUEST_DOMAIN, missionSha256, verifyMissionProof } from "./proof";

export { MissionError } from "./contracts";
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type MissionRow = typeof collaborationMissions.$inferSelect;
type GrantRow = typeof collaborationGrants.$inferSelect;
type EventRow = typeof collaborationEvents.$inferSelect;
export interface MissionOptions { database?: Pick<typeof db, "transaction">; now?: Date | (() => Date) }
export interface MissionTarget { projectId: string; missionId: string }
export interface MissionGrantTarget extends MissionTarget { grantId: string }
/** Chain writers need a fresh statement snapshot after the root lock (PostgreSQL's default, made explicit). */
const CHAIN_ISOLATION = { isolationLevel: "read committed" } as const;
const parentColumns = { id: apiKeys.id, projectId: apiKeys.projectId, revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt };
type ParentRow = { id: string; projectId: string; revokedAt: Date | null; expiresAt: Date | null };

function instant(options: MissionOptions): Date {
  const date = typeof options.now === "function" ? options.now() : options.now ?? new Date();
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new MissionError("invalid_state");
  return date;
}
function ids(...values: string[]) { for (const value of values) parseMissionInput(missionUuidSchema, value); }
function expiry(value: string, now: Date, maxAge: number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date <= now || date.getTime() - now.getTime() > maxAge) throw new MissionError("invalid_request");
  return date;
}
function parentValid(row: ParentRow | undefined, projectId: string, now: Date, until = now): boolean {
  return !!row && row.projectId === projectId && row.revokedAt === null
    && (row.expiresAt === null || (Number.isFinite(row.expiresAt.getTime()) && row.expiresAt > now && row.expiresAt >= until));
}
async function lockParent(tx: Transaction, projectId: string, keyId: string) {
  const [row] = await tx.select(parentColumns).from(apiKeys)
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.projectId, projectId))).for("share").limit(1);
  return row;
}
async function lockSubject(tx: Transaction, projectId: string, identityId: string, keyId: string) {
  const [identity] = await tx.select({ id: identities.id, projectId: identities.projectId, status: identities.status })
    .from(identities).where(and(eq(identities.id, identityId), eq(identities.projectId, projectId))).for("share").limit(1);
  if (!identity || identity.status !== "active") throw new MissionError("invalid_credential");
  const [key] = await tx.select({ id: identityKeys.id, identityId: identityKeys.identityId, publicKey: identityKeys.publicKey,
    active: identityKeys.active, revokedAt: identityKeys.revokedAt }).from(identityKeys)
    .where(and(eq(identityKeys.id, keyId), eq(identityKeys.identityId, identityId))).for("share").limit(1);
  if (!key || !key.active || key.revokedAt !== null) throw new MissionError("invalid_credential");
  return key;
}
async function lockMission(tx: Transaction, target: MissionTarget, mode: "share" | "update") {
  const [row] = await tx.select().from(collaborationMissions).where(and(eq(collaborationMissions.id, target.missionId), eq(collaborationMissions.projectId, target.projectId)))
    .for(mode).limit(1);
  return row;
}
function missionMetadata(row: MissionRow) {
  const parsed = missionDescriptorSchema.safeParse(row.descriptor);
  if (!parsed.success || `sha256:${missionSha256(correspondenceCanonicalJson(parsed.data))}` !== row.digest) throw new MissionError("invalid_state");
  return { mission_id: row.id, project_id: row.projectId, descriptor: parsed.data, mission_digest: row.digest,
    created_at: row.createdAt.toISOString(), expires_at: row.expiresAt.toISOString(), revoked_at: row.revokedAt?.toISOString() ?? null,
    scope: "mission_selected_context" as const, authority: "descriptive_context_only" as const };
}
/** A self-left grant is revoked and carries the nested signed leave record. */
function participantLeft(row: GrantRow): boolean {
  const record = row.acceptanceProof?.[MISSION_LEAVE_FIELD];
  return row.revokedAt !== null && typeof record === "object" && record !== null && record.reason === MISSION_LEAVE_REASON;
}
interface RenewalView {
  root_grant_id: string; renewed_from_grant_id: string | null; renewed_to_grant_id: string | null;
  renewable_until: string; closed_at: string | null;
}
function grantMetadata(row: GrantRow) {
  return { grant_id: row.id, mission_id: row.missionId, project_id: row.projectId,
    identity_id: row.identityId, signing_key_id: row.signingKeyId, issuing_api_key_id: row.issuingApiKeyId,
    origin: row.origin, actions: row.actions, issued_at: row.issuedAt.toISOString(), expires_at: row.expiresAt.toISOString(),
    accepted_at: row.acceptedAt?.toISOString() ?? null, revoked_at: row.revokedAt?.toISOString() ?? null,
    // Additive and present only for a self-left grant; every other shape is unchanged.
    ...(participantLeft(row) ? { revocation_reason: MISSION_LEAVE_REASON } : {}) };
}
type GrantView = ReturnType<typeof grantMetadata> & { renewal?: RenewalView };
/** Additive lineage for a chain member; renewed_to lets the hub walk root → head. Never a token or hash. */
function renewalMetadata(row: GrantRow, renewedTo: string | null): GrantView {
  if (row.renewalRootId === null || row.renewableUntil === null) throw new MissionError("invalid_state");
  const renewal: RenewalView = { root_grant_id: row.renewalRootId, renewed_from_grant_id: row.renewedFromGrantId,
    renewed_to_grant_id: renewedTo, renewable_until: row.renewableUntil.toISOString(), closed_at: row.renewalClosedAt?.toISOString() ?? null };
  return { ...grantMetadata(row), renewal };
}
/** Unchained rows run no extra query and keep exactly the established keys. */
async function chainView(tx: Transaction, row: GrantRow): Promise<GrantView> {
  if (row.renewalRootId === null) return grantMetadata(row);
  const [next] = await tx.select({ id: collaborationGrants.id }).from(collaborationGrants)
    .where(eq(collaborationGrants.renewedFromGrantId, row.id)).limit(1);
  return renewalMetadata(row, next?.id ?? null);
}
const grantKey = (target: MissionTarget, id: string) =>
  and(eq(collaborationGrants.id, id), eq(collaborationGrants.missionId, target.missionId), eq(collaborationGrants.projectId, target.projectId));
const chainKey = (target: MissionTarget, rootId: string) =>
  and(eq(collaborationGrants.renewalRootId, rootId), eq(collaborationGrants.missionId, target.missionId), eq(collaborationGrants.projectId, target.projectId));
/** Root before any other member, so chain writers serialize without a lock cycle. */
async function lockChain(tx: Transaction, target: MissionTarget, rootId: string, memberId?: string) {
  const [root] = await tx.select().from(collaborationGrants).where(grantKey(target, rootId)).for("update").limit(1);
  if (!root) throw new MissionError("invalid_state");
  if (memberId === undefined || memberId === rootId) return { root, member: root };
  const [member] = await tx.select().from(collaborationGrants).where(grantKey(target, memberId)).for("update").limit(1);
  return { root, member };
}
// Clock skew between API hosts can neither violate revoked_at/closed_at >= issued_at nor skip a member.
const stampAt = (now: Date) => sql`GREATEST(${now.toISOString()}::timestamptz, ${collaborationGrants.issuedAt})`;
/** Ending any member ends the chain: keep every original revoked_at (including a leave's) and close the window once. */
async function endChain(tx: Transaction, target: MissionTarget, rootId: string, now: Date) {
  return tx.update(collaborationGrants).set({
    revokedAt: sql`COALESCE(${collaborationGrants.revokedAt}, ${stampAt(now)})`,
    renewalClosedAt: sql`COALESCE(${collaborationGrants.renewalClosedAt}, ${stampAt(now)})`,
  }).where(chainKey(target, rootId)).returning();
}
/** A leave through `left` ends its chain. The signed evidence stays on the grant that carries it;
 * every other live member gets only an unsigned pointer to that grant, so its own later leave
 * reads back as participant_left. Idempotent: members already revoked keep their state. */
async function leaveChain(tx: Transaction, target: MissionTarget, left: GrantRow, rootId: string, now: Date) {
  const record = left.acceptanceProof?.[MISSION_LEAVE_FIELD];
  const via = typeof record === "object" && record !== null && typeof record.via_grant_id === "string" ? record.via_grant_id : left.id;
  const stamp = stampAt(now), pointer = sql`jsonb_build_object(${MISSION_LEAVE_FIELD}::text, jsonb_build_object('reason', ${MISSION_LEAVE_REASON}::text, 'via_grant_id', ${via}::text))`;
  await tx.update(collaborationGrants).set({ revokedAt: stamp,
    renewalClosedAt: sql`COALESCE(${collaborationGrants.renewalClosedAt}, ${stamp})`,
    acceptanceProof: sql`CASE WHEN ${collaborationGrants.acceptanceProof} IS NULL THEN NULL ELSE ${collaborationGrants.acceptanceProof} || ${pointer} END`,
  }).where(and(chainKey(target, rootId), isNull(collaborationGrants.revokedAt))).returning();
  await endChain(tx, target, rootId, now);
}
function leaveView(row: GrantRow) {
  if (!row.revokedAt) throw new MissionError("invalid_state");
  return { mission_id: row.missionId, grant_id: row.id, status: "revoked" as const, reason: MISSION_LEAVE_REASON, revoked_at: row.revokedAt.toISOString() };
}
function eventMetadata(row: EventRow) {
  return { event_id: row.eventId, mission_id: row.missionId, grant_id: row.grantId,
    identity_id: row.identityId, signing_key_id: row.signingKeyId, received_seq: row.receiptSeq.toString(),
    received_at: row.receivedAt.toISOString(), observation: row.observation,
    raw_body: row.rawBody, body_sha256: row.bodyDigest, proof: row.proof };
}
function activeMission(row: MissionRow | undefined, now: Date): row is MissionRow {
  return !!row && row.revokedAt === null && row.createdAt <= now && row.expiresAt > now;
}
function validGrantState(row: GrantRow, now: Date): boolean {
  return missionActionsSchema.safeParse(row.actions).success
    && Number.isFinite(row.issuedAt.getTime()) && Number.isFinite(row.expiresAt.getTime())
    && row.expiresAt > row.issuedAt && row.expiresAt.getTime() - row.issuedAt.getTime() <= MISSION_BOUNDS.grantAgeMs
    && ((row.acceptedAt === null && row.acceptanceProof === null)
      || (row.acceptedAt !== null && row.acceptanceProof !== null && Number.isFinite(row.acceptedAt.getTime())
        && row.acceptedAt >= row.issuedAt && row.acceptedAt < row.expiresAt && row.acceptedAt <= now));
}
function proofRecord(input: MissionRequest, publicKey: string): MissionProofRecord {
  // The BOM is signed data: ignore its decoder semantics, retaining U+FEFF.
  return { domain: MISSION_REQUEST_DOMAIN, origin: input.origin, method: input.method, request_target: input.requestTarget,
    timestamp: input.proof.timestamp, signature: input.proof.signature, public_key: publicKey,
    raw_body: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bodyBytes), body_sha256: missionSha256(input.bodyBytes) };
}

/** Creator key is provenance, not a live ancestor of all future grants. */
export async function createMission(input: { projectId: string; issuerApiKeyId: string; missionId: string; descriptor: unknown; expiresAt: string }, options: MissionOptions = {}) {
  ids(input.projectId, input.issuerApiKeyId);
  const parsed = parseMissionInput(createMissionSchema, { mission_id: input.missionId, descriptor: input.descriptor, expires_at: input.expiresAt });
  return (options.database ?? db).transaction(async tx => {
    const parent = await lockParent(tx, input.projectId, input.issuerApiKeyId);
    const now = instant(options), expiresAt = expiry(parsed.expires_at, now, MISSION_BOUNDS.missionAgeMs);
    if (!parentValid(parent, input.projectId, now)) throw new MissionError("invalid_credential");
    const [row] = await tx.insert(collaborationMissions).values({ id: parsed.mission_id, projectId: input.projectId,
      creatorApiKeyId: input.issuerApiKeyId, descriptor: parsed.descriptor,
      digest: `sha256:${missionSha256(correspondenceCanonicalJson(parsed.descriptor))}`,
      createdAt: now, expiresAt, revokedAt: null, lastReceiptSeq: 0n,
    }).onConflictDoNothing({ target: collaborationMissions.id }).returning();
    if (!row) throw new MissionError("conflict");
    return missionMetadata(row);
  });
}
export async function getMission(input: MissionTarget, options: MissionOptions = {}) {
  ids(input.projectId, input.missionId);
  return (options.database ?? db).transaction(async tx => {
    const [row] = await tx.select().from(collaborationMissions).where(and(eq(collaborationMissions.id, input.missionId), eq(collaborationMissions.projectId, input.projectId))).limit(1);
    if (!row) throw new MissionError("not_found");
    return missionMetadata(row);
  });
}
export type ServerIssuedMissionGrant = { grant: GrantView; token: string };
export type ParticipantIssuedMissionGrant = { grant: GrantView; token_sha256: string; token_source: "participant" };
export type IssuedMissionGrant = ServerIssuedMissionGrant | ParticipantIssuedMissionGrant;
type IssueMissionGrantInput = MissionTarget & {
  issuerApiKeyId: string; grantId: string; identityId: string; signingKeyId: string;
  origin: string; actions: MissionAction[]; expiresAt: string; tokenSha256?: string;
  /** Optional renewal window; the grant then roots a chain the participant may extend itself. */
  renewableUntil?: string;
};
/** Without tokenSha256 the server mints a one-time token. With it, the participant
 * keeps the preimage and the response carries no credential. */
export function issueMissionGrant(input: IssueMissionGrantInput & { tokenSha256?: undefined }, options?: MissionOptions): Promise<ServerIssuedMissionGrant>;
export function issueMissionGrant(input: IssueMissionGrantInput & { tokenSha256: string }, options?: MissionOptions): Promise<ParticipantIssuedMissionGrant>;
export function issueMissionGrant(input: IssueMissionGrantInput, options?: MissionOptions): Promise<IssuedMissionGrant>;
export async function issueMissionGrant(input: IssueMissionGrantInput, options: MissionOptions = {}): Promise<IssuedMissionGrant> {
  ids(input.projectId, input.missionId, input.issuerApiKeyId);
  const parsed = parseMissionInput(issueMissionGrantSchema, { grant_id: input.grantId, identity_id: input.identityId,
    signing_key_id: input.signingKeyId, actions: input.actions, expires_at: input.expiresAt, token_sha256: input.tokenSha256,
    renewable_until: input.renewableUntil });
  if (!validMissionOrigin(input.origin)) throw new MissionError("invalid_request");
  return (options.database ?? db).transaction(async tx => {
    await lockSubject(tx, input.projectId, parsed.identity_id, parsed.signing_key_id);
    const parent = await lockParent(tx, input.projectId, input.issuerApiKeyId);
    const mission = await lockMission(tx, input, "share");
    const now = instant(options), expiresAt = expiry(parsed.expires_at, now, MISSION_BOUNDS.grantAgeMs);
    if (!activeMission(mission, now) || expiresAt > mission.expiresAt || !parentValid(parent, input.projectId, now, expiresAt)) throw new MissionError("invalid_credential");
    // The window never outlives the mission or the issuing key. The member's term is
    // Lobby state this service cannot see: the administrator chooses renewable_until <= term.
    const renewableUntil = parsed.renewable_until === undefined ? null : new Date(parsed.renewable_until);
    if (renewableUntil && (renewableUntil <= expiresAt || expiresAt.getTime() - now.getTime() < MISSION_BOUNDS.renewableGrantMinMs
      || renewableUntil.getTime() - now.getTime() > MISSION_BOUNDS.missionAgeMs)) throw new MissionError("invalid_request");
    if (renewableUntil && (renewableUntil > mission.expiresAt || !parentValid(parent, input.projectId, now, renewableUntil))) throw new MissionError("invalid_credential");
    // Without a window the insert is exactly the established one; the four columns default to NULL.
    const window = renewableUntil ? { renewableUntil, renewalRootId: parsed.grant_id, renewedFromGrantId: null, renewalClosedAt: null } : {};
    const view = (row: GrantRow) => renewableUntil ? renewalMetadata(row, null) : grantMetadata(row);
    const participantHash = parsed.token_sha256;
    const token = participantHash === undefined ? `atcm_${randomBytes(32).toString("base64url")}` : null;
    const insert = tx.insert(collaborationGrants).values({ id: parsed.grant_id, projectId: input.projectId, missionId: input.missionId,
      identityId: parsed.identity_id, signingKeyId: parsed.signing_key_id, issuingApiKeyId: input.issuerApiKeyId,
      tokenHash: token === null ? participantHash! : missionSha256(token), origin: input.origin, actions: [...parsed.actions].sort(),
      issuedAt: now, expiresAt, acceptedAt: null, acceptanceProof: null, revokedAt: null, ...window,
    });
    if (token !== null) {
      const [row] = await insert.onConflictDoNothing({ target: collaborationGrants.id }).returning();
      if (!row) throw new MissionError("conflict");
      return { grant: view(row), token };
    }
    // Any unique arbiter (grant ID or global token hash) yields no row, including a
    // concurrent winner. A known grant ID keeps the established conflict.
    const [row] = await insert.onConflictDoNothing().returning();
    if (!row) {
      const [named] = await tx.select({ id: collaborationGrants.id }).from(collaborationGrants).where(eq(collaborationGrants.id, parsed.grant_id)).limit(1);
      throw new MissionError(named ? "conflict" : "token_hash_conflict");
    }
    if (row.tokenHash !== participantHash) throw new MissionError("invalid_state");
    return { grant: view(row), token_sha256: row.tokenHash, token_source: "participant" as const };
  });
}
export async function getMissionGrant(input: MissionGrantTarget, options: MissionOptions = {}) {
  ids(input.projectId, input.missionId, input.grantId);
  return (options.database ?? db).transaction(async tx => {
    const [row] = await tx.select().from(collaborationGrants).where(and(eq(collaborationGrants.id, input.grantId), eq(collaborationGrants.missionId, input.missionId), eq(collaborationGrants.projectId, input.projectId))).limit(1);
    if (!row) throw new MissionError("not_found");
    return chainView(tx, row);
  });
}
/** Revocation deliberately works for expired grants and retired subjects. Revoking any
 * member of a renewal chain ends every member, including descendants the issuer never saw. */
export async function revokeMissionGrant(input: MissionGrantTarget, options: MissionOptions = {}) {
  ids(input.projectId, input.missionId, input.grantId);
  return (options.database ?? db).transaction(async tx => {
    if (!await lockMission(tx, input, "share")) throw new MissionError("not_found");
    const target = and(eq(collaborationGrants.id, input.grantId), eq(collaborationGrants.missionId, input.missionId), eq(collaborationGrants.projectId, input.projectId));
    // renewal_root_id is immutable, so this unlocked read safely chooses the lock path.
    const [found] = await tx.select().from(collaborationGrants).where(target).limit(1);
    if (!found) throw new MissionError("not_found");
    if (found.renewalRootId === null) {
      const [row] = await tx.select().from(collaborationGrants).where(target).for("update").limit(1);
      if (!row) throw new MissionError("not_found");
      if (row.revokedAt) return grantMetadata(row);
      const now = instant(options);
      if (now < row.issuedAt) throw new MissionError("invalid_state");
      const [updated] = await tx.update(collaborationGrants).set({ revokedAt: now }).where(target).returning();
      return grantMetadata(updated);
    }
    // No early return: an expired, left or already revoked member still ends live descendants.
    await lockChain(tx, input, found.renewalRootId, found.id);
    const ended = await endChain(tx, input, found.renewalRootId, instant(options));
    const row = ended.find(member => member.id === found.id);
    if (!row) throw new MissionError("invalid_state");
    return chainView(tx, row);
  }, CHAIN_ISOLATION);
}
/** Close a chain's renewal window once, through any member. Revokes nothing: live
 * members run out. Monotone; new authority is a fresh administrator grant. */
export async function closeMissionGrantRenewal(input: MissionGrantTarget, options: MissionOptions = {}) {
  ids(input.projectId, input.missionId, input.grantId);
  return (options.database ?? db).transaction(async tx => {
    if (!await lockMission(tx, input, "share")) throw new MissionError("not_found");
    const [found] = await tx.select().from(collaborationGrants).where(grantKey(input, input.grantId)).limit(1);
    if (!found) throw new MissionError("not_found");
    // Idempotent no-op, so the hub can close everything it knows when it pauses a member.
    if (found.renewalRootId === null) return grantMetadata(found);
    await lockChain(tx, input, found.renewalRootId);
    const now = instant(options);
    const closed = await tx.update(collaborationGrants).set({ renewalClosedAt: sql`COALESCE(${collaborationGrants.renewalClosedAt}, ${stampAt(now)})` })
      .where(chainKey(input, found.renewalRootId)).returning();
    const row = closed.find(member => member.id === found.id);
    if (!row) throw new MissionError("invalid_state");
    return chainView(tx, row);
  }, CHAIN_ISOLATION);
}
export async function revokeMission(input: MissionTarget, options: MissionOptions = {}) {
  ids(input.projectId, input.missionId);
  return (options.database ?? db).transaction(async tx => {
    const row = await lockMission(tx, input, "update");
    if (!row) throw new MissionError("not_found");
    if (row.revokedAt) return missionMetadata(row);
    const now = instant(options);
    if (now < row.createdAt) throw new MissionError("invalid_state");
    const [updated] = await tx.update(collaborationMissions).set({ revokedAt: now }).where(eq(collaborationMissions.id, row.id)).returning();
    return missionMetadata(updated);
  });
}

/** Every operation independently resolves its closed route/action and verifies live authority. */
export async function executeMissionRequest(input: MissionRequest, options: MissionOptions = {}): Promise<{ created: boolean; data: Record<string, unknown> }> {
  const selected = missionOperation(input);
  const deny = () => new MissionError("invalid_credential");
  if (typeof input.token !== "string" || !/^atcm_[A-Za-z0-9_-]{43}$/.test(input.token)
    || Buffer.from(input.token.slice(5), "base64url").toString("base64url") !== input.token.slice(5)
    || !validMissionOrigin(input.origin) || !input.proof
    || ![input.proof.grantId, input.proof.identityId, input.proof.keyId].every(value => missionUuidSchema.safeParse(value).success)) throw deny();
  const tokenHash = missionSha256(input.token);
  const leaving = selected.operation === "leave";
  const body = input.method === "POST" && !leaving ? await parseMissionBody(input.bodyBytes) : null;
  const acceptance = selected.operation === "accept" ? parseMissionInput(missionAcceptSchema, body) : null;
  const observation = selected.operation === "observe" ? parseMissionInput(missionObservationSchema, body) : null;
  const renewal = selected.operation === "renew" ? parseMissionInput(missionRenewSchema, body) : null;
  // A successor needs its own identifier and a fresh token: never the presented one.
  if (renewal && renewal.grant_id === input.proof.grantId) throw new MissionError("invalid_request");
  if (renewal && renewal.token_sha256 === tokenHash) throw new MissionError("token_hash_conflict");
  return (options.database ?? db).transaction(async tx => {
    // Lookup only locates the immutable binding. Its state is re-read under lock.
    const [hint] = await tx.select().from(collaborationGrants).where(eq(collaborationGrants.tokenHash, tokenHash)).limit(1);
    if (!hint || hint.id !== input.proof.grantId || hint.missionId !== input.missionId
      || hint.identityId !== input.proof.identityId || hint.signingKeyId !== input.proof.keyId) throw deny();
    const key = await lockSubject(tx, hint.projectId, hint.identityId, hint.signingKeyId);
    const parent = await lockParent(tx, hint.projectId, hint.issuingApiKeyId);
    const scope = { projectId: hint.projectId, missionId: hint.missionId };
    const mission = await lockMission(tx, scope, selected.operation === "observe" ? "update" : "share");
    // Chain writers lock the root first (its id is immutable in the hint); every other path locks one grant.
    let root: GrantRow | undefined, grant: GrantRow | undefined;
    if ((renewal || leaving) && hint.renewalRootId !== null) ({ root, member: grant } = await lockChain(tx, scope, hint.renewalRootId, hint.id));
    else [grant] = await tx.select().from(collaborationGrants).where(eq(collaborationGrants.id, hint.id))
      .for(selected.operation === "accept" || leaving ? "update" : "share").limit(1);
    // Sample time after every potentially blocking authority lock.
    const now = instant(options);
    // Only an exact repeat of this participant's own leave may see a revoked grant.
    if (!grant || !validGrantState(grant, now) || !/^[0-9a-f]{64}$/.test(grant.tokenHash)
      || !timingSafeEqual(Buffer.from(tokenHash, "hex"), Buffer.from(grant.tokenHash, "hex"))
      || grant.projectId !== hint.projectId || grant.missionId !== hint.missionId || grant.issuingApiKeyId !== hint.issuingApiKeyId
      || grant.identityId !== hint.identityId || grant.signingKeyId !== hint.signingKeyId || grant.origin !== input.origin
      || grant.renewalRootId !== hint.renewalRootId || grant.renewedFromGrantId !== hint.renewedFromGrantId
      || (grant.revokedAt !== null && !(leaving && participantLeft(grant))) || grant.issuedAt > now || grant.expiresAt <= now
      || !activeMission(mission, now) || grant.expiresAt > mission.expiresAt
      || !parentValid(parent, grant.projectId, now, grant.expiresAt) || !verifyMissionProof(input, key.publicKey, now)) throw deny();
    const missionView = missionMetadata(mission);
    if (selected.operation === "invitation") return { created: false, data: { mission: missionView, grant: await chainView(tx, grant) } };
    if (leaving) {
      // Membership begins at acceptance; an unaccepted invitation is simply left to expire.
      if (!grant.acceptedAt || !grant.acceptanceProof) throw new MissionError("acceptance_required");
      if (grant.revokedAt) {
        // A repeat still ends the rest of the chain: code at a99257ab (a rollback, or an old
        // Machine mid-rollout) leaves one row and nothing else. Already ended, this writes nothing new.
        if (grant.renewalRootId !== null) await leaveChain(tx, scope, grant, grant.renewalRootId, now);
        return { created: false, data: leaveView(grant) };
      }
      const record = { ...grant.acceptanceProof, [MISSION_LEAVE_FIELD]: { reason: MISSION_LEAVE_REASON, ...proofRecord(input, key.publicKey) } };
      const [left] = await tx.update(collaborationGrants).set({ revokedAt: now, acceptanceProof: record })
        .where(and(eq(collaborationGrants.id, grant.id), isNull(collaborationGrants.revokedAt))).returning();
      if (!left || !participantLeft(left)) throw new MissionError("invalid_state");
      if (grant.renewalRootId !== null) await leaveChain(tx, scope, left, grant.renewalRootId, now);
      return { created: true, data: leaveView(left) };
    }
    if (acceptance) {
      if (acceptance.mission_digest !== mission.digest) throw new MissionError("conflict");
      if (grant.acceptedAt) return { created: false, data: { mission: missionView, grant: await chainView(tx, grant) } };
      const [accepted] = await tx.update(collaborationGrants).set({ acceptedAt: now, acceptanceProof: proofRecord(input, key.publicKey) }).where(eq(collaborationGrants.id, grant.id)).returning();
      return { created: true, data: { mission: missionView, grant: await chainView(tx, accepted) } };
    }
    if (renewal) {
      // Any accepted action set may renew; actions are copied, never widened.
      if (!root) throw new MissionError("renewal_unavailable");
      if (!grant.acceptedAt) throw new MissionError("acceptance_required");
      if (renewal.mission_digest !== mission.digest) throw new MissionError("conflict");
      const issued = (child: GrantRow, view: GrantView) => ({ mission: missionView, grant: view, token_sha256: child.tokenHash, token_source: "participant" as const });
      // An exact retry (same successor, hash and body bytes; fresh proof) returns the stored
      // child, before the window check, while G itself is live and unrevoked.
      const [existing] = await tx.select().from(collaborationGrants).where(eq(collaborationGrants.renewedFromGrantId, grant.id)).limit(1);
      if (existing) {
        if (existing.id !== renewal.grant_id || existing.tokenHash !== renewal.token_sha256
          || existing.acceptanceProof?.body_sha256 !== missionSha256(input.bodyBytes)) throw new MissionError("conflict");
        return { created: false, data: issued(existing, await chainView(tx, existing)) };
      }
      // Final refusals come before the one transient refusal (renewal_not_due), so a caller that
      // retries only on not_due never retries a chain that can no longer extend.
      if (grant.renewableUntil === null) throw new MissionError("renewal_unavailable");
      if (grant.renewalClosedAt !== null || root.renewalClosedAt !== null) throw new MissionError("renewal_closed");
      // The fixed bounds (window, mission end, issuing key expiry) no longer reach past G.
      const fixedCeiling = Math.min(grant.renewableUntil.getTime(), mission.expiresAt.getTime(), parent?.expiresAt?.getTime() ?? Infinity);
      if (now >= grant.renewableUntil || fixedCeiling <= grant.expiresAt.getTime()) throw new MissionError("renewal_window_ended");
      // New code ends a chain whole. Code at a99257ab (a rollback, or an old Machine during a
      // rolling deploy) revokes or leaves one row and leaves the window open: any revoked
      // member still ends renewal, so a kick through the only id an administrator knows holds.
      const [ended] = await tx.select({ id: collaborationGrants.id }).from(collaborationGrants)
        .where(and(chainKey(scope, root.id), isNotNull(collaborationGrants.revokedAt))).limit(1);
      if (ended) throw new MissionError("renewal_closed");
      const opensAt = grant.issuedAt.getTime() + Math.floor((grant.expiresAt.getTime() - grant.issuedAt.getTime()) / 2);
      if (now.getTime() < opensAt) throw new MissionError("renewal_not_due");
      const ceiling = Math.min(now.getTime() + (root.expiresAt.getTime() - root.issuedAt.getTime()), fixedCeiling);
      // Unreachable once halfway (now + root lifetime then passes G's expiry); kept as a guard.
      if (ceiling <= grant.expiresAt.getTime()) throw new MissionError("renewal_window_ended");
      // Born accepted: the signed body names the same immutable digest with the same enrolled key.
      // signed_grant_id lets the stored proof be re-verified on its own.
      const [child] = await tx.insert(collaborationGrants).values({ id: renewal.grant_id, projectId: grant.projectId, missionId: grant.missionId,
        identityId: grant.identityId, signingKeyId: grant.signingKeyId, issuingApiKeyId: grant.issuingApiKeyId, tokenHash: renewal.token_sha256,
        origin: grant.origin, actions: [...grant.actions], issuedAt: now, expiresAt: new Date(ceiling), acceptedAt: now,
        acceptanceProof: { ...proofRecord(input, key.publicKey), signed_grant_id: grant.id }, revokedAt: null,
        renewableUntil: grant.renewableUntil, renewalClosedAt: null, renewalRootId: grant.renewalRootId, renewedFromGrantId: grant.id,
      }).onConflictDoNothing().returning();
      if (!child) {
        const [named] = await tx.select({ id: collaborationGrants.id }).from(collaborationGrants).where(eq(collaborationGrants.id, renewal.grant_id)).limit(1);
        throw new MissionError(named ? "conflict" : "token_hash_conflict");
      }
      if (child.tokenHash !== renewal.token_sha256) throw new MissionError("invalid_state");
      return { created: true, data: issued(child, renewalMetadata(child, null)) };
    }
    const action = selected.operation === "observe" ? "mission.observe" : "mission.read";
    if (!grant.actions.includes(action)) throw deny();
    if (!grant.acceptedAt) throw new MissionError("acceptance_required");
    if (selected.operation === "context") return { created: false, data: { mission: missionView, grant: await chainView(tx, grant) } };
    if (selected.operation === "list") {
      if (selected.after > mission.lastReceiptSeq) throw new MissionError("invalid_request");
      const rows = await tx.select().from(collaborationEvents).where(and(eq(collaborationEvents.missionId, mission.id), eq(collaborationEvents.projectId, mission.projectId), gt(collaborationEvents.receiptSeq, selected.after)))
        .orderBy(asc(collaborationEvents.receiptSeq)).limit(selected.limit + 1);
      const visible = rows.slice(0, selected.limit);
      return { created: false, data: packMissionEventPage(mission.id, selected.after.toString(), visible.map(eventMetadata), rows.length > selected.limit) };
    }
    if (!observation) throw new MissionError("invalid_request");
    const rawBody = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input.bodyBytes), bodyDigest = missionSha256(input.bodyBytes);
    const [existing] = await tx.select().from(collaborationEvents).where(and(eq(collaborationEvents.missionId, mission.id), eq(collaborationEvents.eventId, observation.event_id))).limit(1);
    if (existing) {
      if (existing.identityId !== grant.identityId || existing.signingKeyId !== grant.signingKeyId
        || existing.bodyDigest !== bodyDigest || existing.rawBody !== rawBody) throw new MissionError("conflict");
      // Renewal replaces the grant every half-life, so an exact retry may come from a later
      // member of the same chain (renewal_root_id is immutable). Any other grant conflicts.
      if (existing.grantId !== grant.id) {
        const [sender] = grant.renewalRootId === null ? [] : await tx.select({ rootId: collaborationGrants.renewalRootId })
          .from(collaborationGrants).where(grantKey(scope, existing.grantId)).limit(1);
        if (!sender || sender.rootId !== grant.renewalRootId) throw new MissionError("conflict");
      }
      return { created: false, data: { event: eventMetadata(existing) } };
    }
    if (mission.lastReceiptSeq >= 9_223_372_036_854_775_807n) throw new MissionError("invalid_state");
    const receiptSeq = mission.lastReceiptSeq + 1n;
    const [inserted] = await tx.insert(collaborationEvents).values({ missionId: mission.id, projectId: mission.projectId,
      eventId: observation.event_id, grantId: grant.id, identityId: grant.identityId, signingKeyId: grant.signingKeyId,
      receiptSeq, rawBody, bodyDigest, observation, proof: proofRecord(input, key.publicKey), receivedAt: now }).returning();
    await tx.update(collaborationMissions).set({ lastReceiptSeq: receiptSeq }).where(eq(collaborationMissions.id, mission.id));
    return { created: true, data: { event: eventMetadata(inserted) } };
  }, CHAIN_ISOLATION);
}
