/** Pairing codes for enrollment. Doctrine: docs/IDENTITY-PAIRING.md.
 *
 * The administrator opens a pairing and shares its short code with the joining
 * device by voice or screen. The device posts its ordinary enroll-proof under the
 * code, with no bearer, plus a locally generated pickup secret. The server
 * verifies that proof with the same function enrollment uses, then holds it. The
 * administrator types the enrollment key fingerprint the device displays; only a
 * match runs the ordinary enrollment, judging proof freshness at receipt. If the
 * administrator attached a mission grant, the device collects it with the pickup
 * secret. The device generates its own mission token (client token-new) and sends
 * only its SHA-256; the grant is issued once, at first pickup, for that hash, and
 * the device assembles its invitation locally. Pairing and issuance handle only the
 * hash and a token-free template (the device presents its token later, when it
 * authenticates mission requests); a lost response is re-delivered identically.
 *
 * Guards:
 * - the code is 40 random bits, one-time, and lives 10 minutes; only an HMAC
 *   under PAIRING_CODE_SECRET is stored, so a database read cannot recover it;
 * - claim always verifies the proof before looking the code up, and every claim
 *   failure is the same 404, so a junk proof cannot reveal which codes are live;
 * - the held fingerprint is never shown to the administrator: they must type
 *   what the device shows, so nothing is enrolled without a real comparison;
 * - deadlines and authority are judged on a clock sampled after row locks; only
 *   enroll-proof freshness uses the time the claim was received. */
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import { collaborationGrants, collaborationMissions } from "../../db/schema/collaboration";
import { identities, identityKeys, identityPairings } from "../../db/schema/identity";
import { apiKeys } from "../../db/schema/tools";
import { getMission, issueMissionGrant, MissionError, revokeMissionGrant } from "../collaboration/store";
import { enrollIdentity, IdentityEnrollmentError, verifyEnrollmentProof, type IdentityEnrollment } from "./enrollment";

export const PAIRING_TTL_MS = 10 * 60_000;
export const PAIRING_PICKUP_WINDOW_MS = 10 * 60_000;
export const PAIRING_MAX_ACTIVE_PER_PROJECT = 10;
export const PAIRING_RETENTION_MS = 7 * 86_400_000;
export const PAIRING_PURGE_BATCH = 100;
export const PAIRING_HANDOFF_MAX_BYTES = 8192;
const MISSION_ACTIONS = ["mission.read", "mission.observe"] as const;
type MissionAction = typeof MISSION_ACTIONS[number];
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PICKUP = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_SHA256 = /^[0-9a-f]{64}$/;

type PairingErrorCode = "invalid_request" | "not_found" | "fingerprint_mismatch" | "not_claimed"
  | "limit_reached" | "grant_unavailable" | "not_configured";
const STATUS: Record<PairingErrorCode, 400 | 404 | 409 | 503> = {
  invalid_request: 400, not_found: 404, fingerprint_mismatch: 409, not_claimed: 409,
  limit_reached: 409, grant_unavailable: 409, not_configured: 503,
};
export class PairingError extends Error {
  readonly status: 400 | 404 | 409 | 503;
  constructor(readonly code: PairingErrorCode) { super(`identity_pairing_${code}`); this.status = STATUS[code]; }
}
export interface PairingOptions { database?: typeof db; now?: () => Date; secret?: Uint8Array }
export interface PairingGrantSpec { mission_id: string; actions: MissionAction[]; ttl_seconds: number }
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const clock = (o: PairingOptions) => (o.now ?? (() => new Date()))();
const database = (o: PairingOptions) => o.database ?? db;
/** Services below re-sample this clock after their own locks. */
const nested = (tx: Tx, o: PairingOptions) => ({ database: tx as unknown as typeof db, now: () => clock(o) });
const sha256hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const sameHex = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));

/** PAIRING_CODE_SECRET: canonical base64 of at least 32 bytes. Anything else: pairing is off. */
function secret(o: PairingOptions): Uint8Array {
  if (o.secret) { if (o.secret.length < 32) throw new PairingError("not_configured"); return o.secret; }
  const text = (process.env.PAIRING_CODE_SECRET ?? "").trim(), key = Buffer.from(text, "base64"), canonical = key.toString("base64");
  if (key.length < 32 || (text !== canonical && text !== canonical.replace(/=+$/, ""))) throw new PairingError("not_configured");
  return key;
}
function base32(bytes: Uint8Array, chars: number): string {
  let bits = 0, value = 0, out = "";
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff; bits += 8;
    while (bits >= 5 && out.length < chars) { out += CROCKFORD[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return out;
}
/** Case, spaces and dashes ignored; I/L read as 1, O as 0. */
const crockford = (input: string) => String(input).toUpperCase().replace(/[\s-]/g, "").replace(/[IL]/g, "1").replace(/O/g, "0");
/** 8 Crockford base32 characters = 40 bits, shown as XXXX-XXXX. */
export function newPairingCode(): string {
  const raw = base32(randomBytes(5), 8);
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}
export function normalizePairingCode(input: string): string | null {
  const s = crockford(input);
  return /^[0-9A-HJKMNP-TV-Z]{8}$/.test(s) ? s : null;
}
const codeHmac = (normalized: string, o: PairingOptions) =>
  createHmac("sha256", secret(o)).update(`agenttool-pairing-code/v1\0${normalized}`).digest("hex");
/** Human-comparable fingerprint of the enrollment root key: 80 bits as XXXX-XXXX-XXXX-XXXX. */
export function enrollmentFingerprint(publicKeyBase64: string): string {
  const raw = base32(createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest().subarray(0, 10), 16);
  return raw.match(/.{4}/g)!.join("-");
}
function parseGrantSpec(value: unknown): PairingGrantSpec | null {
  if (value === undefined || value === null) return null;
  const spec = value as Partial<PairingGrantSpec>;
  if (typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(k => !["mission_id", "actions", "ttl_seconds"].includes(k))
    || typeof spec.mission_id !== "string" || !UUID.test(spec.mission_id)
    || !Array.isArray(spec.actions) || !spec.actions.length || new Set(spec.actions).size !== spec.actions.length
    || !spec.actions.every(a => (MISSION_ACTIONS as readonly unknown[]).includes(a))
    || !Number.isInteger(spec.ttl_seconds) || spec.ttl_seconds! < 60 || spec.ttl_seconds! > 86_400) throw new PairingError("invalid_request");
  return { mission_id: spec.mission_id, actions: [...spec.actions].sort(), ttl_seconds: spec.ttl_seconds! };
}
/** Public data the administrator hands to the device (e.g. chat pins). Never interpreted. */
function parseHandoff(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new PairingError("invalid_request");
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text, "utf8") > PAIRING_HANDOFF_MAX_BYTES) throw new PairingError("invalid_request");
  return text;
}

export async function createPairing(input: { projectId: string; apiKeyId: string }, options: PairingOptions = {}) {
  if (!UUID.test(input.projectId) || !UUID.test(input.apiKeyId)) throw new PairingError("invalid_request");
  const code = newPairingCode(), codeKey = codeHmac(normalizePairingCode(code)!, options);
  // Opportunistic, bounded retention: old rows go when someone opens a pairing.
  // Its own statement, so a refused create below cannot roll the purge back.
  const cutoff = new Date(clock(options).getTime() - PAIRING_RETENTION_MS);
  await database(options).execute(sql`DELETE FROM identity.pairings WHERE id IN (SELECT id FROM identity.pairings
    WHERE expires_at < ${cutoff.toISOString()}::timestamptz ORDER BY expires_at LIMIT ${PAIRING_PURGE_BATCH})`);
  return database(options).transaction(async tx => {
    // Serialises count + insert per project; an empty set of rows has nothing to lock.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`identity.pairings:${input.projectId}`}, 0))`);
    const now = clock(options);
    const [{ active }] = await tx.select({ active: sql<number>`count(*)::int` }).from(identityPairings)
      .where(and(eq(identityPairings.projectId, input.projectId), inArray(identityPairings.status, ["open", "claimed"]), gt(identityPairings.expiresAt, now)));
    if (active >= PAIRING_MAX_ACTIVE_PER_PROJECT) throw new PairingError("limit_reached");
    const [row] = await tx.insert(identityPairings).values({
      projectId: input.projectId, createdByApiKeyId: input.apiKeyId, codeHmac: codeKey,
      createdAt: now, expiresAt: new Date(now.getTime() + PAIRING_TTL_MS),
    }).returning({ id: identityPairings.id, expiresAt: identityPairings.expiresAt });
    return { pairing_id: row.id, code, expires_at: row.expiresAt.toISOString() };
  });
}

/** Unauthenticated: the joining device posts its exact enroll-proof under a code.
 * Retrying with the same pickup secret returns the same pairing (lost responses). */
export async function claimPairing(input: { code: string; pickup: string; origin: string; bodyBytes: Uint8Array; signature: string }, options: PairingOptions = {}) {
  if (typeof input.pickup !== "string" || !PICKUP.test(input.pickup)) throw new PairingError("invalid_request");
  const receivedAt = clock(options), normalized = normalizePairingCode(input.code);
  const codeKey = codeHmac(normalized ?? "-", options), pickupHash = sha256hex(input.pickup);
  // Verify first, against the project the body names, whatever the code: the
  // outcome cannot then reveal whether a code is live.
  let body: IdentityEnrollment | null = null;
  try {
    const named = JSON.parse(Buffer.from(input.bodyBytes).toString("utf8"))?.project_id;
    if (typeof named === "string") body = await verifyEnrollmentProof({ projectId: named, origin: input.origin, bodyBytes: input.bodyBytes, signature: input.signature }, receivedAt);
  } catch (error) { if (!(error instanceof IdentityEnrollmentError) && !(error instanceof SyntaxError)) throw error; }
  return database(options).transaction(async tx => {
    const [p] = normalized ? await tx.select().from(identityPairings).where(eq(identityPairings.codeHmac, codeKey)).for("update").limit(1) : [];
    const now = clock(options);
    if (p?.pickupSha256 && sameHex(p.pickupSha256, pickupHash) && (p.status === "claimed" ? p.expiresAt > now
      : p.status === "confirmed" && now.getTime() < p.confirmedAt!.getTime() + PAIRING_PICKUP_WINDOW_MS)) {
      return { pairing_id: p.id, status: p.status as "claimed" | "confirmed", expires_at: p.expiresAt.toISOString() };
    }
    if (!body || !p || p.status !== "open" || p.expiresAt <= now || p.projectId !== body.project_id) throw new PairingError("not_found");
    await tx.update(identityPairings).set({
      status: "claimed", claimedAt: receivedAt, claimBody: Buffer.from(input.bodyBytes).toString("base64"), claimSignature: input.signature,
      fingerprint: enrollmentFingerprint(body.public_key), identityId: body.identity_id, signingKeyId: body.signing_key_id,
      displayName: body.display_name, publicKey: body.public_key, pickupSha256: pickupHash,
    }).where(eq(identityPairings.id, p.id));
    return { pairing_id: p.id, status: "claimed" as const, expires_at: p.expiresAt.toISOString() };
  });
}

/** Administrator view. Deliberately omits the held fingerprint (see confirmPairing). */
export async function getPairing(input: { projectId: string; pairingId: string }, options: PairingOptions = {}) {
  if (!UUID.test(input.pairingId)) throw new PairingError("not_found");
  const [p] = await database(options).select().from(identityPairings)
    .where(and(eq(identityPairings.id, input.pairingId), eq(identityPairings.projectId, input.projectId))).limit(1);
  if (!p) throw new PairingError("not_found");
  const expired = (p.status === "open" || p.status === "claimed") && p.expiresAt <= clock(options);
  return {
    pairing_id: p.id, status: expired ? "expired" : p.status, expires_at: p.expiresAt.toISOString(),
    ...(p.claimedAt ? { claimed_at: p.claimedAt.toISOString(), identity_id: p.identityId, signing_key_id: p.signingKeyId, display_name: p.displayName } : {}),
    ...(p.confirmedAt ? { confirmed_at: p.confirmedAt.toISOString(), pickup_until: new Date(p.confirmedAt.getTime() + PAIRING_PICKUP_WINDOW_MS).toISOString() } : {}),
    ...(p.grantMissionId ? { grant: { mission_id: p.grantMissionId, actions: p.grantActions, ttl_seconds: p.grantTtlSeconds, grant_id: p.grantId } } : {}),
    handoff: p.handoff !== null,
  };
}

/** Authenticated: the administrator types the fingerprint the device displays. */
export async function confirmPairing(input: {
  projectId: string; apiKeyId: string; pairingId: string; fingerprint: string; origin: string; grant?: unknown; handoff?: unknown;
}, options: PairingOptions = {}) {
  if (!UUID.test(input.pairingId)) throw new PairingError("not_found");
  if (typeof input.fingerprint !== "string") throw new PairingError("invalid_request");
  const grant = parseGrantSpec(input.grant), handoff = parseHandoff(input.handoff);
  return database(options).transaction(async tx => {
    const [p] = await tx.select().from(identityPairings)
      .where(and(eq(identityPairings.id, input.pairingId), eq(identityPairings.projectId, input.projectId))).for("update").limit(1);
    const now = clock(options);
    if (!p) throw new PairingError("not_found");
    if (p.status !== "claimed" || p.expiresAt <= now) throw new PairingError("not_claimed");
    const typed = Buffer.from(crockford(input.fingerprint)), held = Buffer.from(p.fingerprint!.replace(/-/g, ""));
    if (typed.length !== held.length || !timingSafeEqual(typed, held)) throw new PairingError("fingerprint_mismatch");
    if (grant) {
      const mission = await getMission({ projectId: p.projectId, missionId: grant.mission_id }, nested(tx, options))
        .catch(error => { if (error instanceof MissionError) throw new PairingError("invalid_request"); throw error; });
      if (mission.revoked_at || new Date(mission.expires_at) <= clock(options)) throw new PairingError("invalid_request");
    }
    const enrolled = await enrollIdentity({
      projectId: p.projectId, issuerApiKeyId: input.apiKeyId, origin: input.origin,
      bodyBytes: Buffer.from(p.claimBody!, "base64"), signature: p.claimSignature!,
    }, { ...nested(tx, options), proofReceivedAt: p.claimedAt! });
    const confirmedAt = clock(options);
    // Enrollment may have waited on the administrator key's lock; the pairing deadline
    // still holds afterwards. Throwing here rolls the enrollment back with it.
    if (p.expiresAt <= confirmedAt) throw new PairingError("not_claimed");
    // The registration proof now lives with the identity; the raw claim is no longer needed.
    await tx.update(identityPairings).set({
      status: "confirmed", confirmedAt, confirmedByApiKeyId: input.apiKeyId, claimBody: null, claimSignature: null, handoff,
      ...(grant ? { grantMissionId: grant.mission_id, grantActions: grant.actions, grantTtlSeconds: grant.ttl_seconds } : {}),
    }).where(eq(identityPairings.id, p.id));
    return { pairing_id: p.id, ...enrolled, pickup_until: new Date(confirmedAt.getTime() + PAIRING_PICKUP_WINDOW_MS).toISOString(),
      ...(grant ? { grant } : {}) };
  });
}

/** Unauthenticated, pickup-secret bound. Pending until confirmed; then the one grant,
 * issued at first pickup for the device's own token hash and re-delivered as the same
 * token-free template while it stays valid. */
export async function pickupPairing(input: { pairingId: string; pickup: string; tokenSha256?: string; origin: string }, options: PairingOptions = {}) {
  if (typeof input.pairingId !== "string" || !UUID.test(input.pairingId) || typeof input.pickup !== "string" || !PICKUP.test(input.pickup)) throw new PairingError("not_found");
  const presented = sha256hex(input.pickup);
  return database(options).transaction(async tx => {
    const [p] = await tx.select().from(identityPairings).where(eq(identityPairings.id, input.pairingId)).for("update").limit(1);
    const now = clock(options);
    if (!p?.pickupSha256 || !sameHex(presented, p.pickupSha256)) throw new PairingError("not_found");
    if (p.status === "claimed" && p.expiresAt > now) return { status: "pending" as const, expires_at: p.expiresAt.toISOString() };
    if (p.status !== "confirmed" || now.getTime() >= p.confirmedAt!.getTime() + PAIRING_PICKUP_WINDOW_MS) throw new PairingError("not_found");
    const handoff = p.handoff === null ? {} : { handoff: JSON.parse(p.handoff) as Record<string, unknown> };
    const enrolled = { pairing_id: p.id, identity_id: p.identityId!, signing_key_id: p.signingKeyId!, ...handoff };
    if (!p.grantMissionId) return { status: "enrolled" as const, ...enrolled };
    if (typeof input.tokenSha256 !== "string" || !TOKEN_SHA256.test(input.tokenSha256)) throw new PairingError("invalid_request");
    let grantId = p.grantId, expiresAt: Date, origin = input.origin;
    if (grantId) {
      // Re-delivery: same grant, same hash; never re-issue, extend or resurrect a revoked grant,
      // and never hand over a credential whose mission, issuer, identity or key has gone. The
      // immutable binding locates the rows; they are then re-read under store.ts's lock order
      // (identity → signing key → issuing key → mission → grant) and judged at live time.
      const [hint] = await tx.select({ projectId: collaborationGrants.projectId, missionId: collaborationGrants.missionId,
        identityId: collaborationGrants.identityId, signingKeyId: collaborationGrants.signingKeyId, issuingApiKeyId: collaborationGrants.issuingApiKeyId })
        .from(collaborationGrants).where(eq(collaborationGrants.id, grantId)).limit(1);
      if (!hint) throw new PairingError("grant_unavailable");
      const [subject] = await tx.select({ status: identities.status }).from(identities)
        .where(and(eq(identities.id, hint.identityId), eq(identities.projectId, hint.projectId))).for("share").limit(1);
      const [key] = await tx.select({ active: identityKeys.active, revokedAt: identityKeys.revokedAt }).from(identityKeys)
        .where(and(eq(identityKeys.id, hint.signingKeyId), eq(identityKeys.identityId, hint.identityId))).for("share").limit(1);
      const [issuer] = await tx.select({ revokedAt: apiKeys.revokedAt, expiresAt: apiKeys.expiresAt }).from(apiKeys)
        .where(and(eq(apiKeys.id, hint.issuingApiKeyId), eq(apiKeys.projectId, hint.projectId))).for("share").limit(1);
      const [mission] = await tx.select({ revokedAt: collaborationMissions.revokedAt, expiresAt: collaborationMissions.expiresAt, createdAt: collaborationMissions.createdAt })
        .from(collaborationMissions).where(and(eq(collaborationMissions.id, hint.missionId), eq(collaborationMissions.projectId, hint.projectId))).for("share").limit(1);
      const [g] = await tx.select().from(collaborationGrants).where(eq(collaborationGrants.id, grantId)).for("share").limit(1);
      const live = clock(options);
      if (live.getTime() >= p.confirmedAt!.getTime() + PAIRING_PICKUP_WINDOW_MS) throw new PairingError("not_found");
      if (!g || g.revokedAt !== null || !sameHex(g.tokenHash, input.tokenSha256) || g.expiresAt <= live
        || !mission || mission.revokedAt !== null || mission.expiresAt <= live || mission.createdAt > live
        || !issuer || issuer.revokedAt !== null || (issuer.expiresAt !== null && issuer.expiresAt <= live)
        || subject?.status !== "active" || !key?.active || key.revokedAt !== null) throw new PairingError("grant_unavailable");
      expiresAt = g.expiresAt; origin = g.origin;
    } else {
      grantId = randomUUID();
      try {
        const mission = await getMission({ projectId: p.projectId, missionId: p.grantMissionId }, nested(tx, options));
        const [issuer] = await tx.select({ expiresAt: apiKeys.expiresAt }).from(apiKeys).where(eq(apiKeys.id, p.confirmedByApiKeyId!)).limit(1);
        // The store refuses grants outliving the mission or the issuing key; clamp to both.
        const until = Math.min(clock(options).getTime() + p.grantTtlSeconds! * 1000, new Date(mission.expires_at).getTime(),
          issuer?.expiresAt ? issuer.expiresAt.getTime() : Infinity);
        const issued = await issueMissionGrant({
          projectId: p.projectId, missionId: p.grantMissionId, issuerApiKeyId: p.confirmedByApiKeyId!, grantId,
          identityId: p.identityId!, signingKeyId: p.signingKeyId!, origin: input.origin, actions: p.grantActions as MissionAction[],
          expiresAt: new Date(until).toISOString(), tokenSha256: input.tokenSha256,
        }, nested(tx, options));
        if (!sameHex(issued.token_sha256, input.tokenSha256)) throw new MissionError("invalid_state");
        expiresAt = new Date(issued.grant.expires_at);
        // Issuance may have waited on subject, issuer or mission locks; the pickup window still
        // holds afterwards. Throwing here rolls the new grant back with it.
        if (clock(options).getTime() >= p.confirmedAt!.getTime() + PAIRING_PICKUP_WINDOW_MS) throw new PairingError("not_found");
      } catch (error) {
        if (error instanceof MissionError) throw new PairingError("grant_unavailable");
        throw error;
      }
      await tx.update(identityPairings).set({ grantId }).where(eq(identityPairings.id, p.id));
    }
    // Exactly the client's invitation-template/v1 fields; `invitation-assemble` adds the local token.
    return { status: "invited" as const, ...enrolled, template: {
      format: "agenttool-mission-invitation-template/v1", origin, mission_id: p.grantMissionId, grant_id: grantId,
      identity_id: p.identityId!, signing_key_id: p.signingKeyId!, public_key: p.publicKey!, expires_at: expiresAt.toISOString(),
      token_sha256: input.tokenSha256,
    } };
  });
}

/** Open or claimed: closes it. Confirmed: stops pickup and revokes the minted grant;
 * the enrollment itself stands (retire the identity separately). */
export async function cancelPairing(input: { projectId: string; pairingId: string }, options: PairingOptions = {}) {
  if (!UUID.test(input.pairingId)) throw new PairingError("not_found");
  return database(options).transaction(async tx => {
    const [p] = await tx.select().from(identityPairings)
      .where(and(eq(identityPairings.id, input.pairingId), eq(identityPairings.projectId, input.projectId))).for("update").limit(1);
    if (!p || !["open", "claimed", "confirmed"].includes(p.status)) throw new PairingError("not_found");
    if (p.grantId && p.grantMissionId) await revokeMissionGrant({ projectId: p.projectId, missionId: p.grantMissionId, grantId: p.grantId }, nested(tx, options));
    await tx.update(identityPairings).set({ status: "cancelled", cancelledAt: clock(options), claimBody: null, claimSignature: null })
      .where(eq(identityPairings.id, p.id));
    return { pairing_id: p.id, status: "cancelled" as const, enrolled: p.status === "confirmed", revoked_grant_id: p.grantId };
  });
}
