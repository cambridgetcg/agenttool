/** Pure checks of table talk and the PR 8 signed kinds: exact chat envelope
 * bytes, the size limit, the hex-only key encoding the egress gate needs,
 * roster completeness, replay and conflicts, the cursor rule and the
 * destination rule. No I/O. */
import { describe, expect, test } from "bun:test";
import { checkEgress } from "../src/egress.js";
import { LobbyError } from "../src/errors.js";
import type { VerifiedDocument } from "../src/fleet.js";
import {
  invitationTemplateOf,
  KEYED_ROSTER_PART_MEMBERS,
  openDocument,
  publicKeyFromHex,
  publicKeyHexOf,
  sealDocument,
  type MemberRosterBody,
  type RenewalBody,
} from "../src/signed.js";
import { buildChatEnvelope, chatConfigOf, parseChatEnvelope, readTable, resolveDestination, tableRoster } from "../src/table.js";
import { generateKeyPair, publicKeyBase64, publicKeyFingerprint, requestDigest, sha256HexOf, signBytes, type MissionEvent } from "../src/wire.js";

const ROOM = `room_${"ab".repeat(16)}`;
const MISSION = "11111111-1111-4111-8111-111111111111";
const T0 = "2026-10-16T12:00:00.000Z";
const LATER = "2026-11-01T12:00:00.000Z";

function codeOf(run: () => unknown): string | null {
  try {
    run();
  } catch (error) {
    if (error instanceof LobbyError) return error.code;
    throw error;
  }
  return null;
}

function keyed() {
  const key = generateKeyPair();
  const publicKey = publicKeyBase64(key);
  return { key, publicKey, fingerprint: publicKeyFingerprint(publicKey), identity_id: crypto.randomUUID(), signing_key_id: crypto.randomUUID() };
}

const door = keyed();

function rosterDoc(seq: number, members: Array<ReturnType<typeof keyed>>, part = 1, parts = 1, issued = T0): VerifiedDocument<MemberRosterBody> {
  const body: MemberRosterBody = {
    room_id: ROOM, mission_id: MISSION, roster_seq: seq, part, parts, issued_at: issued,
    members: members.map((member, index) => ({
      identity_id: member.identity_id, signing_key_id: member.signing_key_id, public_key_hex: publicKeyHexOf(member.publicKey),
      tier: "player", role: index === 0 && seq > 0 ? "member" : "member", term_ends_at: LATER,
    })),
  };
  const sealed = sealDocument("member_roster", body, { privateKey: door.key, fingerprint: door.fingerprint });
  return { envelope: sealed.envelope, summary: sealed.summary, event: { mission_id: MISSION } as MissionEvent };
}

/** A chat event signed by `member` with a valid exact-request proof. */
function chatEvent(seq: number, member: ReturnType<typeof keyed>, summary: string): MissionEvent {
  const eventId = crypto.randomUUID();
  const raw = JSON.stringify({ event_id: eventId, summary });
  const grantId = crypto.randomUUID();
  const target = `/v1/collaboration/missions/${MISSION}/events`;
  const signature = signBytes(member.key, requestDigest({
    origin: "https://api.agenttool.dev", method: "POST", target, missionId: MISSION, grantId, identityId: member.identity_id,
    keyId: member.signing_key_id, body: raw, timestamp: T0,
  })).toString("base64url");
  return {
    event_id: eventId, mission_id: MISSION, grant_id: grantId, identity_id: member.identity_id, signing_key_id: member.signing_key_id,
    received_seq: String(seq), received_at: T0, raw_body: raw, body_sha256: sha256HexOf(raw),
    proof: {
      domain: "agenttool-collaboration-request/v1", origin: "https://api.agenttool.dev", method: "POST", request_target: target,
      timestamp: T0, signature, public_key: member.publicKey, raw_body: raw, body_sha256: sha256HexOf(raw),
    },
  };
}

function rosterEvent(seq: number, document: VerifiedDocument<MemberRosterBody>, poster: ReturnType<typeof keyed>): MissionEvent {
  return chatEvent(seq, poster, document.summary);
}

describe("the agenttool-mission-chat/v1 envelope", () => {
  test("is built in the participant client's key order and parsed back", () => {
    const to = crypto.randomUUID();
    const reply = crypto.randomUUID();
    const { summary } = buildChatEnvelope({ conversation: "table", to_identity: to, kind: "read_ack", text: "read", in_reply_to: reply });
    expect(summary).toBe(`{"format":"agenttool-mission-chat/v1","conversation":"table","to_identity":"${to}","kind":"read_ack","text":"read","in_reply_to":"${reply}"}`);
    expect(parseChatEnvelope(summary)).toEqual({ envelope: JSON.parse(summary) });
    expect(parseChatEnvelope("plain text")).toBeNull();
    expect(parseChatEnvelope('{"format":"agenttool-lobby-signed/v1"}')).toBeNull();
    expect(parseChatEnvelope(`{"format":"agenttool-mission-chat/v1","conversation":"table","to_identity":"${to}","kind":"read_ack","text":"x"}`)).toEqual({ malformed: true });
  });

  test("refuses what the terminal could not show, a read_ack without a reference, and oversize envelopes", () => {
    const to = crypto.randomUUID();
    const build = (text: string, extra: Record<string, unknown> = {}) => codeOf(() => buildChatEnvelope({ conversation: "table", to_identity: to, kind: "message", text, ...extra }));
    expect(build("bidi ‮ text")).toBe("invalid_text");
    expect(build("zero​width")).toBe("invalid_text");
    expect(build("")).toBe("invalid_text");
    expect(build("x".repeat(1001))).toBe("invalid_text");
    expect(build("x".repeat(900))).toBe("message_too_long"); // the whole envelope shares the 1000-scalar limit
    expect(build("a line\nanother line")).toBeNull();
    expect(codeOf(() => buildChatEnvelope({ conversation: "table", to_identity: to, kind: "read_ack", text: "read" }))).toBe("read_ack_needs_reference");
    expect(codeOf(() => buildChatEnvelope({ conversation: "-bad", to_identity: to, kind: "message", text: "x" }))).toBe("invalid_conversation");
  });
});

describe("the new signed kinds", () => {
  test("keyed roster parts, renewals and notes fit one observation and pass the gate: keys travel as hex", () => {
    const members = Array.from({ length: KEYED_ROSTER_PART_MEMBERS }, () => keyed());
    const roster = rosterDoc(7, members, 64, 64);
    expect([...roster.summary].length).toBeLessThanOrEqual(1000);
    const renewal: RenewalBody = {
      room_id: ROOM, tier: "spectator", term_ends_at: LATER, issued_at: T0,
      invitation: {
        mission_id: MISSION, grant_id: crypto.randomUUID(), identity_id: members[0]!.identity_id, signing_key_id: members[0]!.signing_key_id,
        public_key_hex: publicKeyHexOf(members[0]!.publicKey), expires_at: "2026-10-17T11:59:00.000Z", token_sha256: "e".repeat(64),
      },
    };
    const sealed = sealDocument("renewal", renewal, { privateKey: door.key, fingerprint: door.fingerprint });
    expect([...sealed.summary].length).toBeLessThanOrEqual(1000);
    for (const summary of [roster.summary, sealed.summary]) {
      expect(checkEgress(summary, { room: { residency: "fleet" }, deviceTerms: ["example-lab-desk"] })).toEqual({ ok: true, reasons: [] });
    }
    // The same key in base64 would be refused by the gate: that is why documents carry hex.
    expect(checkEgress(`{"public_key":"${members[0]!.publicKey}"}`, { room: { residency: "fleet" } }).reasons).toContain("key_like_base64");
    // The template a renewal carries is the participant client's, byte for byte, with the base64 key restored.
    const template = invitationTemplateOf(openDocument(sealed.summary)!.body as RenewalBody);
    expect(Object.keys(template)).toEqual(["format", "origin", "mission_id", "grant_id", "identity_id", "signing_key_id", "public_key", "expires_at", "token_sha256"]);
    expect(template.public_key).toBe(members[0]!.publicKey);
    expect(publicKeyFromHex(publicKeyHexOf(members[0]!.publicKey))).toBe(members[0]!.publicKey);
  });

  test("validators refuse bad shapes", () => {
    const member = keyed();
    const seal = (kind: "renew" | "renewal" | "member_roster" | "leave", body: unknown) => codeOf(() => sealDocument(kind, body as never, { privateKey: member.key, fingerprint: member.fingerprint }));
    const renew = { room_id: ROOM, mission_id: MISSION, identity_id: member.identity_id, signing_key_id: member.signing_key_id, token_sha256: "a".repeat(64), issued_at: T0, expires_at: "2026-10-17T12:00:00.000Z" };
    expect(seal("renew", renew)).toBeNull();
    expect(seal("renew", { ...renew, expires_at: "2026-10-17T12:00:00.001Z" })).toBe("invalid_signed_document"); // over 24 hours
    expect(seal("renew", { ...renew, token_sha256: "A".repeat(64) })).toBe("invalid_signed_document");
    expect(seal("leave", { room_id: ROOM, mission_id: MISSION, identity_id: member.identity_id, signing_key_id: member.signing_key_id, issued_at: T0, extra: 1 })).toBe("invalid_signed_document");
    const roster = { room_id: ROOM, mission_id: MISSION, roster_seq: 1, part: 1, parts: 1, issued_at: T0,
      members: [{ identity_id: member.identity_id, signing_key_id: member.signing_key_id, public_key_hex: member.publicKey, tier: "player", role: "member", term_ends_at: LATER }] };
    expect(seal("member_roster", roster)).toBe("invalid_signed_document"); // base64 where hex belongs
    expect(seal("member_roster", { ...roster, roster_seq: 0, members: [] })).toBe("invalid_signed_document");
  });
});

describe("pins from door-signed keyed rosters", () => {
  test("the highest complete sequence is current; incomplete or inconsistent ones never count", () => {
    const [a, b, c] = [keyed(), keyed(), keyed()];
    const first = rosterDoc(1, [a!, b!]);
    const second = rosterDoc(2, [a!]);
    // Seq 3 claims two parts and only one arrives: it does not count.
    const partial = rosterDoc(3, [c!], 1, 2);
    const roster = tableRoster([second, first, partial, first], { mission_id: MISSION, room_id: ROOM });
    expect(roster.roster_seq).toBe(2);
    expect(roster.members.map((member) => member.identity_id)).toEqual([a!.identity_id]);
    expect(roster.pins.get(b!.identity_id)?.current).toBe(false); // a former member stays pinned for old messages
    expect(roster.pins.has(c!.identity_id)).toBe(false);
    // Another key for the same identity in a later roster: that identity is never verified.
    const swapped = { ...a!, ...keyed(), identity_id: a!.identity_id };
    expect(tableRoster([first, rosterDoc(4, [swapped])], { mission_id: MISSION, room_id: ROOM }).conflicted).toEqual([a!.identity_id]);
    // Rosters of another room or mission are ignored.
    expect(tableRoster([first], { mission_id: MISSION, room_id: `room_${"cd".repeat(16)}` }).roster_seq).toBeNull();
  });

  test("readTable verifies senders by pin and proof, and never moves the cursor past an unreturned item", () => {
    const [host, member, stranger] = [keyed(), keyed(), keyed()];
    const roster = rosterDoc(1, [host!, member!]);
    const say = (from: ReturnType<typeof keyed>, text: string) =>
      JSON.stringify({ format: "agenttool-mission-chat/v1", conversation: "table", to_identity: host!.identity_id, kind: "message", text });
    const events = [
      rosterEvent(1, roster, host!),
      chatEvent(2, member!, say(member!, "one")),
      chatEvent(3, stranger!, say(stranger!, "let me in")),
      chatEvent(4, member!, JSON.stringify({ format: "agenttool-mission-chat/v1", conversation: "elsewhere", to_identity: host!.identity_id, kind: "message", text: "other room talk" })),
      chatEvent(5, member!, say(member!, "two")),
      chatEvent(6, member!, say(member!, "three")),
    ];
    const tampered = { ...events[5]!, proof: { ...events[5]!.proof, signature: Buffer.alloc(64).toString("base64url") } };
    const input = { mission_id: MISSION, room_id: ROOM, door: { fingerprint: door.fingerprint, public_key: door.publicKey }, me: host!, conversation: "table" };
    const page = readTable([...events.slice(0, 5), tampered], { ...input, after: "0", limit: 2 });
    expect(page.messages.map((message) => message.text)).toEqual(["one"]);
    expect(page.unverified.map((item) => item.reason)).toEqual(["sender_not_on_roster"]);
    expect(page.next_cursor).toBe("3");
    expect(page.has_more).toBe(true);
    const rest = readTable([...events.slice(0, 5), tampered], { ...input, after: page.next_cursor, limit: 20 });
    expect(rest.messages.map((message) => message.text)).toEqual(["two"]);
    expect(rest.unverified.map((item) => item.reason)).toEqual(["bad_proof"]);
    expect(rest.other_conversations).toBe(1);
    expect(rest.next_cursor).toBe("6");
    // Without the pinned door key, nothing is verified.
    expect(readTable(events, { ...input, door: null, after: "0", limit: 20 }).unverified.map((item) => item.reason)).toEqual(Array(4).fill("door_not_pinned"));
  });

  test("destinations: the chosen current member, the sender of the message answered, or the only other member", () => {
    const [me, other, third] = [keyed(), keyed(), keyed()];
    const two = tableRoster([rosterDoc(1, [me!, other!])], { mission_id: MISSION, room_id: ROOM });
    expect(resolveDestination(two, me!, {}).identity_id).toBe(other!.identity_id);
    expect(codeOf(() => resolveDestination(two, me!, { to: me!.identity_id }))).toBe("to_is_self");
    expect(codeOf(() => resolveDestination(two, me!, { to: third!.identity_id }))).toBe("to_not_member");
    const three = tableRoster([rosterDoc(1, [me!, other!, third!].slice(0, 2)), rosterDoc(2, [me!, other!]), rosterDoc(3, [me!, third!])], { mission_id: MISSION, room_id: ROOM });
    expect(resolveDestination(three, me!, {}).identity_id).toBe(third!.identity_id);
    const config = chatConfigOf(three, { mission_digest: `sha256:${"0".repeat(64)}`, conversation: "table", me: me!, expires_at: LATER });
    expect(config).toEqual({
      format: "agenttool-mission-chat-config/v1", mission_digest: `sha256:${"0".repeat(64)}`, conversation: "table", expires_at: LATER,
      peers: [{ identity_id: third!.identity_id, signing_key_id: third!.signing_key_id, public_key: third!.publicKey }],
    });
  });
});
