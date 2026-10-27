/** Hermetic wire/proof boundaries and staged store transactions; durable races
 * and real constraints run in the explicit disposable PostgreSQL suite. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import * as ed from "@noble/ed25519";
import { getTableColumns, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { collaborationGrants } from "../src/db/schema/collaboration";
import { createMissionSchema, issueMissionGrantSchema, MISSION_BOUNDS, MissionError, missionDescriptorSchema, missionObservationSchema, missionOperation, packMissionEventPage, parseMissionBody, type MissionAction, type MissionRequest } from "../src/services/collaboration/contracts";
import { canonicalMissionRequestBytes, verifyMissionProof } from "../src/services/collaboration/proof";
import { closeMissionGrantRenewal, executeMissionRequest, getMissionGrant, issueMissionGrant, revokeMission, revokeMissionGrant } from "../src/services/collaboration/store";
import { correspondenceCanonicalJson } from "../src/services/correspondence/canonical";

const M = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333", K = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-28T09:00:00.000Z"), privateKey = new Uint8Array(32).fill(7);
const publicKey = Buffer.from(ed.getPublicKey(privateKey)).toString("base64");
const base = `/v1/collaboration/missions/${M}`;
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Review selected evidence", resources: [], acceptance_criteria: ["Return a bounded review"], principalities: [] };
const P = "55555555-5555-4555-8555-555555555555", A = "66666666-6666-4666-8666-666666666666";
const ORIGIN = "https://api.agenttool.dev", END = new Date(NOW.getTime() + 3_600_000);
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
// Synthetic participant token in the exact grant-token shape; never a real credential.
const PARTICIPANT_TOKEN = `atcm_${Buffer.alloc(32, 9).toString("base64url")}`, PARTICIPANT_HASH = sha256(PARTICIPANT_TOKEN);
const DIGEST = `sha256:${sha256(correspondenceCanonicalJson(descriptor))}`;
const missionRow = (overrides: Record<string, unknown> = {}) => ({ id: M, projectId: P, creatorApiKeyId: A, descriptor, digest: DIGEST,
  createdAt: new Date(NOW.getTime() - 60_000), expiresAt: new Date(NOW.getTime() + 86_400_000), revokedAt: null, lastReceiptSeq: 0n, ...overrides });
const identityRow = () => ({ id: I, projectId: P, status: "active" });
const keyRow = () => ({ id: K, identityId: I, publicKey, active: true, revokedAt: null });
const parentRow = () => ({ id: A, projectId: P, revokedAt: null, expiresAt: null });
const grantRow = (overrides: Record<string, unknown> = {}) => ({ id: G, projectId: P, missionId: M, identityId: I, signingKeyId: K,
  issuingApiKeyId: A, tokenHash: PARTICIPANT_HASH, origin: ORIGIN, actions: ["mission.observe", "mission.read"],
  issuedAt: new Date(NOW.getTime() - 60_000), expiresAt: END, acceptedAt: null, acceptanceProof: null, revokedAt: null,
  // Unchained: null in one place, so undefined never decides chain membership.
  renewableUntil: null, renewalClosedAt: null, renewalRootId: null, renewedFromGrantId: null, ...overrides });
const issueInput = (extra: { tokenSha256?: string; grantId?: string; renewableUntil?: string; expiresAt?: string } = {}) => ({ projectId: P, missionId: M, issuerApiKeyId: A, grantId: G,
  identityId: I, signingKeyId: K, origin: ORIGIN, actions: ["mission.read"] as MissionAction[], expiresAt: END.toISOString(), ...extra });

type Step = unknown[] | ((values: Record<string, unknown> | undefined) => unknown[]);
interface StagedEvent { operation: string; condition?: { sql: string; params: unknown[] }; lock?: string; values?: Record<string, unknown>; conflict?: "target" | "any" }
/** Replays one result per terminal query and records each query's shape. */
function staged(steps: Step[], now: Date = NOW) {
  const events: StagedEvent[] = [];
  const dialect = new PgDialect();
  let commits = 0, rollbacks = 0;
  const configs: unknown[] = [];
  function query(operation: string) {
    const event: StagedEvent = { operation };
    events.push(event);
    const step = steps[events.length - 1];
    const finish = async () => {
      if (step === undefined) throw new Error(`unexpected ${operation} query #${events.length}`);
      return typeof step === "function" ? step(event.values) : step;
    };
    const builder = {
      from: () => builder,
      where: (value: never) => { event.condition = dialect.sqlToQuery(value); return builder; },
      for: (lock: string) => { event.lock = lock; return builder; },
      orderBy: () => builder,
      limit: () => finish(),
      values: (values: Record<string, unknown>) => { event.values = values; return builder; },
      set: (values: Record<string, unknown>) => { event.values = values; return builder; },
      onConflictDoNothing: (config?: unknown) => { event.conflict = config === undefined ? "any" : "target"; return builder; },
      returning: () => finish(),
    };
    return builder;
  }
  const tx = { select: () => query("select"), insert: () => query("insert"), update: () => query("update") };
  const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>, config?: unknown) => {
    configs.push(config);
    try { const result = await fn(tx); commits++; return result; } catch (error) { rollbacks++; throw error; }
  } };
  return { events, options: { database: database as never, now }, commits: () => commits, rollbacks: () => rollbacks, configs };
}
const inserted: Step = values => [{ ...values }];
const issueSteps = (...tail: Step[]): Step[] => [[identityRow()], [keyRow()], [parentRow()], [missionRow()], ...tail];
async function refusal(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(MissionError);
  expect((error as MissionError).status as number).toBe(status);
  expect((error as MissionError).code).toBe(code);
}
function signed(token: string, method: "GET" | "POST", suffix: string, body = "", key = privateKey, proof: Partial<MissionRequest["proof"]> = {}): MissionRequest {
  const input: MissionRequest = { token, missionId: M, origin: ORIGIN, method, requestTarget: base + suffix, bodyBytes: Buffer.from(body),
    proof: { grantId: G, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "", ...proof } };
  input.proof.signature = Buffer.from(ed.sign(canonicalMissionRequestBytes(input), key)).toString("base64url");
  return input;
}
const ACCEPTANCE = { domain: "agenttool-collaboration-request/v1", origin: ORIGIN, method: "POST", request_target: `${base}/accept`,
  timestamp: new Date(NOW.getTime() - 30_000).toISOString(), signature: "synthetic-acceptance-signature", public_key: publicKey,
  raw_body: `{"mission_digest":"${DIGEST}"}`, body_sha256: sha256(`{"mission_digest":"${DIGEST}"}`) };
const acceptedRow = (overrides: Record<string, unknown> = {}) => grantRow({ acceptedAt: new Date(NOW.getTime() - 30_000), acceptanceProof: ACCEPTANCE, ...overrides });
const leftRow = () => acceptedRow({ revokedAt: new Date(NOW.getTime() - 1_000), acceptanceProof: { ...ACCEPTANCE,
  participant_leave: { reason: "participant_left", ...ACCEPTANCE, request_target: `${base}/leave`, raw_body: "", body_sha256: sha256("") } } });
/** One full participant admission: hint, identity, key, parent, mission, locked grant, then optional writes. */
const admissionSteps = (row: Record<string, unknown>, ...tail: Step[]): Step[] => [[row], [identityRow()], [keyRow()], [parentRow()], [missionRow()], [row], ...tail];
function request(): MissionRequest {
  const input: MissionRequest = { token: `atcm_${Buffer.alloc(32, 2).toString("base64url")}`, missionId: M,
    origin: "https://api.agenttool.dev", method: "POST", requestTarget: `${base}/events`,
    bodyBytes: Buffer.from(JSON.stringify({ event_id: M, summary: "Selected evidence" })),
    proof: { grantId: G, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" } };
  input.proof.signature = Buffer.from(ed.sign(canonicalMissionRequestBytes(input), privateKey)).toString("base64url");
  return input;
}

describe("mission proofs", () => {
  test("a registered key binds every request field independently of the broad project credential", () => {
    const input = request();
    expect(verifyMissionProof(input, publicKey, NOW)).toBe(true);
    const variants: MissionRequest[] = [
      { ...input, origin: "https://other.example" }, { ...input, method: "GET" },
      { ...input, requestTarget: `${base}/events?limit=1` }, { ...input, missionId: G },
      { ...input, bodyBytes: Buffer.from(`${Buffer.from(input.bodyBytes).toString()} `) },
      ...(["grantId", "identityId", "keyId"] as const).map(key => ({ ...input, proof: { ...input.proof, [key]: M } })),
      { ...input, proof: { ...input.proof, timestamp: new Date(NOW.getTime() + 1).toISOString() } },
      { ...input, proof: { ...input.proof, signature: input.proof.signature + "=" } },
    ];
    for (const variant of variants) expect(verifyMissionProof(variant, publicKey, NOW)).toBe(false);
    expect(verifyMissionProof(input, publicKey, new Date(NOW.getTime() + 300001))).toBe(false);
    expect(verifyMissionProof(input, publicKey, new Date(NOW.getTime() - 300001))).toBe(false);
    expect(verifyMissionProof(input, Buffer.alloc(32).toString("base64"), NOW)).toBe(false);
  });
  test("proof helper rejects ambiguous fields and does not require a global sequence", () => {
    const input = request();
    expect(() => canonicalMissionRequestBytes({ ...input, requestTarget: "/x\0y" })).toThrow();
    expect(() => canonicalMissionRequestBytes({ ...input, origin: "http://api.agenttool.dev" })).toThrow();
    expect(() => canonicalMissionRequestBytes({ ...input, proof: { ...input.proof, timestamp: "2026-09-28T09:00:00Z" } })).toThrow();
    expect(canonicalMissionRequestBytes(input).byteLength).toBe(32);
  });
});

test("closed service route map independently denies widening and ambiguous cursor spellings", () => {
  const input = { ...request(), method: "GET", bodyBytes: new Uint8Array() };
  expect(missionOperation({ ...input, requestTarget: `${base}/events?after=3&limit=50` })).toEqual({ operation: "list", after: 3n, limit: 50 });
  for (const suffix of ["/events/", "/events?", "/events?after=01", "/events?limit=0", "/events?limit=51", "/events?after=-1", "/events?after=9223372036854775808", "/events?after=0&after=1", "/events?limit=2&after=1", "/events?project_id=x", "/grants", "/revoke", "/%65vents"]) {
    expect(() => missionOperation({ ...input, requestTarget: base + suffix })).toThrow();
  }
  expect(() => missionOperation({ ...input, method: "HEAD", requestTarget: `${base}/context` })).toThrow();
  expect(() => missionOperation({ ...input, bodyBytes: new Uint8Array([1]), requestTarget: `${base}/context` })).toThrow();
});

test("immutable descriptor references and self-declared seats are closed and bounded", () => {
  expect(missionDescriptorSchema.safeParse(descriptor).success).toBe(true);
  expect(createMissionSchema.safeParse({ mission_id: M, descriptor, expires_at: "2026-02-30T00:00:00.000Z" }).success).toBe(false);
  for (const invalid of [{ ...descriptor, grants: ["*"] }, { ...descriptor, purpose: "" }, { ...descriptor, purpose: "x".repeat(2001) }, { ...descriptor, principalities: [{ uri: "https://example.test/principle", format: "text/markdown", digest: "mutable" }] }]) {
    expect(missionDescriptorSchema.safeParse(invalid).success).toBe(false);
  }
  expect(missionObservationSchema.safeParse({ event_id: M, summary: "🙂".repeat(1000), seat: { device_id: "declared device", session_id: "session", harness: "codex" } }).success).toBe(true);
  expect(missionObservationSchema.safeParse({ event_id: M, summary: "🙂".repeat(1001) }).success).toBe(false);
  expect(missionObservationSchema.safeParse({ event_id: M, summary: "\ud800" }).success).toBe(false);
});

test("raw JSON parsing rejects duplicate names, malformed UTF-8, NUL and oversize bodies", async () => {
  for (const body of [Buffer.from('{"summary":"a","summary":"b"}'), Buffer.from([0xff]), Buffer.from('{"summary":"\\u0000"}'), Buffer.alloc(8193, 32)]) {
    await expect(parseMissionBody(body)).rejects.toThrow();
  }
  expect(await parseMissionBody(Buffer.from('{"summary":"雨夜"}'))).toEqual({ summary: "雨夜" });
});

test("worst-size event pages preserve complete records and resume without omission", () => {
  const candidates = Array.from({ length: 50 }, (_, index) => ({ received_seq: String(index + 1), raw_body: "\\".repeat(8192),
    observation: { summary: "\u0001".repeat(1000) }, proof: { raw_body: "\\".repeat(8192) } }));
  const first = packMissionEventPage(M, "0", candidates, false);
  expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(MISSION_BOUNDS.responseBytes);
  expect(first.events.length).toBeGreaterThan(0); expect(first.events.length).toBeLessThan(50);
  expect(first.page.has_more).toBe(true); expect(first.page.next_cursor).toBe(String(first.events.length));
  const second = packMissionEventPage(M, first.page.next_cursor, candidates.slice(first.events.length), false);
  expect([...first.events, ...second.events]).toEqual(candidates);
  expect(second.page).toEqual({ after: first.page.next_cursor, next_cursor: "50", has_more: false });
});

describe("participant-chosen grant token hash", () => {
  test("a supplied hash is stored verbatim and the response carries no token", async () => {
    const s = staged(issueSteps(inserted));
    const result = await issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH }), s.options);
    expect(Object.keys(result).sort()).toEqual(["grant", "token_sha256", "token_source"]);
    expect(result).toMatchObject({ token_sha256: PARTICIPANT_HASH, token_source: "participant", grant: { grant_id: G, identity_id: I, signing_key_id: K } });
    expect("token" in result).toBe(false);
    expect(JSON.stringify(result)).not.toContain("atcm_");
    expect(s.events.map(e => [e.operation, e.lock])).toEqual([["select", "share"], ["select", "share"], ["select", "share"], ["select", "share"], ["insert", undefined]]);
    expect(s.events[4]).toMatchObject({ conflict: "any", values: { tokenHash: PARTICIPANT_HASH, id: G, acceptedAt: null, revokedAt: null } });
    expect(s.commits()).toBe(1);
  });

  test("the participant's own token then locates that grant through the unchanged gateway lookup", async () => {
    const stored = grantRow();
    const read = staged([[stored], [identityRow()], [keyRow()], [parentRow()], [missionRow()], [stored]]);
    const outcome = await executeMissionRequest(signed(PARTICIPANT_TOKEN, "GET", "/invitation"), read.options);
    expect(read.events[0].condition?.params).toEqual([PARTICIPANT_HASH]);
    expect(outcome).toMatchObject({ created: false, data: { grant: { grant_id: G }, mission: { mission_digest: DIGEST } } });
    // A different well-formed token does not match the stored participant hash.
    const other = `atcm_${Buffer.alloc(32, 10).toString("base64url")}`;
    const miss = staged([[]]);
    await refusal(executeMissionRequest(signed(other, "GET", "/invitation"), miss.options), 401, "collaboration_mission_invalid_credential");
    expect(miss.events[0].condition?.params).toEqual([sha256(other)]);
  });

  test("malformed hashes are refused before any authority or storage query", async () => {
    for (const bad of [PARTICIPANT_HASH.toUpperCase(), PARTICIPANT_HASH.slice(1), `${PARTICIPANT_HASH}0`, `sha256:${PARTICIPANT_HASH}`, "g".repeat(64), "", PARTICIPANT_TOKEN]) {
      const s = staged([]);
      await refusal(issueMissionGrant(issueInput({ tokenSha256: bad }), s.options), 400, "collaboration_mission_invalid_request");
      expect(s.events).toHaveLength(0);
      expect(issueMissionGrantSchema.safeParse({ grant_id: G, identity_id: I, signing_key_id: K, actions: ["mission.read"], expires_at: END.toISOString(), token_sha256: bad }).success).toBe(false);
    }
  });

  test("a hash already bound anywhere conflicts as token_hash_conflict; a known grant ID keeps its conflict", async () => {
    const taken = staged(issueSteps([], []));
    await refusal(issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH }), taken.options), 409, "token_hash_conflict");
    expect(taken.events[5]).toMatchObject({ operation: "select", condition: { params: [G] } });
    expect(taken.rollbacks()).toBe(1);
    const known = staged(issueSteps([], [{ id: G }]));
    await refusal(issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH }), known.options), 409, "collaboration_mission_conflict");
    expect(known.rollbacks()).toBe(1);
  });

  test("issuer authority, mission state and subject checks still precede a participant hash", async () => {
    for (const steps of [
      [[identityRow()], [keyRow()], [{ ...parentRow(), revokedAt: NOW }], [missionRow()]],
      [[identityRow()], [keyRow()], [parentRow()], [missionRow({ revokedAt: NOW })]],
      [[identityRow()], [keyRow()], [parentRow()], [missionRow({ expiresAt: new Date(END.getTime() - 1) })]],
      [[{ ...identityRow(), status: "retired" }]],
      [[identityRow()], [{ ...keyRow(), active: false }]],
    ] as Step[][]) {
      const s = staged(steps);
      await refusal(issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH }), s.options), 401, "collaboration_mission_invalid_credential");
      expect(s.events.some(e => e.operation === "insert")).toBe(false);
    }
  });

  test("omitting the hash keeps server minting, the one-time token and grant-ID conflict unchanged", async () => {
    const s = staged(issueSteps(inserted));
    const result = await issueMissionGrant(issueInput(), s.options);
    expect(Object.keys(result).sort()).toEqual(["grant", "token"]);
    const token = (result as { token: string }).token;
    expect(token).toMatch(/^atcm_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token.slice(5), "base64url")).toHaveLength(32);
    expect(s.events[4]).toMatchObject({ conflict: "target", values: { tokenHash: sha256(token) } });
    const known = staged(issueSteps([]));
    await refusal(issueMissionGrant(issueInput(), known.options), 409, "collaboration_mission_conflict");
    expect(known.events).toHaveLength(5);
  });
});

describe("participant self-leave", () => {
  const H = "77777777-7777-4777-8777-777777777777", J = "88888888-8888-4888-8888-888888888888", L = "99999999-9999-4999-8999-999999999999";
  const otherKey = new Uint8Array(32).fill(8), TOKEN_H = `atcm_${Buffer.alloc(32, 12).toString("base64url")}`;
  const leaveRequest = () => signed(PARTICIPANT_TOKEN, "POST", "/leave");
  const merged: Step = values => [{ ...acceptedRow(), ...values }];

  test("leave revokes only the caller's own grant and records participant_left with its signed request", async () => {
    const request = leaveRequest();
    const s = staged(admissionSteps(acceptedRow(), merged));
    const result = await executeMissionRequest(request, s.options);
    expect(result).toEqual({ created: true, data: { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: NOW.toISOString() } });
    expect(s.events.map(e => [e.operation, e.lock])).toEqual([["select", undefined], ["select", "share"], ["select", "share"], ["select", "share"], ["select", "share"], ["select", "update"], ["update", undefined]]);
    const write = s.events[6];
    expect(write.condition?.params).toEqual([G]);
    expect(write.condition?.sql).toContain('"revoked_at" is null');
    expect(write.values?.revokedAt).toEqual(NOW);
    const proofs = write.values?.acceptanceProof as Record<string, unknown>;
    const leave = proofs.participant_leave as Record<string, string>;
    expect({ ...proofs, participant_leave: undefined }).toEqual({ ...ACCEPTANCE, participant_leave: undefined });
    expect(leave).toMatchObject({ reason: "participant_left", method: "POST", request_target: `${base}/leave`, raw_body: "", body_sha256: sha256(""), public_key: publicKey, signature: request.proof.signature });
    expect(verifyMissionProof({ ...request, bodyBytes: Buffer.from(leave.raw_body, "utf8"), proof: { ...request.proof, signature: leave.signature, timestamp: leave.timestamp } }, leave.public_key, NOW)).toBe(true);
    expect(s.commits()).toBe(1);
  });

  test("an exact repeat with a fresh proof returns the same state and writes nothing", async () => {
    const first = await executeMissionRequest(leaveRequest(), staged(admissionSteps(acceptedRow(), merged)).options);
    const repeated = { ...leftRow(), revokedAt: NOW };
    const later = new Date(NOW.getTime() + 2_000);
    const s = staged(admissionSteps(repeated), later);
    const again = await executeMissionRequest(signed(PARTICIPANT_TOKEN, "POST", "/leave", "", privateKey, { timestamp: later.toISOString() }), s.options);
    expect(again).toEqual({ created: false, data: first.data });
    expect(s.events.some(e => e.operation === "update")).toBe(false);
  });

  test("afterwards the token is refused by every other participant operation", async () => {
    const event = JSON.stringify({ event_id: H, summary: "after leaving" });
    for (const request of [
      signed(PARTICIPANT_TOKEN, "GET", "/invitation"), signed(PARTICIPANT_TOKEN, "GET", "/context"),
      signed(PARTICIPANT_TOKEN, "GET", "/events"), signed(PARTICIPANT_TOKEN, "POST", "/events", event),
      signed(PARTICIPANT_TOKEN, "POST", "/accept", JSON.stringify({ mission_digest: DIGEST })),
    ]) {
      const s = staged(admissionSteps(leftRow()));
      await refusal(executeMissionRequest(request, s.options), 401, "collaboration_mission_invalid_credential");
      expect(s.events.some(e => e.operation !== "select")).toBe(false);
    }
  });

  test("an administrator-revoked grant cannot be relabelled as a participant leave", async () => {
    const s = staged(admissionSteps(acceptedRow({ revokedAt: new Date(NOW.getTime() - 1_000) })));
    await refusal(executeMissionRequest(leaveRequest(), s.options), 401, "collaboration_mission_invalid_credential");
    expect(s.events.some(e => e.operation === "update")).toBe(false);
  });

  test("wrong, stale, retargeted or borrowed proofs are refused without a write", async () => {
    const retargeted = signed(PARTICIPANT_TOKEN, "POST", "/accept");
    for (const request of [
      signed(PARTICIPANT_TOKEN, "POST", "/leave", "", otherKey),
      signed(PARTICIPANT_TOKEN, "POST", "/leave", "", privateKey, { timestamp: new Date(NOW.getTime() - 300_001).toISOString() }),
      { ...retargeted, requestTarget: `${base}/leave` },
      { ...leaveRequest(), origin: "https://other.example" },
    ]) {
      const s = staged(admissionSteps(acceptedRow()));
      await refusal(executeMissionRequest(request, s.options), 401, "collaboration_mission_invalid_credential");
      expect(s.events.some(e => e.operation === "update")).toBe(false);
    }
    // Another participant's grant cannot be named with this token, so it cannot be revoked.
    const borrowed = staged([[acceptedRow()]]);
    await refusal(executeMissionRequest(signed(PARTICIPANT_TOKEN, "POST", "/leave", "", otherKey, { grantId: H, identityId: J, keyId: L }), borrowed.options), 401, "collaboration_mission_invalid_credential");
    expect(borrowed.events).toHaveLength(1);
  });

  test("leave needs prior acceptance and signs zero body bytes", async () => {
    const unaccepted = staged(admissionSteps(grantRow()));
    await refusal(executeMissionRequest(leaveRequest(), unaccepted.options), 403, "collaboration_mission_acceptance_required");
    expect(unaccepted.events.some(e => e.operation === "update")).toBe(false);
    for (const body of ["{}", " "]) {
      const s = staged([]);
      await refusal(executeMissionRequest(signed(PARTICIPANT_TOKEN, "POST", "/leave", body), s.options), 400, "collaboration_mission_invalid_request");
      expect(s.events).toHaveLength(0);
    }
    expect(missionOperation({ missionId: M, method: "POST", requestTarget: `${base}/leave`, bodyBytes: new Uint8Array() }).operation).toBe("leave");
    for (const [method, suffix] of [["GET", "/leave"], ["POST", "/leave/"], ["POST", "/leave?x=1"], ["POST", "/%6ceave"]] as const) {
      expect(() => missionOperation({ missionId: M, method, requestTarget: base + suffix, bodyBytes: new Uint8Array() })).toThrow();
    }
  });

  test("other grants and the mission stay under administrator control", async () => {
    // The administrator sees the reason, and a later administrator revoke stays idempotent.
    const view = await getMissionGrant({ projectId: P, missionId: M, grantId: G }, staged([[leftRow()]]).options);
    expect(view.revocation_reason).toBe("participant_left");
    // One unlocked read chooses the (unchained) lock path, then today's locked read.
    const revoke = staged([[missionRow()], [leftRow()], [leftRow()]]);
    expect((await revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, revoke.options)).revocation_reason).toBe("participant_left");
    expect(revoke.events.some(e => e.operation === "update")).toBe(false);
    // Grants that were not left keep the established metadata shape.
    for (const row of [acceptedRow(), acceptedRow({ revokedAt: NOW })]) {
      expect("revocation_reason" in await getMissionGrant({ projectId: P, missionId: M, grantId: G }, staged([[row]]).options)).toBe(false);
    }
    // Another participant still reads context after this grant has left.
    const peer = acceptedRow({ id: H, identityId: J, signingKeyId: L, tokenHash: sha256(TOKEN_H) });
    const read = staged([[peer], [{ ...identityRow(), id: J }], [{ ...keyRow(), id: L, identityId: J, publicKey: Buffer.from(ed.getPublicKey(otherKey)).toString("base64") }], [parentRow()], [missionRow()], [peer]]);
    const context = await executeMissionRequest(signed(TOKEN_H, "GET", "/context", "", otherKey, { grantId: H, identityId: J, keyId: L }), read.options);
    expect(context.data.grant).toMatchObject({ grant_id: H, revoked_at: null });
    // Mission revocation still works, after which even a repeat leave is refused.
    const mission = staged([[missionRow()], values => [{ ...missionRow(), ...values }]]);
    expect((await revokeMission({ projectId: P, missionId: M }, mission.options)).revoked_at).toBe(NOW.toISOString());
    const closed = staged([[leftRow()], [identityRow()], [keyRow()], [parentRow()], [missionRow({ revokedAt: NOW })], [leftRow()]]);
    await refusal(executeMissionRequest(leaveRequest(), closed.options), 401, "collaboration_mission_invalid_credential");
  });
});

describe("renewal inside an administrator-set window", () => {
  const N = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", C = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const MIN = 60_000, WINDOW = new Date(NOW.getTime() + 6 * 3_600_000);
  const NEXT_HASH = sha256(`atcm_${Buffer.alloc(32, 31).toString("base64url")}`);
  const CHILD_TOKEN = `atcm_${Buffer.alloc(32, 32).toString("base64url")}`, CHILD_HASH = sha256(CHILD_TOKEN);
  const dialect = new PgDialect();
  const rendered = (value: unknown) => dialect.sqlToQuery(value as SQL);
  const mission = (overrides: Record<string, unknown> = {}) => missionRow({ createdAt: new Date(NOW.getTime() - 2 * 3_600_000), ...overrides });
  /** A live accepted root: one-hour lifetime, halfway already passed. */
  const root = (overrides: Record<string, unknown> = {}) => acceptedRow({ renewalRootId: G, renewableUntil: WINDOW,
    issuedAt: new Date(NOW.getTime() - 40 * MIN), expiresAt: new Date(NOW.getTime() + 20 * MIN), ...overrides });
  /** A born-accepted middle member renewed from the root. */
  const middle = (overrides: Record<string, unknown> = {}) => root({ id: C, tokenHash: CHILD_HASH, renewedFromGrantId: G,
    acceptedAt: new Date(NOW.getTime() - 40 * MIN), ...overrides });
  const body = (overrides: Record<string, unknown> = {}) => JSON.stringify({ grant_id: N, mission_digest: DIGEST, token_sha256: NEXT_HASH, ...overrides });
  const renew = (token = PARTICIPANT_TOKEN, grantId = G, raw = body(), proof: Partial<MissionRequest["proof"]> = {}) =>
    signed(token, "POST", "/renew", raw, privateKey, { grantId, ...proof });
  /** hint, identity, key, parent, mission SHARE, root FOR UPDATE[, G FOR UPDATE], then the tail. */
  const renewSteps = (g: Record<string, unknown>, rootRow: Record<string, unknown> = root(), ...tail: Step[]): Step[] =>
    [[g], [identityRow()], [keyRow()], [parentRow()], [mission()], [rootRow], ...(g.id === rootRow.id ? [] : [[g]]), ...tail];
  const shape = (s: ReturnType<typeof staged>) => s.events.map(e => [e.operation, e.lock]);
  const noInsert = (s: ReturnType<typeof staged>) => expect(s.events.some(e => e.operation === "insert")).toBe(false);

  describe("issuing a window", () => {
    test("renewable_until reaches the strict schema and roots a chain on the grant itself", async () => {
      const s = staged(issueSteps(inserted));
      const result = await issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH, renewableUntil: WINDOW.toISOString() }), s.options);
      expect(s.events[4].values).toMatchObject({ id: G, renewableUntil: WINDOW, renewalRootId: G, renewedFromGrantId: null, renewalClosedAt: null });
      expect(result.grant.renewal).toEqual({ root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: null, renewable_until: WINDOW.toISOString(), closed_at: null });
      // A server-minted token may root a chain as well.
      const minted = await issueMissionGrant(issueInput({ renewableUntil: WINDOW.toISOString() }), staged(issueSteps(inserted)).options);
      expect(minted.grant.renewal?.root_grant_id).toBe(G);
    });

    test("without a window the insert values and metadata keys are exactly today's", async () => {
      const s = staged(issueSteps(inserted));
      const result = await issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH }), s.options);
      expect(Object.keys(s.events[4].values!).sort()).toEqual(["acceptanceProof", "acceptedAt", "actions", "expiresAt", "id", "identityId", "issuedAt",
        "issuingApiKeyId", "missionId", "origin", "projectId", "revokedAt", "signingKeyId", "tokenHash"]);
      expect(Object.keys(result.grant).sort()).toEqual(["accepted_at", "actions", "expires_at", "grant_id", "identity_id", "issued_at",
        "issuing_api_key_id", "mission_id", "origin", "project_id", "revoked_at", "signing_key_id"]);
      expect(s.events).toHaveLength(5);
    });

    test("a window must outlast the grant, follow a root of at least an hour and stay inside mission and key authority", async () => {
      const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();
      for (const [extra, steps, status, code] of [
        [{ renewableUntil: END.toISOString() }, issueSteps(), 400, "collaboration_mission_invalid_request"],
        [{ renewableUntil: at(3_600_000 - 1) }, issueSteps(), 400, "collaboration_mission_invalid_request"],
        [{ expiresAt: at(59 * MIN), renewableUntil: WINDOW.toISOString() }, issueSteps(), 400, "collaboration_mission_invalid_request"],
        [{ renewableUntil: at(MISSION_BOUNDS.missionAgeMs + 1) }, [[identityRow()], [keyRow()], [parentRow()], [missionRow({ expiresAt: new Date(NOW.getTime() + MISSION_BOUNDS.missionAgeMs + 1) })]], 400, "collaboration_mission_invalid_request"],
        [{ renewableUntil: at(86_400_000 + 1) }, issueSteps(), 401, "collaboration_mission_invalid_credential"],
        [{ renewableUntil: WINDOW.toISOString() }, [[identityRow()], [keyRow()], [{ ...parentRow(), expiresAt: new Date(WINDOW.getTime() - 1) }], [missionRow()]], 401, "collaboration_mission_invalid_credential"],
        [{ renewableUntil: "2026-09-28T15:00:00Z" }, [], 400, "collaboration_mission_invalid_request"],
      ] as Array<[Record<string, string>, Step[], number, string]>) {
        const s = staged(steps);
        await refusal(issueMissionGrant(issueInput({ tokenSha256: PARTICIPANT_HASH, ...extra }), s.options), status, code);
        noInsert(s);
      }
    });
  });

  describe("renewing", () => {
    test("a live accepted root renews into a born-accepted successor with the same scope and no token", async () => {
      const request = renew(), s = staged(renewSteps(root(), root(), [], [], inserted));
      const result = await executeMissionRequest(request, s.options);
      expect(shape(s)).toEqual([["select", undefined], ["select", "share"], ["select", "share"], ["select", "share"], ["select", "share"],
        ["select", "update"], ["select", undefined], ["select", undefined], ["insert", undefined]]);
      expect(s.configs).toEqual([{ isolationLevel: "read committed" }]);
      expect(s.events[6].condition?.params).toEqual([G]);
      // Any revoked member of the whole chain, under the root lock.
      expect(s.events[7].condition?.sql).toContain('"revoked_at" is not null');
      expect(s.events[7].condition?.params).toEqual([G, M, P]);
      const values = s.events[8].values!;
      expect(s.events[8].conflict).toBe("any");
      expect(values).toMatchObject({ id: N, tokenHash: NEXT_HASH, projectId: P, missionId: M, identityId: I, signingKeyId: K, issuingApiKeyId: A,
        origin: ORIGIN, actions: ["mission.observe", "mission.read"], issuedAt: NOW, acceptedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000),
        revokedAt: null, renewableUntil: WINDOW, renewalClosedAt: null, renewalRootId: G, renewedFromGrantId: G });
      expect(values.acceptanceProof).toEqual({ domain: "agenttool-collaboration-request/v1", origin: ORIGIN, method: "POST", request_target: `${base}/renew`,
        timestamp: request.proof.timestamp, signature: request.proof.signature, public_key: publicKey, raw_body: body(), body_sha256: sha256(body()), signed_grant_id: G });
      expect(result.created).toBe(true);
      expect(result.data).toMatchObject({ token_sha256: NEXT_HASH, token_source: "participant", mission: { mission_digest: DIGEST },
        grant: { grant_id: N, accepted_at: NOW.toISOString(), renewal: { root_grant_id: G, renewed_from_grant_id: G, renewed_to_grant_id: null, renewable_until: WINDOW.toISOString(), closed_at: null } } });
      expect(JSON.stringify(result)).not.toContain("atcm_");
      expect(s.commits()).toBe(1);
    });

    test("a middle member locks the root before itself and copies the root's window", async () => {
      const s = staged(renewSteps(middle(), root(), [], [], inserted));
      const result = await executeMissionRequest(renew(CHILD_TOKEN, C), s.options);
      expect(shape(s).slice(5)).toEqual([["select", "update"], ["select", "update"], ["select", undefined], ["select", undefined], ["insert", undefined]]);
      expect(s.events[5].condition?.params).toContain(G);
      expect(s.events[6].condition?.params).toContain(C);
      expect(result.data.grant).toMatchObject({ renewal: { root_grant_id: G, renewed_from_grant_id: C } });
      expect(s.events[9].values).toMatchObject({ renewalRootId: G, renewedFromGrantId: C, renewableUntil: WINDOW });
    });

    test("a read-only chain renews read-only: actions are copied from G, never widened", async () => {
      const narrow = { actions: ["mission.read"] };
      const s = staged(renewSteps(middle(narrow), root(narrow), [], [], inserted));
      const result = await executeMissionRequest(renew(CHILD_TOKEN, C), s.options);
      expect(s.events[9].values?.actions).toEqual(["mission.read"]);
      expect((result.data.grant as { actions: string[] }).actions).toEqual(["mission.read"]);
    });

    test("each ceiling clamps the successor: root lifetime, window, mission and issuing key", async () => {
      const at = (ms: number) => new Date(NOW.getTime() + ms);
      for (const [rootRow, missionOverrides, parentOverrides, expected] of [
        [root({ issuedAt: at(-100 * MIN), expiresAt: at(20 * MIN) }), {}, {}, at(2 * 3_600_000)],
        [root({ renewableUntil: at(30 * MIN) }), {}, {}, at(30 * MIN)],
        [root(), { expiresAt: at(40 * MIN) }, {}, at(40 * MIN)],
        [root(), {}, { expiresAt: at(50 * MIN) }, at(50 * MIN)],
      ] as Array<[Record<string, unknown>, Record<string, unknown>, Record<string, unknown>, Date]>) {
        const s = staged([[rootRow], [identityRow()], [keyRow()], [{ ...parentRow(), ...parentOverrides }], [mission(missionOverrides)], [rootRow], [], [], inserted]);
        const result = await executeMissionRequest(renew(), s.options);
        expect(s.events[8].values?.expiresAt).toEqual(expected);
        expect((result.data.grant as { expires_at: string }).expires_at).toBe(expected.toISOString());
      }
    });

    test("outside the window the refusal is renewal_unavailable and nothing is inserted", async () => {
      const unchained = staged(admissionSteps(acceptedRow()));
      await refusal(executeMissionRequest(renew(), unchained.options), 403, "collaboration_mission_renewal_unavailable");
      expect(shape(unchained)[5]).toEqual(["select", "share"]);
      for (const rootRow of [
        root({ issuedAt: new Date(NOW.getTime() - 20 * MIN), expiresAt: new Date(NOW.getTime() + 40 * MIN) }),
        root({ renewableUntil: NOW }),
        root({ renewalClosedAt: new Date(NOW.getTime() - MIN) }),
        root({ renewableUntil: new Date(NOW.getTime() + 20 * MIN) }),
      ]) {
        const s = staged(renewSteps(rootRow, rootRow, []));
        await refusal(executeMissionRequest(renew(), s.options), 403, "collaboration_mission_renewal_unavailable");
        noInsert(s);
      }
      // The halfway gate is the presented member's own, never the root's: a young
      // successor under a root past its halfway cannot renew yet.
      const young = middle({ issuedAt: new Date(NOW.getTime() - 10 * MIN), acceptedAt: new Date(NOW.getTime() - 10 * MIN), expiresAt: new Date(NOW.getTime() + 50 * MIN) });
      const early = staged(renewSteps(young, root(), []));
      await refusal(executeMissionRequest(renew(CHILD_TOKEN, C), early.options), 403, "collaboration_mission_renewal_unavailable");
      noInsert(early);
      // A closed root closes every member, even one whose own stamp is missing.
      const s = staged(renewSteps(middle(), root({ renewalClosedAt: new Date(NOW.getTime() - MIN) }), []));
      await refusal(executeMissionRequest(renew(CHILD_TOKEN, C), s.options), 403, "collaboration_mission_renewal_unavailable");
      noInsert(s);
    });

    test("a member revoked alone (by code at a99257ab) ends renewal of every live member", async () => {
      // The root, or any other member, carries revoked_at while the window stays open.
      for (const [presented, rootRow, token, grantId] of [
        [middle(), root({ revokedAt: new Date(NOW.getTime() - MIN) }), CHILD_TOKEN, C],
        [root(), root(), PARTICIPANT_TOKEN, G],
      ] as Array<[Record<string, unknown>, Record<string, unknown>, string, string]>) {
        const s = staged(renewSteps(presented, rootRow, [], [{ id: N }]));
        await refusal(executeMissionRequest(renew(token, grantId), s.options), 403, "collaboration_mission_renewal_unavailable");
        noInsert(s);
      }
    });

    test("an unaccepted root needs acceptance, and a different mission digest conflicts", async () => {
      const unaccepted = root({ acceptedAt: null, acceptanceProof: null });
      const s = staged(renewSteps(unaccepted, unaccepted));
      await refusal(executeMissionRequest(renew(), s.options), 403, "collaboration_mission_acceptance_required");
      const digest = staged(renewSteps(root(), root()));
      await refusal(executeMissionRequest(renew(PARTICIPANT_TOKEN, G, body({ mission_digest: `sha256:${"0".repeat(64)}` })), digest.options), 409, "collaboration_mission_conflict");
      noInsert(s); noInsert(digest);
    });

    test("an expired, revoked or left grant, or any lapsed authority, is never a renewal credential", async () => {
      const expired = root({ issuedAt: new Date(NOW.getTime() - 60 * MIN), expiresAt: NOW });
      const left = root({ revokedAt: new Date(NOW.getTime() - MIN), acceptanceProof: { ...ACCEPTANCE, participant_leave: { reason: "participant_left", via_grant_id: C } } });
      const rebound = middle({ renewedFromGrantId: N });
      for (const [steps, request] of [
        [renewSteps(expired, expired), renew()],
        [renewSteps(root({ revokedAt: new Date(NOW.getTime() - MIN) }), root({ revokedAt: new Date(NOW.getTime() - MIN) })), renew()],
        [renewSteps(left, left), renew()],
        [[[root()], [identityRow()], [keyRow()], [parentRow()], [mission({ revokedAt: NOW })], [root()]], renew()],
        [[[root()], [identityRow()], [keyRow()], [{ ...parentRow(), revokedAt: NOW }], [mission()], [root()]], renew()],
        [[[root()], [identityRow()], [keyRow()], [{ ...parentRow(), expiresAt: new Date(NOW.getTime() + MIN) }], [mission()], [root()]], renew()],
        [[[root()], [{ ...identityRow(), status: "retired" }]], renew()],
        [[[root()], [identityRow()], [{ ...keyRow(), revokedAt: NOW }]], renew()],
        [renewSteps(root(), root()), renew(PARTICIPANT_TOKEN, G, body(), { timestamp: new Date(NOW.getTime() - 300_001).toISOString() })],
        // The hint fixed the chain binding; a locked row that differs is refused.
        [[[middle()], [identityRow()], [keyRow()], [parentRow()], [mission()], [root()], [rebound]], renew(CHILD_TOKEN, C)],
      ] as Array<[Step[], MissionRequest]>) {
        const s = staged(steps);
        await refusal(executeMissionRequest(request, s.options), 401, "collaboration_mission_invalid_credential");
        noInsert(s);
      }
    });

    test("malformed bodies, a reused grant ID and the presented token's own hash are refused before any query", async () => {
      for (const [raw, status, code] of [
        [body({ expires_at: END.toISOString() }), 400, "collaboration_mission_invalid_request"],
        [JSON.stringify({ grant_id: N, mission_digest: DIGEST }), 400, "collaboration_mission_invalid_request"],
        [body({ token_sha256: NEXT_HASH.toUpperCase() }), 400, "collaboration_mission_invalid_request"],
        [body({ grant_id: G }), 400, "collaboration_mission_invalid_request"],
        [`{"grant_id":"${N}","grant_id":"${C}","mission_digest":"${DIGEST}","token_sha256":"${NEXT_HASH}"}`, 400, "collaboration_mission_invalid_request"],
        ["", 400, "collaboration_mission_invalid_request"],
        [body({ token_sha256: PARTICIPANT_HASH }), 409, "token_hash_conflict"],
      ] as Array<[string, number, string]>) {
        const s = staged([]);
        await refusal(executeMissionRequest(renew(PARTICIPANT_TOKEN, G, raw), s.options), status, code);
        expect(s.events).toHaveLength(0);
      }
    });

    test("a taken grant ID conflicts and a taken hash is token_hash_conflict", async () => {
      const id = staged(renewSteps(root(), root(), [], [], [], [{ id: N }]));
      await refusal(executeMissionRequest(renew(), id.options), 409, "collaboration_mission_conflict");
      const hash = staged(renewSteps(root(), root(), [], [], [], []));
      await refusal(executeMissionRequest(renew(), hash.options), 409, "token_hash_conflict");
      expect(hash.events[9].condition?.params).toEqual([N]);
      expect(id.rollbacks() + hash.rollbacks()).toBe(2);
    });

    test("an exact retry returns the stored successor, even after close; any difference conflicts", async () => {
      const request = renew();
      const child = middle({ id: N, tokenHash: NEXT_HASH, issuedAt: NOW, acceptedAt: NOW, expiresAt: new Date(NOW.getTime() + 3_600_000),
        acceptanceProof: { body_sha256: sha256(body()), signed_grant_id: G } });
      const first = await executeMissionRequest(request, staged(renewSteps(root(), root(), [], [], inserted)).options);
      const later = new Date(NOW.getTime() + 2_000);
      for (const rootRow of [root(), root({ renewalClosedAt: NOW })]) {
        const s = staged(renewSteps(rootRow, rootRow, [child], []), later);
        const again = await executeMissionRequest(renew(PARTICIPANT_TOKEN, G, body(), { timestamp: later.toISOString() }), s.options);
        expect(again).toEqual({ created: false, data: { ...first.data, grant: { ...(first.data.grant as object) } } });
        noInsert(s);
      }
      for (const raw of [`${body()} `, body({ grant_id: C }), body({ token_sha256: "e".repeat(64) })]) {
        const s = staged(renewSteps(root(), root(), [child]));
        await refusal(executeMissionRequest(renew(PARTICIPANT_TOKEN, G, raw), s.options), 409, "collaboration_mission_conflict");
        noInsert(s);
      }
      // Replayed after the chain is revoked: refused at admission, never the stored child.
      const revoked = root({ revokedAt: NOW });
      const s = staged(renewSteps(revoked, revoked));
      await refusal(executeMissionRequest(request, s.options), 401, "collaboration_mission_invalid_credential");
      expect(s.events).toHaveLength(6);
    });

    test("the route map has one exact renew spelling", () => {
      expect(missionOperation({ missionId: M, method: "POST", requestTarget: `${base}/renew`, bodyBytes: Buffer.from(body()) }).operation).toBe("renew");
      for (const [method, suffix] of [["GET", "/renew"], ["POST", "/renew/"], ["POST", "/renew?x=1"], ["POST", "/%72enew"]] as const) {
        expect(() => missionOperation({ missionId: M, method, requestTarget: base + suffix, bodyBytes: new Uint8Array() })).toThrow();
      }
    });
  });

  describe("ending a chain", () => {
    const cascade = (s: ReturnType<typeof staged>, index: number) => {
      const event = s.events[index];
      expect(event.operation).toBe("update");
      expect(event.condition?.sql).toContain('"renewal_root_id" = $1');
      expect(event.condition?.params).toEqual([G, M, P]);
      expect(event.condition?.sql).not.toContain("issued_at");
      for (const field of ["revokedAt", "renewalClosedAt"]) {
        const set = rendered(event.values?.[field]);
        expect(set.sql).toMatch(/^COALESCE\("tools"\."collaboration_grants"\."(revoked_at|renewal_closed_at)", GREATEST\(\$1::timestamptz, "tools"\."collaboration_grants"\."issued_at"\)\)$/);
        expect(set.params).toEqual([NOW.toISOString()]);
      }
    };
    const ended = (...rows: Array<Record<string, unknown>>): Step => () => rows.map(row => ({ ...row, revokedAt: row.revokedAt ?? NOW, renewalClosedAt: row.renewalClosedAt ?? NOW }));

    test("revoking the root or any later member ends every member under the root lock", async () => {
      const viaRoot = staged([[mission()], [root()], [root()], ended(root(), middle()), []]);
      const view = await revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, viaRoot.options);
      expect(shape(viaRoot)).toEqual([["select", "share"], ["select", undefined], ["select", "update"], ["update", undefined], ["select", undefined]]);
      cascade(viaRoot, 3);
      expect(view).toMatchObject({ grant_id: G, revoked_at: NOW.toISOString(), renewal: { closed_at: NOW.toISOString() } });
      expect(viaRoot.configs).toEqual([{ isolationLevel: "read committed" }]);
      const viaChild = staged([[mission()], [middle()], [root()], [middle()], ended(root(), middle()), []]);
      await revokeMissionGrant({ projectId: P, missionId: M, grantId: C }, viaChild.options);
      expect(shape(viaChild)).toEqual([["select", "share"], ["select", undefined], ["select", "update"], ["select", "update"], ["update", undefined], ["select", undefined]]);
      expect(viaChild.events[2].condition?.params).toContain(G);
      cascade(viaChild, 4);
    });

    test("an expired, already revoked or left member still ends its live descendants", async () => {
      for (const target of [
        root({ issuedAt: new Date(NOW.getTime() - 25 * 60 * MIN), expiresAt: new Date(NOW.getTime() - 60 * MIN) }),
        root({ revokedAt: new Date(NOW.getTime() - MIN) }),
        root({ revokedAt: new Date(NOW.getTime() - MIN), acceptanceProof: { ...ACCEPTANCE, participant_leave: { reason: "participant_left" } } }),
      ]) {
        const s = staged([[mission()], [target], [target], ended(target, middle()), []]);
        const view = await revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, s.options);
        cascade(s, 3);
        expect(view.revoked_at).toBe(((target.revokedAt as Date | null) ?? NOW).toISOString());
      }
    });

    test("an unchained revoke keeps today's locked path and early return after one unlocked read", async () => {
      const live = staged([[mission()], [acceptedRow()], [acceptedRow()], values => [{ ...acceptedRow(), ...values }]]);
      const view = await revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, live.options);
      expect(shape(live)).toEqual([["select", "share"], ["select", undefined], ["select", "update"], ["update", undefined]]);
      expect(live.events[3].values).toEqual({ revokedAt: NOW });
      expect(view).not.toHaveProperty("renewal");
      const repeat = staged([[mission()], [acceptedRow({ revokedAt: NOW })], [acceptedRow({ revokedAt: NOW })]]);
      await revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, repeat.options);
      expect(repeat.events).toHaveLength(3);
      const future = staged([[mission()], [acceptedRow({ issuedAt: new Date(NOW.getTime() + 1) })], [acceptedRow({ issuedAt: new Date(NOW.getTime() + 1) })]]);
      await refusal(revokeMissionGrant({ projectId: P, missionId: M, grantId: G }, future.options), 503, "collaboration_mission_invalid_state");
    });

    test("leaving any member revokes it with signed evidence and labels the rest with an unsigned pointer", async () => {
      const request = signed(CHILD_TOKEN, "POST", "/leave", "", privateKey, { grantId: C });
      const merged: Step = values => [{ ...middle(), ...values }];
      const s = staged([[middle()], [identityRow()], [keyRow()], [parentRow()], [mission()], [root()], [middle()], merged, [root({ revokedAt: NOW })], ended(root(), middle())]);
      const result = await executeMissionRequest(request, s.options);
      expect(result).toEqual({ created: true, data: { mission_id: M, grant_id: C, status: "revoked", reason: "participant_left", revoked_at: NOW.toISOString() } });
      expect(shape(s).slice(5)).toEqual([["select", "update"], ["select", "update"], ["update", undefined], ["update", undefined], ["update", undefined]]);
      expect(s.events[7].condition?.params).toEqual([C]);
      expect((s.events[7].values?.acceptanceProof as Record<string, any>).participant_leave).toMatchObject({ reason: "participant_left", signature: request.proof.signature });
      const label = s.events[8];
      expect(label.condition?.sql).toContain('"revoked_at" is null');
      expect(label.condition?.params).toEqual([G, M, P]);
      expect(rendered(label.values?.revokedAt).sql).toBe('GREATEST($1::timestamptz, "tools"."collaboration_grants"."issued_at")');
      const pointer = rendered(label.values?.acceptanceProof);
      expect(pointer.sql).toContain("jsonb_build_object($1::text, jsonb_build_object('reason', $2::text, 'via_grant_id', $3::text))");
      expect(pointer.sql).not.toContain("signature");
      expect(pointer.params).toEqual(["participant_leave", "participant_left", C]);
      cascade(s, 9);
    });

    test("each labelled member's own repeat leave returns its own state; an administrator-revoked chain is never relabelled", async () => {
      const pointered = root({ revokedAt: NOW, acceptanceProof: { ...ACCEPTANCE, participant_leave: { reason: "participant_left", via_grant_id: C } } });
      const s = staged([[pointered], [identityRow()], [keyRow()], [parentRow()], [mission()], [pointered]]);
      const result = await executeMissionRequest(signed(PARTICIPANT_TOKEN, "POST", "/leave"), s.options);
      expect(result).toEqual({ created: false, data: { mission_id: M, grant_id: G, status: "revoked", reason: "participant_left", revoked_at: NOW.toISOString() } });
      expect(s.events.some(e => e.operation === "update")).toBe(false);
      expect((await getMissionGrant({ projectId: P, missionId: M, grantId: G }, staged([[pointered], [{ id: C }]]).options)).revocation_reason).toBe("participant_left");
      const revoked = middle({ revokedAt: NOW });
      const admin = staged([[revoked], [identityRow()], [keyRow()], [parentRow()], [mission()], [root({ revokedAt: NOW })], [revoked]]);
      await refusal(executeMissionRequest(signed(CHILD_TOKEN, "POST", "/leave", "", privateKey, { grantId: C }), admin.options), 401, "collaboration_mission_invalid_credential");
      expect(admin.events.some(e => e.operation === "update")).toBe(false);
    });

    test("close stamps every member once through any member, revokes nothing and keeps the window", async () => {
      for (const target of [root(), middle(), middle({ id: N, renewedFromGrantId: C, expiresAt: new Date(NOW.getTime() - MIN) })]) {
        const closed: Step = () => [root(), middle(), middle({ id: N, renewedFromGrantId: C })].map(row => ({ ...row, renewalClosedAt: NOW }));
        const s = staged([[mission()], [target], [root()], closed, []]);
        const view = await closeMissionGrantRenewal({ projectId: P, missionId: M, grantId: target.id as string }, s.options);
        expect(shape(s)).toEqual([["select", "share"], ["select", undefined], ["select", "update"], ["update", undefined], ["select", undefined]]);
        expect(Object.keys(s.events[3].values!)).toEqual(["renewalClosedAt"]);
        expect(rendered(s.events[3].values!.renewalClosedAt).sql).toBe('COALESCE("tools"."collaboration_grants"."renewal_closed_at", GREATEST($1::timestamptz, "tools"."collaboration_grants"."issued_at"))');
        expect(s.events[3].condition?.params).toEqual([G, M, P]);
        expect(view).toMatchObject({ grant_id: target.id, revoked_at: null, renewal: { closed_at: NOW.toISOString(), renewable_until: WINDOW.toISOString() } });
        expect(s.configs).toEqual([{ isolationLevel: "read committed" }]);
      }
      const plain = staged([[mission()], [acceptedRow()]]);
      expect(await closeMissionGrantRenewal({ projectId: P, missionId: M, grantId: G }, plain.options)).not.toHaveProperty("renewal");
      expect(plain.events).toHaveLength(2);
      await refusal(closeMissionGrantRenewal({ projectId: P, missionId: M, grantId: G }, staged([[]]).options), 404, "collaboration_mission_not_found");
      await refusal(closeMissionGrantRenewal({ projectId: P, missionId: M, grantId: G }, staged([[mission()], []]).options), 404, "collaboration_mission_not_found");
    });
  });

  test("chain metadata adds one lineage object; unchained rows run no extra query", async () => {
    const chained = staged([[root()], [{ id: C }]]);
    expect((await getMissionGrant({ projectId: P, missionId: M, grantId: G }, chained.options)).renewal).toEqual({
      root_grant_id: G, renewed_from_grant_id: null, renewed_to_grant_id: C, renewable_until: WINDOW.toISOString(), closed_at: null });
    expect(chained.events[1].condition?.params).toEqual([G]);
    const plain = staged([[acceptedRow()]]);
    expect(await getMissionGrant({ projectId: P, missionId: M, grantId: G }, plain.options)).not.toHaveProperty("renewal");
    expect(plain.events).toHaveLength(1);
    const invitation = staged([...renewSteps(middle(), middle()).slice(0, 5), [middle()], []]);
    const view = await executeMissionRequest(signed(CHILD_TOKEN, "GET", "/invitation", "", privateKey, { grantId: C }), invitation.options);
    expect(shape(invitation)[5]).toEqual(["select", "share"]);
    expect(view.data.grant).toMatchObject({ grant_id: C, renewal: { root_grant_id: G, renewed_from_grant_id: G, renewed_to_grant_id: null } });
    expect(JSON.stringify(view)).not.toContain(CHILD_HASH);
  });
});

test("every Drizzle column of collaboration_grants is created by a collaboration migration", () => {
  const sql = readdirSync(new URL("../migrations/", import.meta.url)).filter(name => /collaboration/.test(name) && name.endsWith(".sql"))
    .map(name => readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8")).join("\n");
  const columns = Object.values(getTableColumns(collaborationGrants)).map(column => column.name);
  expect(columns).toContain("renewal_root_id");
  for (const column of columns) expect(new RegExp(`\\b${column}\\b`).test(sql), column).toBe(true);
});
