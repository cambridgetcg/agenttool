/** Wire formats, signed lobby documents and carried packets, as pure functions. */
import { describe, expect, test } from "bun:test";
import { LobbyError } from "../src/errors.js";
import { readFleetEvents } from "../src/fleet.js";
import { buildEnrollmentPacket, doorResource, namesDoor, parseEnrollmentPacket, parseJoinPacket } from "../src/packets.js";
import {
  documentSha256,
  openDocument,
  ROSTER_PART_MEMBERS,
  sealDocument,
  verifyDocument,
  type AdmissionBody,
  type FleetCard,
  type KnockBody,
  type RosterBody,
} from "../src/signed.js";
import {
  didKeyOf,
  enrollmentDigest,
  generateKeyPair,
  isGrantToken,
  LOBBY_ORIGIN,
  missionDigest,
  newGrantToken,
  parseCanonicalJson,
  publicKeyBase64,
  publicKeyFingerprint,
  requestDigest,
  sha256HexOf,
  validateMissionDescriptor,
  verifyBytes,
  wireCanonicalJson,
} from "../src/wire.js";

const T = "2026-10-16T12:00:00.000Z";
const LATER = (ms: number) => new Date(Date.parse(T) + ms).toISOString();
const ROOM = `room_${"ab".repeat(16)}`;
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function signer() {
  const privateKey = generateKeyPair();
  const publicKey = publicKeyBase64(privateKey);
  return { privateKey, publicKey, fingerprint: publicKeyFingerprint(publicKey) };
}

function errorCode(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return undefined;
}

const card: FleetCard = {
  room_id: ROOM, card_seq: 1, title: "Zerone season 1", purpose: "hello", tags: ["zerone"], status: "recruiting",
  door: "knock", residency: "fleet", slots: [{ label: "reviewer", tier: "player", count: 1 }],
  season: { mission_id: UUID_A, mission_digest: `sha256:${"c".repeat(64)}`, expires_at: LATER(86_400_000) }, issued_at: T,
};

describe("wire formats", () => {
  test("canonical JSON sorts keys by code unit, keeps integer-like keys as strings and refuses floats", () => {
    expect(wireCanonicalJson({ b: 1, a: [true, null, "x"], "10": 1, "9": 2 })).toBe('{"10":1,"9":2,"a":[true,null,"x"],"b":1}');
    expect(errorCode(() => wireCanonicalJson({ a: 1.5 }))).toBe("invalid_json");
    expect(errorCode(() => wireCanonicalJson({ a: "\ud800" }))).toBe("invalid_json");
    expect(errorCode(() => parseCanonicalJson('{"b":1,"a":2}'))).toBe("invalid_json");
    expect(errorCode(() => parseCanonicalJson('{"a":1,"a":2}'))).toBe("invalid_json");
    expect(errorCode(() => parseCanonicalJson('{"a": 1}'))).toBe("invalid_json");
    expect(parseCanonicalJson('{"a":1,"b":[2]}')).toEqual({ a: 1, b: [2] });
  });

  test("mission descriptors are checked like the service schema and digested canonically", () => {
    const descriptor = {
      format: "agenttool-collaboration-mission/v1", purpose: "p", resources: [], acceptance_criteria: ["c"], principalities: [],
    } as const;
    expect(missionDigest(validateMissionDescriptor(descriptor)))
      .toBe(`sha256:${sha256HexOf('{"acceptance_criteria":["c"],"format":"agenttool-collaboration-mission/v1","principalities":[],"purpose":"p","resources":[]}')}`);
    for (const bad of [
      { ...descriptor, acceptance_criteria: [] },
      { ...descriptor, extra: 1 },
      { ...descriptor, resources: [{ uri: "http://x", format: "f", digest: `sha256:${"0".repeat(64)}` }] },
      { ...descriptor, purpose: "x".repeat(2001) },
    ]) {
      expect(errorCode(() => validateMissionDescriptor(bad))).toBe("invalid_descriptor");
    }
  });

  test("participant tokens have the service shape and travel only as their SHA-256", () => {
    const { token, token_sha256 } = newGrantToken();
    expect(isGrantToken(token)).toBe(true);
    expect(token_sha256).toBe(sha256HexOf(token));
    expect(isGrantToken(`atcm_${"A".repeat(42)}`)).toBe(false);
    expect(isGrantToken(`at_${"A".repeat(43)}`)).toBe(false);
  });

  test("request and enrollment digests bind every field", () => {
    const base = {
      origin: LOBBY_ORIGIN, method: "POST" as const, target: `/v1/collaboration/missions/${UUID_A}/events`, missionId: UUID_A,
      grantId: UUID_B, identityId: UUID_A, keyId: UUID_B, body: "{}", timestamp: T,
    };
    const digest = requestDigest(base);
    expect(digest).toHaveLength(32);
    for (const patch of [{ body: "{} " }, { timestamp: LATER(1) }, { method: "GET" as const }, { grantId: UUID_A }]) {
      expect(requestDigest({ ...base, ...patch }).equals(digest)).toBe(false);
    }
    expect(errorCode(() => requestDigest({ ...base, target: "/v1/elsewhere" }))).toBe("invalid_request_target");
    const enrollment = enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: UUID_A, bodyBytes: Buffer.from("{}") });
    expect(enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: UUID_B, bodyBytes: Buffer.from("{}") }).equals(enrollment)).toBe(false);
  });

  test("a door key is named in descriptors by fingerprint and key digest, and as a did:key in the pin book", () => {
    const door = signer();
    const resource = doorResource({ public_key: door.publicKey, fingerprint: door.fingerprint });
    expect(resource.uri).toBe(`urn:agenttool-lobby:door:${door.fingerprint}`);
    expect(resource.digest).toBe(`sha256:${sha256HexOf(Buffer.from(door.publicKey, "base64"))}`);
    const descriptor = validateMissionDescriptor({
      format: "agenttool-collaboration-mission/v1", purpose: "p", resources: [resource], acceptance_criteria: ["c"], principalities: [],
    });
    expect(namesDoor(descriptor, { public_key: door.publicKey, fingerprint: door.fingerprint })).toBe(true);
    const other = signer();
    expect(namesDoor(descriptor, { public_key: other.publicKey, fingerprint: other.fingerprint })).toBe(false);
    expect(didKeyOf(door.publicKey)).toMatch(/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]+$/);
  });
});

describe("signed lobby documents", () => {
  test("seal, open and verify; any change to the body or signer breaks verification", () => {
    const door = signer();
    const { envelope, summary } = sealDocument("card", card, door);
    expect(summary).toBe(wireCanonicalJson(envelope));
    expect(summary).toMatch(/^\{"body":/);
    expect(envelope.sig).toMatch(/^[0-9a-f]{128}$/);
    const opened = openDocument(summary)!;
    expect(opened).toEqual(envelope);
    expect(verifyDocument(opened, door.publicKey)).toBe(true);
    expect(verifyDocument({ ...opened, body: { ...card, title: "Changed" } }, door.publicKey)).toBe(false);
    expect(verifyDocument({ ...opened, kind: "roster" }, door.publicKey)).toBe(false);
    expect(verifyDocument(opened, signer().publicKey)).toBe(false);
    expect(documentSha256(summary)).toBe(sha256HexOf(summary));
  });

  test("ordinary text is not a document; malformed documents are refused", () => {
    expect(openDocument("hello")).toBeNull();
    expect(openDocument('{"format":"agenttool-mission-chat/v1"}')).toBeNull();
    const { summary } = sealDocument("card", card, signer());
    const spaced = summary.replace('"body":{', '"body": {');
    expect(errorCode(() => openDocument(spaced))).toBe("invalid_json");
    const extra = JSON.parse(summary);
    extra.body.house_rules = "x";
    expect(errorCode(() => openDocument(wireCanonicalJson(extra)))).toBe("invalid_signed_document");
  });

  test("bodies are validated by kind, including lifetimes", () => {
    const desk = signer();
    const knock: KnockBody = {
      knock_id: UUID_A, room_id: ROOM, charter_digest: `sha256:${"c".repeat(64)}`, tier: "player", token_sha256: "d".repeat(64),
      note: "", issued_at: T, expires_at: LATER(72 * 3_600_000),
    };
    expect(sealDocument("knock", knock, desk).summary.length).toBeLessThan(1000);
    expect(errorCode(() => sealDocument("knock", { ...knock, expires_at: LATER(72 * 3_600_000 + 1) }, desk))).toBe("invalid_signed_document");
    expect(errorCode(() => sealDocument("knock", { ...knock, note: "x".repeat(281) }, desk))).toBe("invalid_note");
    expect(errorCode(() => sealDocument("knock", { ...knock, note: "a‮b" }, desk))).toBe("invalid_note");
    const admission: AdmissionBody = {
      knock_id: UUID_A, room_id: ROOM, mission_id: UUID_A, mission_digest: `sha256:${"c".repeat(64)}`, identity_id: UUID_A,
      signing_key_id: UUID_B, tier: "player", grant: { grant_id: UUID_B, expires_at: LATER(3_600_000), token_sha256: "d".repeat(64) },
      term_ends_at: LATER(7 * 86_400_000), issued_at: T, expires_at: LATER(86_400_000),
    };
    expect(sealDocument("admission", admission, desk).summary.length).toBeLessThanOrEqual(1000);
    expect(errorCode(() => sealDocument("admission", { ...admission, expires_at: LATER(86_400_001) }, desk))).toBe("invalid_signed_document");
    expect(errorCode(() => sealDocument("admission", { ...admission, grant: { ...admission.grant, expires_at: LATER(86_400_001) } }, desk)))
      .toBe("invalid_signed_document");
    expect(errorCode(() => sealDocument("admission", { ...admission, term_ends_at: LATER(60_000) }, desk))).toBe("invalid_signed_document");
    const roster: RosterBody = { room_id: ROOM, mission_id: UUID_A, members: [{ identity_id: UUID_A, tier: "player", term_ends_at: T }], part: 1, parts: 1, issued_at: T };
    expect(errorCode(() => sealDocument("roster", { ...roster, members: [...roster.members, ...roster.members] }, desk))).toBe("invalid_signed_document");
    expect(errorCode(() => sealDocument("roster", { ...roster, part: 2 }, desk))).toBe("invalid_signed_document");
    // A full roster part, signature included, fits one observation.
    const full = Array.from({ length: ROSTER_PART_MEMBERS }, (_, index) => ({
      identity_id: `${String(index).repeat(8)}-1111-4111-8111-111111111111`, tier: "spectator" as const, term_ends_at: T,
    }));
    expect([...sealDocument("roster", { ...roster, members: full, part: 3, parts: 3 }, desk).summary].length).toBeLessThanOrEqual(1000);
    expect(errorCode(() => sealDocument("card", { ...card, residency: "device" as "fleet" }, desk))).toBe("invalid_signed_document");
  });

  test("a document that would not fit one observation is refused, signature included", () => {
    const tooLong = { ...card, purpose: "a quiet sentence. ".repeat(40) };
    expect(errorCode(() => sealDocument("card", tooLong, signer()))).toBe("document_too_large");
  });

  test("the fleet reader keeps only door-signed documents and labels the rest unverified", () => {
    const door = signer();
    const event = (summary: string, seq: number) => {
      const raw = JSON.stringify({ event_id: UUID_A, summary });
      return {
        event_id: UUID_A, mission_id: UUID_B, grant_id: UUID_A, identity_id: UUID_A, signing_key_id: UUID_B,
        received_seq: String(seq), received_at: T, raw_body: raw, body_sha256: sha256HexOf(raw), proof: {},
      };
    };
    const genuine = sealDocument("card", card, door).summary;
    const forged = sealDocument("card", { ...card, card_seq: 2, title: "forged" }, { ...signer(), fingerprint: door.fingerprint }).summary;
    const view = readFleetEvents([event(genuine, 1), event(forged, 2), event("plain chat", 3), event('{"body":{},"format":"agenttool-lobby-signed/v1"}', 4)],
      { fingerprint: door.fingerprint, public_key: door.publicKey });
    expect([...view.cards.values()].map((document) => document.envelope.body.title)).toEqual(["Zerone season 1"]);
    expect(view.unverified.map((entry) => entry.reason)).toEqual(["bad_signature", "malformed_document"]);
    expect(readFleetEvents([event(genuine, 1)], null).unverified[0]!.reason).toBe("door_not_pinned");
  });
});

describe("carried packets", () => {
  const desk = signer();
  const facts = {
    project_id: UUID_A, identity_id: UUID_B, signing_key_id: "33333333-3333-4333-8333-333333333333",
    public_key: desk.publicKey, fingerprint: desk.fingerprint, display_name: "desk 0001",
  };
  const now = new Date(T);

  test("an enrollment packet carries a server-shaped, signed identity-enrollment/v1 request", () => {
    const packet = buildEnrollmentPacket({ kind: "enroll", desk: facts, key: desk.privateKey, directoryTokenSha256: "e".repeat(64), now });
    const parsed = parseEnrollmentPacket(JSON.stringify(packet), now);
    expect(parsed).toEqual(packet);
    const request = parsed.enrollment_request!;
    expect(request).toMatchObject({ format: "agenttool-identity-enrollment-request/v1", origin: LOBBY_ORIGIN, method: "POST", request_target: "/v1/identities/enroll" });
    const body = JSON.parse(request.body_utf8);
    expect(Object.keys(body)).toEqual(["format", "origin", "project_id", "identity_id", "signing_key_id", "display_name", "capabilities", "public_key", "nonce", "timestamp"]);
    expect(body.capabilities).toEqual([]);
    const signature = Buffer.from(request.headers["X-Agenttool-Enrollment-Signature"], "base64url");
    expect(verifyBytes(desk.publicKey, enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: UUID_A, bodyBytes: Buffer.from(request.body_utf8) }), signature)).toBe(true);
    expect(Date.parse(packet.valid_until) - Date.parse(packet.issued_at)).toBe(5 * 60_000);
    expect(JSON.stringify(packet)).not.toMatch(/atcm_|PRIVATE KEY/);
  });

  test("tampering, staleness and non-neutral profiles are refused", () => {
    const packet = buildEnrollmentPacket({ kind: "enroll", desk: facts, key: desk.privateKey, directoryTokenSha256: "e".repeat(64), now });
    const later = new Date(Date.parse(T) + 5 * 60_000 + 1);
    expect(errorCode(() => parseEnrollmentPacket(JSON.stringify(packet), later))).toBe("packet_expired");
    expect(errorCode(() => parseEnrollmentPacket(JSON.stringify({ ...packet, directory_token_sha256: "f".repeat(64) }), now))).toBe("invalid_packet");
    const body = JSON.parse(packet.enrollment_request!.body_utf8);
    const withCapability = JSON.stringify({ ...body, capabilities: ["mission.read"] });
    expect(errorCode(() => parseEnrollmentPacket(JSON.stringify({ ...packet, enrollment_request: { ...packet.enrollment_request, body_utf8: withCapability } }), now)))
      .toBe("invalid_packet");
    expect(errorCode(() => parseEnrollmentPacket(JSON.stringify({ ...packet, kind: "renew" }), now))).toBe("invalid_packet");
    const renew = buildEnrollmentPacket({ kind: "renew", desk: facts, key: desk.privateKey, directoryTokenSha256: "e".repeat(64), now });
    expect(parseEnrollmentPacket(JSON.stringify(renew), new Date(Date.parse(T) + 29 * 60_000)).enrollment_request).toBeNull();
    expect(errorCode(() => parseEnrollmentPacket(JSON.stringify({ ...renew, enrollment_request: packet.enrollment_request }), now))).toBe("invalid_packet");
  });

  test("a join packet's door fingerprint must match its key, and its template the directory", () => {
    const door = signer();
    const join = {
      format: "agenttool-lobby-join/v1", origin: LOBBY_ORIGIN, project_id: UUID_A,
      door: { public_key: door.publicKey, fingerprint: door.fingerprint },
      directory: { mission_id: UUID_A, mission_digest: `sha256:${"c".repeat(64)}` },
      invitation_template: {
        format: "agenttool-mission-invitation-template/v1", origin: LOBBY_ORIGIN, mission_id: UUID_A, grant_id: UUID_B,
        identity_id: UUID_B, signing_key_id: UUID_A, public_key: desk.publicKey, expires_at: T, token_sha256: "e".repeat(64),
      },
    };
    expect(parseJoinPacket(JSON.stringify(join)).door.fingerprint).toBe(door.fingerprint);
    expect(errorCode(() => parseJoinPacket(JSON.stringify({ ...join, door: { ...join.door, fingerprint: "0".repeat(16) } })))).toBe("invalid_packet");
    expect(errorCode(() => parseJoinPacket(JSON.stringify({ ...join, invitation_template: { ...join.invitation_template, mission_id: UUID_B } })))).toBe("invalid_packet");
    expect(errorCode(() => parseJoinPacket(JSON.stringify({ ...join, invitation_template: { ...join.invitation_template, token: "atcm_x" } })))).toBe("invalid_packet");
  });
});
