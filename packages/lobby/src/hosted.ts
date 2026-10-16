/** The fleet hall's only transport: agenttool collaboration missions and
 * identity enrollment on the pinned origin https://api.agenttool.dev.
 *
 * - Every request goes through an injected `fetchImpl`. This module never
 *   names the global fetch; only bin/agenttool-lobby.ts passes it in, and
 *   tests pass fakes. Redirects are refused, bodies are bounded, and a
 *   transport failure is reported as uncertain with no automatic retry.
 * - Every text this module sends (observation summaries, mission
 *   descriptors, enrollment display names) passes `checkEgress` here, inside
 *   the transport, together with a hostable check: a room whose residency is
 *   not `fleet`, or whose card says `hostable: false`, sends nothing. Open
 *   (public) residency is refused too: public joining is off.
 * - Bearers, tokens and keys are never echoed into errors; a refusal keeps
 *   only the HTTP status and the service's closed error code.
 *
 * Wire formats: src/wire.ts. Compatibility with the real gateway is proven in
 * bin/tests/lobby-fleet-gateway.test.ts.
 */
import { hostname } from "node:os";
import { checkEgress, type EgressRoom } from "./egress.js";
import { LobbyError } from "./errors.js";
import type { DeskSecrets } from "./secrets.js";
import {
  assertCanonicalTime,
  assertDigest,
  assertUuid,
  BEARER_PATTERN,
  ENROLLMENT_PATH,
  ENROLLMENT_SIGNATURE_HEADER,
  isBoundedText,
  isCanonicalTime,
  isSha256Hex,
  isUuid,
  isWellFormed,
  LOBBY_ORIGIN,
  MISSION_LIMITS,
  MISSION_PROOF_HEADERS,
  MISSIONS_PATH,
  missionDigest,
  requestDigest,
  sha256HexOf,
  signBytes,
  validateMissionDescriptor,
  type MissionAction,
  type MissionDescriptor,
  type MissionEvent,
} from "./wire.js";

export type { MissionEvent } from "./wire.js";

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface HostedOptions {
  fetchImpl: FetchLike;
  now: () => Date;
  timeoutMs?: number;
  /** This machine's own names for the egress gate; defaults to the hostname. */
  deviceTerms?: readonly string[];
}

/** The room a sent text belongs to: residency and hostable decide whether
 * anything may be sent; the card texts are matched by the gate too. */
export interface GateRoom extends EgressRoom {
  hostable: boolean;
}

/** The directory mission is fleet-resident and holds no room's own text. */
export const DIRECTORY_GATE_ROOM: GateRoom = Object.freeze({ residency: "fleet", hostable: true });

const DEFAULT_TIMEOUT_MS = 20_000;
const CURSOR = /^(0|[1-9][0-9]{0,18})$/;

/** This machine's hostname without a LAN suffix, as a device term for the gate. */
export function localDeviceTerms(): string[] {
  const name = hostname().replace(/\.(?:local|lan|home\.arpa)$/i, "");
  return name.length >= 4 && name.toLowerCase() !== "localhost" ? [name] : [];
}

/** Refuse anything the gate or the hosted rule refuses. Reasons are closed codes. */
export function assertSendable(text: string, room: GateRoom, deviceTerms: readonly string[]): void {
  if (room?.residency !== "fleet") {
    throw new LobbyError("not_fleet_room", "only fleet rooms may send to the hosted fleet hall; device rooms never leave this device and public joining is off");
  }
  if (room.hostable !== true) {
    throw new LobbyError("room_not_hostable", "this room's card says hostable: false, so nothing from it is sent to a hosted service");
  }
  const result = checkEgress(text, { room, deviceTerms });
  if (!result.ok) {
    throw new LobbyError("egress_refused", `the egress gate refused this text: ${result.reasons.join(", ")}`, { reasons: result.reasons });
  }
}

function isCursor(value: unknown): value is string {
  return typeof value === "string" && CURSOR.test(value) && BigInt(value) <= 9_223_372_036_854_775_807n;
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new LobbyError("hosted_invalid_response", "the service returned an empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.length;
    if (length > MISSION_LIMITS.responseBytes) {
      await reader.cancel();
      throw new LobbyError("hosted_invalid_response", "the service response exceeds 1 MiB");
    }
    chunks.push(part.value);
  }
  let value: unknown;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new LobbyError("hosted_invalid_response", "the service returned invalid JSON");
  }
  if (!response.ok) {
    const error = (value as { error?: unknown })?.error;
    const code = typeof error === "string" && /^[a-z_]{1,90}$/.test(error) ? error : "unknown";
    throw new LobbyError("hosted_refused", `the service refused the request: HTTP ${response.status} ${code}`, {
      status: response.status,
      error: code,
    });
  }
  return value;
}

/** One HTTP exchange. A transport error, before the response or while its
 * body is read (a dropped connection, the timeout firing mid-body), becomes
 * `hosted_uncertain`: the request may or may not have taken effect, and
 * nothing is retried. */
async function exchange(options: HostedOptions, path: string, init: RequestInit): Promise<unknown> {
  const uncertain = () => new LobbyError("hosted_uncertain", "the request did not complete; it may or may not have taken effect. Nothing was retried");
  let response: Response;
  try {
    response = await options.fetchImpl(`${LOBBY_ORIGIN}${path}`, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch {
    throw uncertain();
  }
  try {
    return await boundedJson(response);
  } catch (error) {
    if (error instanceof LobbyError) throw error;
    throw uncertain();
  }
}

/** True when a hosted call failed after its request may have reached the
 * service: no response, an incomplete or unreadable one, or a 5xx. Only a
 * definite refusal (a 4xx with the service's own error code) or a refusal
 * before sending says the request did not take effect. */
export function mayHaveTakenEffect(error: unknown): boolean {
  if (!(error instanceof LobbyError)) return true;
  if (error.code === "hosted_uncertain" || error.code === "hosted_invalid_response" || error.code === "hosted_server_token") return true;
  return error.code === "hosted_refused" && typeof error.details.status === "number" && error.details.status >= 500;
}

function record(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LobbyError("hosted_invalid_response", `the service returned no ${what}`);
  }
  return value as Record<string, unknown>;
}

// ── Mission and grant views returned by the service ────────────────────

export interface MissionView {
  mission_id: string;
  /** The project the service filed the mission under: the bearer's own
   * project when it was created (the service ignores any client choice). */
  project_id: string;
  descriptor: MissionDescriptor;
  mission_digest: string;
  expires_at: string;
  revoked_at: string | null;
}

export interface GrantView {
  grant_id: string;
  mission_id: string;
  identity_id: string;
  signing_key_id: string;
  origin: string;
  actions: MissionAction[];
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

/** Validate a mission view and recompute its digest from the descriptor. */
export function parseMissionView(value: unknown): MissionView {
  const mission = record(value, "mission");
  const descriptor = validateMissionDescriptor(mission.descriptor);
  const digest = missionDigest(descriptor);
  if (!isUuid(mission.mission_id) || !isUuid(mission.project_id) || mission.mission_digest !== digest
    || !isCanonicalTime(mission.expires_at) || !(mission.revoked_at === null || isCanonicalTime(mission.revoked_at))) {
    throw new LobbyError("hosted_invalid_response", "the mission does not match its descriptor digest or contract");
  }
  return {
    mission_id: mission.mission_id,
    project_id: mission.project_id,
    descriptor,
    mission_digest: digest,
    expires_at: mission.expires_at,
    revoked_at: mission.revoked_at as string | null,
  };
}

export function parseGrantView(value: unknown): GrantView {
  const grant = record(value, "grant");
  const actions = grant.actions;
  if (!isUuid(grant.grant_id) || !isUuid(grant.mission_id) || !isUuid(grant.identity_id) || !isUuid(grant.signing_key_id)
    || grant.origin !== LOBBY_ORIGIN || !Array.isArray(actions) || actions.length < 1 || actions.length > 2
    || !actions.every((action) => action === "mission.read" || action === "mission.observe")
    || new Set(actions).size !== actions.length || !isCanonicalTime(grant.expires_at)
    || !(grant.accepted_at === null || isCanonicalTime(grant.accepted_at))
    || !(grant.revoked_at === null || isCanonicalTime(grant.revoked_at))) {
    throw new LobbyError("hosted_invalid_response", "the grant does not match the mission grant contract");
  }
  return {
    grant_id: grant.grant_id,
    mission_id: grant.mission_id,
    identity_id: grant.identity_id,
    signing_key_id: grant.signing_key_id,
    origin: grant.origin,
    actions: [...actions].sort() as MissionAction[],
    expires_at: grant.expires_at,
    accepted_at: grant.accepted_at as string | null,
    revoked_at: grant.revoked_at as string | null,
  };
}

// ── Administrator calls (project bearer from the Keychain) ─────────────

export interface EnrollmentRequest {
  format: "agenttool-identity-enrollment-request/v1";
  origin: string;
  method: "POST";
  request_target: string;
  body_utf8: string;
  headers: { "Content-Type": "application/json"; "X-Agenttool-Enrollment-Signature": string };
}

export interface EnrolledIdentity {
  identity_id: string;
  did: string;
  signing_key_id: string;
  public_key: string;
}

export interface GrantIssue {
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  actions: MissionAction[];
  expires_at: string;
  token_sha256: string;
}

/** Calls that need the project bearer. The bearer stays in this object's
 * memory, goes only to the pinned origin, and is never echoed. */
export class AdminClient {
  constructor(private readonly bearer: string, private readonly options: HostedOptions) {
    if (!BEARER_PATTERN.test(bearer)) throw new LobbyError("invalid_bearer", "expected a project bearer from the Keychain");
  }

  private headers(json: boolean): Record<string, string> {
    return { Authorization: `Bearer ${this.bearer}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  /** Create a mission; the descriptor passes the gate first. */
  async createMission(input: { mission_id: string; descriptor: MissionDescriptor; expires_at: string }, room: GateRoom): Promise<MissionView> {
    assertUuid(input.mission_id, "mission_id");
    assertCanonicalTime(input.expires_at, "expires_at");
    const descriptor = validateMissionDescriptor(input.descriptor);
    const body = JSON.stringify({ mission_id: input.mission_id, descriptor, expires_at: input.expires_at });
    assertSendable(body, room, this.options.deviceTerms ?? localDeviceTerms());
    const result = record(await exchange(this.options, MISSIONS_PATH, { method: "POST", headers: this.headers(true), body }), "mission");
    const mission = parseMissionView(result.mission);
    if (mission.mission_id !== input.mission_id || mission.mission_digest !== missionDigest(descriptor)
      || mission.expires_at !== input.expires_at || mission.revoked_at !== null) {
      throw new LobbyError("hosted_invalid_response", "the created mission does not match the request");
    }
    return mission;
  }

  async getMission(missionId: string): Promise<MissionView> {
    assertUuid(missionId, "mission_id");
    const result = record(await exchange(this.options, `${MISSIONS_PATH}/${missionId}`, { method: "GET", headers: this.headers(false) }), "mission");
    const mission = parseMissionView(result.mission);
    if (mission.mission_id !== missionId) throw new LobbyError("hosted_invalid_response", "the service returned another mission");
    return mission;
  }

  /** Issue a grant bound to a participant-chosen token hash. A response
   * carrying a service-generated token is refused without reading it. */
  async issueGrant(missionId: string, input: GrantIssue): Promise<GrantView> {
    assertUuid(missionId, "mission_id");
    for (const field of ["grant_id", "identity_id", "signing_key_id"] as const) assertUuid(input[field], field);
    if (!isSha256Hex(input.token_sha256)) throw new LobbyError("invalid_token_sha256", "token_sha256 must be 64 lowercase hex");
    const actions = [...input.actions].sort();
    const body = JSON.stringify({
      grant_id: input.grant_id,
      identity_id: input.identity_id,
      signing_key_id: input.signing_key_id,
      actions,
      expires_at: input.expires_at,
      token_sha256: input.token_sha256,
    });
    assertSendable(body, DIRECTORY_GATE_ROOM, this.options.deviceTerms ?? localDeviceTerms());
    const result = record(await exchange(this.options, `${MISSIONS_PATH}/${missionId}/grants`, {
      method: "POST",
      headers: this.headers(true),
      body,
    }), "grant");
    if (Object.hasOwn(result, "token") || (result.grant !== null && typeof result.grant === "object" && Object.hasOwn(result.grant, "token"))) {
      throw new LobbyError("hosted_server_token", `grant ${input.grant_id} came back with a service-generated token, which was not read or kept; revoke that grant`);
    }
    const grant = parseGrantView(result.grant);
    if (grant.grant_id !== input.grant_id || grant.mission_id !== missionId || grant.identity_id !== input.identity_id
      || grant.signing_key_id !== input.signing_key_id || grant.actions.join(",") !== actions.join(",")
      || grant.accepted_at !== null || grant.revoked_at !== null || result.token_sha256 !== input.token_sha256
      || result.token_source !== "participant" || Date.parse(grant.expires_at) > Date.parse(input.expires_at)
      || Date.parse(grant.expires_at) <= this.options.now().getTime()) {
      throw new LobbyError("hosted_invalid_response", `grant ${input.grant_id} does not confirm the requested token hash and scope; inspect it before any new attempt`);
    }
    return grant;
  }

  async getGrant(missionId: string, grantId: string): Promise<GrantView> {
    assertUuid(missionId, "mission_id");
    assertUuid(grantId, "grant_id");
    const result = record(await exchange(this.options, `${MISSIONS_PATH}/${missionId}/grants/${grantId}`, {
      method: "GET",
      headers: this.headers(false),
    }), "grant");
    return parseGrantView(result.grant);
  }

  /** Relay a participant's signed enrollment: its exact body bytes, unchanged,
   * with its signature header. Only the chosen display text is gated; the
   * body's public key and nonce are protocol fields. */
  async enroll(request: EnrollmentRequest, gated: { display_name: string; capabilities: string[] }): Promise<EnrolledIdentity> {
    const terms = this.options.deviceTerms ?? localDeviceTerms();
    for (const text of [gated.display_name, ...gated.capabilities]) assertSendable(text, DIRECTORY_GATE_ROOM, terms);
    const body = JSON.parse(request.body_utf8) as Record<string, unknown>;
    const result = record(await exchange(this.options, ENROLLMENT_PATH, {
      method: "POST",
      headers: {
        ...this.headers(true),
        [ENROLLMENT_SIGNATURE_HEADER]: request.headers[ENROLLMENT_SIGNATURE_HEADER],
      },
      body: request.body_utf8,
    }), "enrollment");
    const identity = record(result.identity, "identity");
    const key = record(result.key, "key");
    const authority = record(result.authority, "authority");
    if (identity.id !== body.identity_id || identity.did !== `did:at:${body.identity_id}` || key.kid !== body.signing_key_id
      || key.public_key !== body.public_key || authority.mode !== "agent_root" || authority.root_public_key !== body.public_key) {
      throw new LobbyError("hosted_invalid_response", "the enrollment response does not match the relayed intent; inspect the identity before any new attempt");
    }
    return {
      identity_id: body.identity_id as string,
      did: identity.did as string,
      signing_key_id: body.signing_key_id as string,
      public_key: body.public_key as string,
    };
  }
}

// ── Participant calls (desk key and a local token) ─────────────────────

export interface ParticipantSeat {
  mission_id: string;
  grant_id: string;
  identity_id: string;
  signing_key_id: string;
  token_sha256: string;
}

export interface EventPage {
  events: MissionEvent[];
  next_cursor: string;
  has_more: boolean;
}

const PROOF_FIELDS = ["domain", "origin", "method", "request_target", "timestamp", "signature", "public_key", "raw_body", "body_sha256"];

function parseEvent(value: unknown, missionId: string): MissionEvent {
  const event = record(value, "event");
  const proof = record(event.proof, "event proof");
  if (!isUuid(event.event_id) || event.mission_id !== missionId || !isUuid(event.grant_id) || !isUuid(event.identity_id)
    || !isUuid(event.signing_key_id) || !isCursor(event.received_seq) || !isCanonicalTime(event.received_at)
    || typeof event.raw_body !== "string" || !isWellFormed(event.raw_body) || Buffer.byteLength(event.raw_body) > MISSION_LIMITS.requestBytes
    || event.body_sha256 !== sha256HexOf(event.raw_body)
    || !PROOF_FIELDS.every((field) => typeof proof[field] === "string")) {
    throw new LobbyError("hosted_invalid_response", "a mission event does not match the event contract");
  }
  return {
    event_id: event.event_id,
    mission_id: missionId,
    grant_id: event.grant_id,
    identity_id: event.identity_id,
    signing_key_id: event.signing_key_id,
    received_seq: event.received_seq,
    received_at: event.received_at,
    raw_body: event.raw_body,
    body_sha256: event.body_sha256,
    proof: Object.fromEntries(PROOF_FIELDS.map((field) => [field, proof[field] as string])),
  };
}

/** Calls signed by this desk's key with one of its locally generated tokens. */
export class ParticipantClient {
  constructor(private readonly secrets: DeskSecrets, private readonly options: HostedOptions) {}

  private async request(seat: ParticipantSeat, method: "GET" | "POST", suffix: string, body: string): Promise<unknown> {
    const target = `${MISSIONS_PATH}/${seat.mission_id}${suffix}`;
    const timestamp = this.options.now().toISOString();
    const digest = requestDigest({
      origin: LOBBY_ORIGIN,
      method,
      target,
      missionId: seat.mission_id,
      grantId: seat.grant_id,
      identityId: seat.identity_id,
      keyId: seat.signing_key_id,
      body,
      timestamp,
    });
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.secrets.tokenFor(seat.token_sha256)}`,
      [MISSION_PROOF_HEADERS.grantId]: seat.grant_id,
      [MISSION_PROOF_HEADERS.identityId]: seat.identity_id,
      [MISSION_PROOF_HEADERS.keyId]: seat.signing_key_id,
      [MISSION_PROOF_HEADERS.timestamp]: timestamp,
      [MISSION_PROOF_HEADERS.signature]: signBytes(this.secrets.deskKey(), digest).toString("base64url"),
    };
    if (body !== "") headers["Content-Type"] = "application/json";
    return exchange(this.options, target, { method, headers, ...(body === "" ? {} : { body }) });
  }

  private checkGrant(seat: ParticipantSeat, grant: GrantView): void {
    if (grant.grant_id !== seat.grant_id || grant.mission_id !== seat.mission_id || grant.identity_id !== seat.identity_id
      || grant.signing_key_id !== seat.signing_key_id) {
      throw new LobbyError("hosted_invalid_response", "the service returned another grant");
    }
  }

  /** Read the mission and this grant's scope. Does not accept. */
  async invitation(seat: ParticipantSeat): Promise<{ mission: MissionView; grant: GrantView }> {
    const result = record(await this.request(seat, "GET", "/invitation", ""), "invitation");
    const mission = parseMissionView(result.mission);
    const grant = parseGrantView(result.grant);
    if (mission.mission_id !== seat.mission_id) throw new LobbyError("hosted_invalid_response", "the service returned another mission");
    this.checkGrant(seat, grant);
    return { mission, grant };
  }

  /** Accept exactly the reviewed digest. */
  async accept(seat: ParticipantSeat, digest: string): Promise<{ mission: MissionView; grant: GrantView }> {
    assertDigest(digest, "mission_digest");
    const result = record(await this.request(seat, "POST", "/accept", JSON.stringify({ mission_digest: digest })), "acceptance");
    const mission = parseMissionView(result.mission);
    const grant = parseGrantView(result.grant);
    this.checkGrant(seat, grant);
    if (mission.mission_digest !== digest || grant.accepted_at === null) {
      throw new LobbyError("hosted_invalid_response", "the acceptance does not confirm the reviewed digest");
    }
    return { mission, grant };
  }

  /** One page of events after a cursor, checked for complete receipt order. */
  async events(seat: ParticipantSeat, after: string, limit = MISSION_LIMITS.pageMax): Promise<EventPage> {
    if (!isCursor(after)) throw new LobbyError("invalid_cursor", "a cursor is a canonical decimal string");
    if (!Number.isInteger(limit) || limit < 1 || limit > MISSION_LIMITS.pageMax) throw new LobbyError("invalid_limit", "page limit is 1-50");
    const result = record(await this.request(seat, "GET", `/events?after=${after}&limit=${limit}`, ""), "event page");
    const page = record(result.page, "page");
    if (result.mission_id !== seat.mission_id || !Array.isArray(result.events) || result.events.length > limit
      || page.after !== after || typeof page.has_more !== "boolean" || !isCursor(page.next_cursor)) {
      throw new LobbyError("hosted_invalid_response", "the event page does not match the page contract");
    }
    const events = result.events.map((event) => parseEvent(event, seat.mission_id));
    let last = BigInt(after);
    for (const event of events) {
      const seq = BigInt(event.received_seq);
      if (seq <= last) throw new LobbyError("hosted_invalid_response", "the event page is not in receipt order");
      last = seq;
    }
    if (last.toString() !== page.next_cursor) throw new LobbyError("hosted_invalid_response", "the page cursor does not name its last event");
    if (events.length === 0 && page.has_more) throw new LobbyError("hosted_invalid_response", "an empty page cannot claim more events");
    return { events, next_cursor: page.next_cursor, has_more: page.has_more };
  }

  /** Post one observation whose exact raw body was saved before sending.
   * The summary inside it passes the gate again here. */
  async observe(seat: ParticipantSeat, rawBody: string, room: GateRoom): Promise<MissionEvent> {
    const parsed = record(JSON.parse(rawBody), "observation");
    if (Object.keys(parsed).sort().join(",") !== "event_id,summary" || !isUuid(parsed.event_id) || typeof parsed.summary !== "string") {
      throw new LobbyError("invalid_observation", "an observation is exactly an event_id and a summary");
    }
    assertSendable(parsed.summary, room, this.options.deviceTerms ?? localDeviceTerms());
    if (Buffer.byteLength(rawBody) > MISSION_LIMITS.requestBytes) throw new LobbyError("invalid_observation", "an observation is at most 8192 bytes");
    const result = record(await this.request(seat, "POST", "/events", rawBody), "receipt");
    const event = parseEvent(result.event, seat.mission_id);
    if (event.event_id !== parsed.event_id || event.body_sha256 !== sha256HexOf(rawBody) || event.grant_id !== seat.grant_id) {
      throw new LobbyError("hosted_invalid_response", `the receipt does not match saved event ${parsed.event_id}`);
    }
    return event;
  }
}

/** Build the exact raw body for one observation after gating its summary. */
export function prepareObservation(summary: string, room: GateRoom, deviceTerms: readonly string[]): { event_id: string; raw_body: string } {
  assertSendable(summary, room, deviceTerms);
  if (!isBoundedText(summary, MISSION_LIMITS.summaryScalars)) {
    throw new LobbyError("invalid_observation", "an observation summary is 1-1000 well-formed characters");
  }
  const eventId = crypto.randomUUID();
  const raw = JSON.stringify({ event_id: eventId, summary });
  if (Buffer.byteLength(raw) > MISSION_LIMITS.requestBytes) throw new LobbyError("invalid_observation", "an observation is at most 8192 bytes");
  return { event_id: eventId, raw_body: raw };
}
