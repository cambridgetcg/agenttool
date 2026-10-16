/** Hermetic wire/proof boundaries and staged store transactions; durable races
 * and real constraints run in the explicit disposable PostgreSQL suite. */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import * as ed from "@noble/ed25519";
import { PgDialect } from "drizzle-orm/pg-core";
import { createMissionSchema, issueMissionGrantSchema, MISSION_BOUNDS, MissionError, missionDescriptorSchema, missionObservationSchema, missionOperation, packMissionEventPage, parseMissionBody, type MissionAction, type MissionRequest } from "../src/services/collaboration/contracts";
import { canonicalMissionRequestBytes, verifyMissionProof } from "../src/services/collaboration/proof";
import { executeMissionRequest, issueMissionGrant } from "../src/services/collaboration/store";
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
  issuedAt: new Date(NOW.getTime() - 60_000), expiresAt: END, acceptedAt: null, acceptanceProof: null, revokedAt: null, ...overrides });
const issueInput = (extra: { tokenSha256?: string; grantId?: string } = {}) => ({ projectId: P, missionId: M, issuerApiKeyId: A, grantId: G,
  identityId: I, signingKeyId: K, origin: ORIGIN, actions: ["mission.read"] as MissionAction[], expiresAt: END.toISOString(), ...extra });

type Step = unknown[] | ((values: Record<string, unknown> | undefined) => unknown[]);
interface StagedEvent { operation: string; condition?: { sql: string; params: unknown[] }; lock?: string; values?: Record<string, unknown>; conflict?: "target" | "any" }
/** Replays one result per terminal query and records each query's shape. */
function staged(steps: Step[], now: Date = NOW) {
  const events: StagedEvent[] = [];
  const dialect = new PgDialect();
  let commits = 0, rollbacks = 0;
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
  const database = { transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    try { const result = await fn(tx); commits++; return result; } catch (error) { rollbacks++; throw error; }
  } };
  return { events, options: { database: database as never, now }, commits: () => commits, rollbacks: () => rollbacks };
}
const inserted: Step = values => [{ ...values }];
const issueSteps = (...tail: Step[]): Step[] => [[identityRow()], [keyRow()], [parentRow()], [missionRow()], ...tail];
async function refusal(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(MissionError);
  expect((error as MissionError).status as number).toBe(status);
  expect((error as MissionError).code).toBe(code);
}
function signed(token: string, method: "GET" | "POST", suffix: string, body = "", key = privateKey): MissionRequest {
  const input: MissionRequest = { token, missionId: M, origin: ORIGIN, method, requestTarget: base + suffix, bodyBytes: Buffer.from(body),
    proof: { grantId: G, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" } };
  input.proof.signature = Buffer.from(ed.sign(canonicalMissionRequestBytes(input), key)).toString("base64url");
  return input;
}
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
