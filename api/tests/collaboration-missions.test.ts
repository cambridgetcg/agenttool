/** Hermetic wire/proof boundaries; durable races run in the explicit disposable PostgreSQL suite. */
import { describe, expect, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { createMissionSchema, MISSION_BOUNDS, missionDescriptorSchema, missionObservationSchema, missionOperation, packMissionEventPage, parseMissionBody, type MissionRequest } from "../src/services/collaboration/contracts";
import { canonicalMissionRequestBytes, verifyMissionProof } from "../src/services/collaboration/proof";

const M = "11111111-1111-4111-8111-111111111111", G = "22222222-2222-4222-8222-222222222222";
const I = "33333333-3333-4333-8333-333333333333", K = "44444444-4444-4444-8444-444444444444";
const NOW = new Date("2026-09-28T09:00:00.000Z"), privateKey = new Uint8Array(32).fill(7);
const publicKey = Buffer.from(ed.getPublicKey(privateKey)).toString("base64");
const base = `/v1/collaboration/missions/${M}`;
const descriptor = { format: "agenttool-collaboration-mission/v1", purpose: "Review selected evidence", resources: [], acceptance_criteria: ["Return a bounded review"], principalities: [] };
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
