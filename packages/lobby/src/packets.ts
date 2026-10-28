/** The two public packets a person carries between devices.
 *
 * - `agenttool-lobby-enrollment-packet/v1` (device → hub): this desk's public
 *   identity, the SHA-256 of a directory token generated on the device, and,
 *   for a first enrollment, a signed `identity-enrollment/v1` request in the
 *   participant client's `enroll-proof` format. The desk key signs the whole
 *   packet, so the token hash cannot be swapped in transit. Valid 5 minutes
 *   (the service's enrollment window); a renewal packet is valid 30 minutes.
 * - `agenttool-lobby-join/v1` (hub → device): the door's public key and
 *   fingerprint, the directory mission id and digest, and a token-free
 *   `agenttool-mission-invitation-template/v1`.
 *
 * Neither packet holds a secret. The door fingerprint the device pins must
 * also be typed by the person (`fleet join --door-fingerprint`), read from the
 * hub's terminal; room content never supplies a pin.
 */
import { randomBytes, type KeyObject } from "node:crypto";
import { LobbyError } from "./errors.js";
import type { EnrollmentRequest } from "./hosted.js";
import { checkText } from "./text.js";
import {
  assertCanonicalTime,
  assertDigest,
  assertUuid,
  ENROLLMENT_BODY_FORMAT,
  ENROLLMENT_LIMITS,
  ENROLLMENT_PATH,
  ENROLLMENT_REQUEST_FORMAT,
  ENROLLMENT_SIGNATURE_HEADER,
  enrollmentDigest,
  INVITATION_TEMPLATE_FORMAT,
  isCanonicalBase64,
  isCanonicalTime,
  isSha256Hex,
  LOBBY_ORIGIN,
  publicKeyFingerprint,
  rawPublicKey,
  sha256Bytes,
  sha256HexOf,
  signBytes,
  verifyBytes,
  wireCanonicalJson,
  type MissionDescriptor,
  type MissionReference,
} from "./wire.js";

export const ENROLLMENT_PACKET_FORMAT = "agenttool-lobby-enrollment-packet/v1" as const;
export const JOIN_PACKET_FORMAT = "agenttool-lobby-join/v1" as const;
export const ENROLL_PACKET_MS = 5 * 60_000;
export const RENEW_PACKET_MS = 30 * 60_000;
export const DOOR_RESOURCE_FORMAT = "agenttool-lobby-door/v1";
export const DIRECTORY_REF_FORMAT = "agenttool-lobby-directory-ref/v1";
const RESERVED_IDS = new Set(["00000000-0000-0000-0000-000000000000", "ffffffff-ffff-ffff-ffff-ffffffffffff"]);

export interface EnrollmentPacket {
  format: typeof ENROLLMENT_PACKET_FORMAT;
  kind: "enroll" | "renew";
  origin: string;
  project_id: string;
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  fingerprint: string;
  display_name: string;
  directory_token_sha256: string;
  issued_at: string;
  valid_until: string;
  enrollment_request: EnrollmentRequest | null;
  packet_sig: string;
}

function exact(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw new LobbyError("invalid_packet", `${what} does not have exactly the expected fields`);
  }
  return value as Record<string, unknown>;
}

function packetDigest(packet: Omit<EnrollmentPacket, "packet_sig">): Buffer {
  return sha256Bytes(`${ENROLLMENT_PACKET_FORMAT}\0${wireCanonicalJson(packet)}`);
}

export interface DeskFacts {
  project_id: string;
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  fingerprint: string;
  display_name: string;
}

/** The exact enrollment body the service signs over, in the participant
 * client's field order. */
function enrollmentBody(desk: DeskFacts, now: Date): string {
  return JSON.stringify({
    format: ENROLLMENT_BODY_FORMAT,
    origin: LOBBY_ORIGIN,
    project_id: desk.project_id,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    display_name: desk.display_name,
    capabilities: [],
    public_key: desk.public_key,
    nonce: randomBytes(32).toString("base64url"),
    timestamp: now.toISOString(),
  });
}

export function buildEnrollmentPacket(input: {
  kind: "enroll" | "renew";
  desk: DeskFacts;
  key: KeyObject;
  directoryTokenSha256: string;
  now: Date;
}): EnrollmentPacket {
  const { desk, key, now } = input;
  let request: EnrollmentRequest | null = null;
  if (input.kind === "enroll") {
    const body = enrollmentBody(desk, now);
    const signature = signBytes(key, enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: desk.project_id, bodyBytes: Buffer.from(body) }));
    request = {
      format: ENROLLMENT_REQUEST_FORMAT,
      origin: LOBBY_ORIGIN,
      method: "POST",
      request_target: ENROLLMENT_PATH,
      body_utf8: body,
      headers: { "Content-Type": "application/json", [ENROLLMENT_SIGNATURE_HEADER]: signature.toString("base64url") },
    };
  }
  const unsigned: Omit<EnrollmentPacket, "packet_sig"> = {
    format: ENROLLMENT_PACKET_FORMAT,
    kind: input.kind,
    origin: LOBBY_ORIGIN,
    project_id: desk.project_id,
    identity_id: desk.identity_id,
    signing_key_id: desk.signing_key_id,
    public_key: desk.public_key,
    fingerprint: desk.fingerprint,
    display_name: desk.display_name,
    directory_token_sha256: input.directoryTokenSha256,
    issued_at: now.toISOString(),
    valid_until: new Date(now.getTime() + (input.kind === "enroll" ? ENROLL_PACKET_MS : RENEW_PACKET_MS)).toISOString(),
    enrollment_request: request,
  };
  return { ...unsigned, packet_sig: signBytes(key, packetDigest(unsigned)).toString("hex") };
}

function parseEnrollmentRequest(value: unknown, packet: Record<string, unknown>, now: Date): EnrollmentRequest {
  const request = exact(value, ["format", "origin", "method", "request_target", "body_utf8", "headers"], "enrollment request");
  const headers = exact(request.headers, ["Content-Type", ENROLLMENT_SIGNATURE_HEADER], "enrollment headers");
  if (request.format !== ENROLLMENT_REQUEST_FORMAT || request.origin !== LOBBY_ORIGIN || request.method !== "POST"
    || request.request_target !== ENROLLMENT_PATH || headers["Content-Type"] !== "application/json"
    || !isCanonicalBase64(headers[ENROLLMENT_SIGNATURE_HEADER], 64, "base64url")
    || typeof request.body_utf8 !== "string" || Buffer.byteLength(request.body_utf8) > ENROLLMENT_LIMITS.maxBytes) {
    throw new LobbyError("invalid_packet", "the enrollment request is not an identity-enrollment/v1 request for the pinned origin");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(request.body_utf8);
  } catch {
    throw new LobbyError("invalid_packet", "the enrollment body is not JSON");
  }
  const body = exact(parsed, ["format", "origin", "project_id", "identity_id", "signing_key_id", "display_name",
    "capabilities", "public_key", "nonce", "timestamp"], "enrollment body");
  // The body must be exactly what a desk serializes: no duplicate keys, no
  // whitespace, the participant client's field order.
  const rebuilt = JSON.stringify({
    format: body.format, origin: body.origin, project_id: body.project_id, identity_id: body.identity_id,
    signing_key_id: body.signing_key_id, display_name: body.display_name, capabilities: body.capabilities,
    public_key: body.public_key, nonce: body.nonce, timestamp: body.timestamp,
  });
  if (rebuilt !== request.body_utf8 || body.format !== ENROLLMENT_BODY_FORMAT || body.origin !== LOBBY_ORIGIN
    || body.project_id !== packet.project_id || body.identity_id !== packet.identity_id
    || body.signing_key_id !== packet.signing_key_id || body.display_name !== packet.display_name
    || !Array.isArray(body.capabilities) || body.capabilities.length !== 0 || body.public_key !== packet.public_key
    || !isCanonicalBase64(body.nonce, 32, "base64url") || !isCanonicalTime(body.timestamp)
    || RESERVED_IDS.has(String(body.identity_id)) || RESERVED_IDS.has(String(body.signing_key_id))) {
    throw new LobbyError("invalid_packet", "the enrollment body does not match the packet's project, identity, key and neutral profile");
  }
  if (Math.abs(now.getTime() - Date.parse(body.timestamp as string)) > ENROLLMENT_LIMITS.windowMs) {
    throw new LobbyError("packet_expired", "the signed enrollment is outside its 5-minute window; run enroll-device on the device again");
  }
  const signature = Buffer.from(headers[ENROLLMENT_SIGNATURE_HEADER] as string, "base64url");
  const digest = enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: packet.project_id as string, bodyBytes: Buffer.from(request.body_utf8) });
  if (!verifyBytes(packet.public_key as string, digest, signature)) {
    throw new LobbyError("invalid_packet", "the enrollment signature does not verify against the packet's public key");
  }
  return request as unknown as EnrollmentRequest;
}

/** Strictly parse and verify a carried enrollment packet. */
export function parseEnrollmentPacket(text: string, now: Date): EnrollmentPacket {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LobbyError("invalid_packet", "the packet is not JSON");
  }
  const packet = exact(value, ["format", "kind", "origin", "project_id", "identity_id", "signing_key_id", "public_key",
    "fingerprint", "display_name", "directory_token_sha256", "issued_at", "valid_until", "enrollment_request",
    "packet_sig"], "enrollment packet");
  if (packet.format !== ENROLLMENT_PACKET_FORMAT || (packet.kind !== "enroll" && packet.kind !== "renew")) {
    throw new LobbyError("invalid_packet", `expected an ${ENROLLMENT_PACKET_FORMAT} packet`);
  }
  if (packet.origin !== LOBBY_ORIGIN) throw new LobbyError("invalid_packet", `the packet names an origin other than ${LOBBY_ORIGIN}`);
  assertUuid(packet.project_id, "project_id");
  assertUuid(packet.identity_id, "identity_id");
  assertUuid(packet.signing_key_id, "signing_key_id");
  rawPublicKey(packet.public_key as string);
  if (packet.fingerprint !== publicKeyFingerprint(packet.public_key as string)) {
    throw new LobbyError("invalid_packet", "the packet fingerprint does not match its public key");
  }
  checkText(packet.display_name, { field: "display_name", min: 1, max: ENROLLMENT_LIMITS.displayName });
  if (!isSha256Hex(packet.directory_token_sha256)) throw new LobbyError("invalid_packet", "directory_token_sha256 must be 64 lowercase hex");
  const issued = Date.parse(assertCanonicalTime(packet.issued_at, "issued_at"));
  const until = Date.parse(assertCanonicalTime(packet.valid_until, "valid_until"));
  const window = packet.kind === "enroll" ? ENROLL_PACKET_MS : RENEW_PACKET_MS;
  if (until <= issued || until - issued > window) throw new LobbyError("invalid_packet", "the packet validity window is wrong");
  if (now.getTime() > until || issued > now.getTime() + 60_000) {
    throw new LobbyError("packet_expired", "this packet is no longer valid; run enroll-device on the device again");
  }
  if (typeof packet.packet_sig !== "string" || !/^[0-9a-f]{128}$/.test(packet.packet_sig)) {
    throw new LobbyError("invalid_packet", "packet_sig must be 128 lowercase hex");
  }
  const request = packet.kind === "enroll"
    ? parseEnrollmentRequest(packet.enrollment_request, packet, now)
    : packet.enrollment_request === null ? null : (() => {
      throw new LobbyError("invalid_packet", "a renewal packet carries no enrollment request");
    })();
  const parsed: EnrollmentPacket = {
    format: ENROLLMENT_PACKET_FORMAT,
    kind: packet.kind,
    origin: LOBBY_ORIGIN,
    project_id: packet.project_id as string,
    identity_id: packet.identity_id as string,
    signing_key_id: packet.signing_key_id as string,
    public_key: packet.public_key as string,
    fingerprint: packet.fingerprint as string,
    display_name: packet.display_name as string,
    directory_token_sha256: packet.directory_token_sha256,
    issued_at: packet.issued_at as string,
    valid_until: packet.valid_until as string,
    enrollment_request: request,
    packet_sig: packet.packet_sig,
  };
  const { packet_sig: _signature, ...unsigned } = parsed;
  if (!verifyBytes(parsed.public_key, packetDigest(unsigned), Buffer.from(parsed.packet_sig, "hex"))) {
    throw new LobbyError("invalid_packet", "the packet signature does not verify against its public key");
  }
  return parsed;
}

// ── Door resource in mission descriptors ───────────────────────────────

export interface DoorKey {
  public_key: string;
  fingerprint: string;
}

/** A descriptor resource naming the door key: a URN with its fingerprint
 * and the SHA-256 of the raw key. Accepting the descriptor's digest commits
 * a device to this door key. */
export function doorResource(door: DoorKey): MissionReference {
  return {
    uri: `urn:agenttool-lobby:door:${door.fingerprint}`,
    format: DOOR_RESOURCE_FORMAT,
    digest: `sha256:${sha256HexOf(rawPublicKey(door.public_key))}`,
  };
}

export function namesDoor(descriptor: MissionDescriptor, door: DoorKey): boolean {
  const expected = doorResource(door);
  return descriptor.resources.some((resource) =>
    resource.uri === expected.uri && resource.format === expected.format && resource.digest === expected.digest);
}

/** A successor directory's charter resource naming its predecessor: the
 * predecessor's mission id, and the SHA-256 of that id and its digest. It
 * gives the successor its own digest and chains it to the directory before. */
export function predecessorResource(predecessor: { mission_id: string; mission_digest: string }): MissionReference {
  return {
    uri: `urn:agenttool-lobby:directory:${predecessor.mission_id}`,
    format: DIRECTORY_REF_FORMAT,
    digest: `sha256:${sha256HexOf(`${predecessor.mission_id}\0${predecessor.mission_digest}`)}`,
  };
}

/** True when the charter names exactly this predecessor and no other one. */
export function namesPredecessor(descriptor: MissionDescriptor, predecessor: { mission_id: string; mission_digest: string }): boolean {
  const expected = predecessorResource(predecessor);
  const named = descriptor.resources.filter((resource) => resource.format === DIRECTORY_REF_FORMAT);
  return named.length === 1 && named[0]!.uri === expected.uri && named[0]!.digest === expected.digest;
}

// ── Join packet (hub → device) ─────────────────────────────────────────

export interface InvitationTemplate {
  format: typeof INVITATION_TEMPLATE_FORMAT;
  origin: string;
  mission_id: string;
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  public_key: string;
  expires_at: string;
  token_sha256: string;
}

export interface JoinPacket {
  format: typeof JOIN_PACKET_FORMAT;
  origin: string;
  project_id: string;
  door: DoorKey;
  directory: { mission_id: string; mission_digest: string };
  invitation_template: InvitationTemplate;
}

export function parseJoinPacket(text: string): JoinPacket {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LobbyError("invalid_packet", "the join packet is not JSON");
  }
  const packet = exact(value, ["format", "origin", "project_id", "door", "directory", "invitation_template"], "join packet");
  const door = exact(packet.door, ["public_key", "fingerprint"], "door");
  const directory = exact(packet.directory, ["mission_id", "mission_digest"], "directory");
  const template = exact(packet.invitation_template, ["format", "origin", "mission_id", "grant_id", "identity_id",
    "signing_key_id", "public_key", "expires_at", "token_sha256"], "invitation template");
  if (packet.format !== JOIN_PACKET_FORMAT || packet.origin !== LOBBY_ORIGIN || template.format !== INVITATION_TEMPLATE_FORMAT
    || template.origin !== LOBBY_ORIGIN) {
    throw new LobbyError("invalid_packet", `expected an ${JOIN_PACKET_FORMAT} packet for ${LOBBY_ORIGIN}`);
  }
  rawPublicKey(door.public_key as string);
  if (door.fingerprint !== publicKeyFingerprint(door.public_key as string)) {
    throw new LobbyError("invalid_packet", "the door fingerprint does not match the door public key");
  }
  rawPublicKey(template.public_key as string);
  if (!isSha256Hex(template.token_sha256)) throw new LobbyError("invalid_packet", "token_sha256 must be 64 lowercase hex");
  if (template.mission_id !== directory.mission_id) throw new LobbyError("invalid_packet", "the template names another mission");
  return {
    format: JOIN_PACKET_FORMAT,
    origin: LOBBY_ORIGIN,
    project_id: assertUuid(packet.project_id, "project_id"),
    door: { public_key: door.public_key as string, fingerprint: door.fingerprint as string },
    directory: {
      mission_id: assertUuid(directory.mission_id, "mission_id"),
      mission_digest: assertDigest(directory.mission_digest, "mission_digest"),
    },
    invitation_template: {
      format: INVITATION_TEMPLATE_FORMAT,
      origin: LOBBY_ORIGIN,
      mission_id: assertUuid(template.mission_id, "mission_id"),
      grant_id: assertUuid(template.grant_id, "grant_id"),
      identity_id: assertUuid(template.identity_id, "identity_id"),
      signing_key_id: assertUuid(template.signing_key_id, "signing_key_id"),
      public_key: template.public_key as string,
      expires_at: assertCanonicalTime(template.expires_at, "expires_at"),
      token_sha256: template.token_sha256,
    },
  };
}
