/** An in-memory stand-in for the mission and enrollment API, for hermetic
 * package tests. It enforces the contract the desk relies on (exact-request
 * proofs, enrollment signatures, descriptor digests, grant bounds, token-hash
 * binding, idempotent events) with this package's own ported wire code. The
 * real gateway is exercised separately in bin/tests/lobby-fleet-gateway.test.ts.
 * No network: fetch is a function call. Every value here is synthetic.
 */
import {
  enrollmentDigest,
  ENROLLMENT_PATH,
  ENROLLMENT_SIGNATURE_HEADER,
  isCanonicalTime,
  isGrantToken,
  LOBBY_ORIGIN,
  MISSION_PROOF_HEADERS,
  missionDigest,
  requestDigest,
  sha256HexOf,
  validateMissionDescriptor,
  verifyBytes,
  type MissionDescriptor,
} from "../src/wire.js";

export const FAKE_BEARER = "at_fixtureBearer0000notReal";
export const FAKE_PROJECT = "66666666-6666-4666-8666-666666666666";
const API_KEY = "77777777-7777-4777-8777-777777777777";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface Clock {
  now: Date;
}

interface Mission {
  mission_id: string;
  descriptor: MissionDescriptor;
  digest: string;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
  events: Array<Record<string, unknown>>;
}

interface Grant {
  grant_id: string;
  mission_id: string;
  identity_id: string;
  signing_key_id: string;
  actions: string[];
  issued_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  token_sha256: string;
}

export interface SeenRequest {
  method: string;
  path: string;
  authorization: string | null;
  body: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function refuse(error: string, status: number): Response {
  return json({ error, message: "synthetic refusal" }, status);
}

export class FakeHosted {
  readonly identities = new Map<string, { key_id: string; public_key: string; display_name: string }>();
  readonly missions = new Map<string, Mission>();
  readonly grants = new Map<string, Grant>();
  readonly seen: SeenRequest[] = [];
  readonly usedNonces = new Set<string>();
  /** Make the next matching request throw like a dropped connection. */
  failNext: ((request: SeenRequest) => boolean) | null = null;
  /** Process the next matching request, then lose its response. */
  loseResponse: ((request: SeenRequest) => boolean) | null = null;

  constructor(private readonly clock: Clock) {}

  private nowIso(): string {
    return this.clock.now.toISOString();
  }

  readonly fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    if (parsed.origin !== LOBBY_ORIGIN) throw new Error("fake: unexpected origin");
    if (init.redirect !== "error") throw new Error("fake: redirects must be refused");
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : init.body === undefined ? "" : "<non-string body>";
    const request: SeenRequest = { method: String(init.method), path: parsed.pathname + parsed.search, authorization: headers.get("Authorization"), body };
    this.seen.push(request);
    if (this.failNext?.(request)) {
      this.failNext = null;
      throw new Error("fake: connection dropped");
    }
    try {
      const response = this.route(request, headers);
      if (this.loseResponse?.(request)) {
        this.loseResponse = null;
        throw new Error("fake: response lost");
      }
      return response;
    } catch (error) {
      if ((error as Error).message === "fake: response lost") throw error;
      return refuse(`fake_internal_${String((error as Error).message).replace(/[^a-z_]/g, "_").slice(0, 40)}`, 500);
    }
  };

  private route(request: SeenRequest, headers: Headers): Response {
    const path = request.path;
    if (path === ENROLLMENT_PATH && request.method === "POST") return this.enroll(request, headers);
    const match = /^\/v1\/collaboration\/missions(?:\/([0-9a-f-]{36})(?:\/(invitation|accept|events|grants)(?:\/([0-9a-f-]{36}))?)?)?(\?.*)?$/.exec(path);
    if (!match) return refuse("mission_route_not_found", 404);
    const [, missionId, action, grantId, query] = match;
    const participantAction = action === "invitation" || action === "accept" || action === "events";
    if (participantAction) return this.participant(request, headers, missionId!, action!, query ?? "");
    if (request.authorization !== `Bearer ${FAKE_BEARER}`) return refuse("mission_credential_invalid", 401);
    if (missionId === undefined && request.method === "POST") return this.createMission(request);
    if (missionId !== undefined && action === undefined && request.method === "GET") {
      const mission = this.missions.get(missionId);
      return mission === undefined ? refuse("collaboration_mission_not_found", 404) : json({ mission: this.missionView(mission) });
    }
    if (action === "grants" && grantId === undefined && request.method === "POST") return this.issueGrant(request, missionId!);
    if (action === "grants" && grantId !== undefined && request.method === "GET") {
      const grant = this.grants.get(grantId);
      return grant === undefined || grant.mission_id !== missionId ? refuse("collaboration_mission_not_found", 404) : json({ grant: this.grantView(grant) });
    }
    return refuse("mission_method_not_allowed", 405);
  }

  private missionView(mission: Mission) {
    return {
      mission_id: mission.mission_id, project_id: FAKE_PROJECT, descriptor: mission.descriptor, mission_digest: mission.digest,
      created_at: mission.created_at, expires_at: mission.expires_at, revoked_at: mission.revoked_at,
      scope: "mission_selected_context", authority: "descriptive_context_only",
    };
  }

  private grantView(grant: Grant) {
    return {
      grant_id: grant.grant_id, mission_id: grant.mission_id, project_id: FAKE_PROJECT, identity_id: grant.identity_id,
      signing_key_id: grant.signing_key_id, issuing_api_key_id: API_KEY, origin: LOBBY_ORIGIN, actions: [...grant.actions].sort(),
      issued_at: grant.issued_at, expires_at: grant.expires_at, accepted_at: grant.accepted_at, revoked_at: grant.revoked_at,
    };
  }

  private enroll(request: SeenRequest, headers: Headers): Response {
    if (request.authorization !== `Bearer ${FAKE_BEARER}`) return refuse("identity_enrollment_administrator_invalid", 401);
    const body = JSON.parse(request.body) as Record<string, string>;
    if (body.project_id !== FAKE_PROJECT || body.origin !== LOBBY_ORIGIN) return refuse("identity_enrollment_invalid_proof", 401);
    if (Math.abs(this.clock.now.getTime() - Date.parse(body.timestamp!)) > 300_000) return refuse("identity_enrollment_invalid_proof", 401);
    const signature = Buffer.from(headers.get(ENROLLMENT_SIGNATURE_HEADER) ?? "", "base64url");
    const digest = enrollmentDigest({ origin: LOBBY_ORIGIN, projectId: FAKE_PROJECT, bodyBytes: Buffer.from(request.body) });
    if (!verifyBytes(body.public_key!, digest, signature)) return refuse("identity_enrollment_invalid_proof", 401);
    if (this.usedNonces.has(body.nonce!) || this.identities.has(body.identity_id!)) return refuse("identity_enrollment_conflict", 409);
    this.usedNonces.add(body.nonce!);
    this.identities.set(body.identity_id!, { key_id: body.signing_key_id!, public_key: body.public_key!, display_name: body.display_name! });
    return json({
      identity: { id: body.identity_id, did: `did:at:${body.identity_id}`, display_name: body.display_name, capabilities: [], status: "active" },
      key: { kid: body.signing_key_id, public_key: body.public_key },
      authority: { mode: "agent_root", root_public_key: body.public_key, sequence: 0, next_sequence: 1 },
    }, 201);
  }

  private createMission(request: SeenRequest): Response {
    const body = JSON.parse(request.body) as { mission_id: string; descriptor: unknown; expires_at: string };
    let descriptor: MissionDescriptor;
    try {
      descriptor = validateMissionDescriptor(body.descriptor);
    } catch {
      return refuse("invalid_mission_request", 400);
    }
    const expires = Date.parse(body.expires_at);
    if (!UUID.test(body.mission_id) || !isCanonicalTime(body.expires_at) || expires <= this.clock.now.getTime()
      || expires - this.clock.now.getTime() > 30 * 86_400_000) return refuse("invalid_mission_request", 400);
    if (this.missions.has(body.mission_id)) return refuse("collaboration_mission_conflict", 409);
    const mission: Mission = {
      mission_id: body.mission_id, descriptor, digest: missionDigest(descriptor), created_at: this.nowIso(),
      expires_at: body.expires_at, revoked_at: null, events: [],
    };
    this.missions.set(mission.mission_id, mission);
    return json({ mission: this.missionView(mission) }, 201);
  }

  private issueGrant(request: SeenRequest, missionId: string): Response {
    const body = JSON.parse(request.body) as Record<string, unknown>;
    const mission = this.missions.get(missionId);
    const identity = this.identities.get(String(body.identity_id));
    const expires = Date.parse(String(body.expires_at));
    const now = this.clock.now.getTime();
    if (Object.keys(body).sort().join(",") !== "actions,expires_at,grant_id,identity_id,signing_key_id,token_sha256"
      || !/^[0-9a-f]{64}$/.test(String(body.token_sha256))) return refuse("invalid_mission_grant_request", 400);
    if (mission === undefined || identity === undefined || identity.key_id !== body.signing_key_id
      || mission.revoked_at !== null || expires <= now || expires - now > 86_400_000 || expires > Date.parse(mission.expires_at)) {
      return refuse("collaboration_mission_invalid_credential", 401);
    }
    if (this.grants.has(String(body.grant_id))) return refuse("collaboration_mission_conflict", 409);
    if ([...this.grants.values()].some((grant) => grant.token_sha256 === body.token_sha256)) return refuse("token_hash_conflict", 409);
    const grant: Grant = {
      grant_id: String(body.grant_id), mission_id: missionId, identity_id: String(body.identity_id), signing_key_id: String(body.signing_key_id),
      actions: [...(body.actions as string[])].sort(), issued_at: this.nowIso(), expires_at: String(body.expires_at),
      accepted_at: null, revoked_at: null, token_sha256: String(body.token_sha256),
    };
    this.grants.set(grant.grant_id, grant);
    return json({ grant: this.grantView(grant), token_sha256: grant.token_sha256, token_source: "participant" }, 201);
  }

  private participant(request: SeenRequest, headers: Headers, missionId: string, action: string, query: string): Response {
    const token = /^Bearer (.+)$/.exec(request.authorization ?? "")?.[1] ?? "";
    if (!isGrantToken(token)) return refuse("mission_credential_invalid", 401);
    const grant = [...this.grants.values()].find((candidate) => candidate.token_sha256 === sha256HexOf(token));
    const deny = () => refuse("collaboration_mission_invalid_credential", 401);
    const proof = {
      grantId: headers.get(MISSION_PROOF_HEADERS.grantId) ?? "",
      identityId: headers.get(MISSION_PROOF_HEADERS.identityId) ?? "",
      keyId: headers.get(MISSION_PROOF_HEADERS.keyId) ?? "",
      timestamp: headers.get(MISSION_PROOF_HEADERS.timestamp) ?? "",
      signature: headers.get(MISSION_PROOF_HEADERS.signature) ?? "",
    };
    if (grant === undefined || grant.mission_id !== missionId || grant.grant_id !== proof.grantId
      || grant.identity_id !== proof.identityId || grant.signing_key_id !== proof.keyId) return deny();
    const identity = this.identities.get(grant.identity_id)!;
    const mission = this.missions.get(missionId)!;
    const now = this.clock.now.getTime();
    if (grant.revoked_at !== null || Date.parse(grant.expires_at) <= now || mission.revoked_at !== null
      || Date.parse(mission.expires_at) <= now || Math.abs(now - Date.parse(proof.timestamp)) > 300_000) return deny();
    const target = `/v1/collaboration/missions/${missionId}/${action}${query}`;
    let digest: Buffer;
    try {
      digest = requestDigest({
        origin: LOBBY_ORIGIN, method: request.method as "GET" | "POST", target, missionId, grantId: grant.grant_id,
        identityId: grant.identity_id, keyId: grant.signing_key_id, body: request.body, timestamp: proof.timestamp,
      });
    } catch {
      return deny();
    }
    if (!verifyBytes(identity.public_key, digest, Buffer.from(proof.signature, "base64url"))) return deny();
    if (action === "invitation" && request.method === "GET") return json({ mission: this.missionView(mission), grant: this.grantView(grant) });
    if (action === "accept" && request.method === "POST") {
      const body = JSON.parse(request.body) as { mission_digest: string };
      if (body.mission_digest !== mission.digest) return refuse("collaboration_mission_conflict", 409);
      grant.accepted_at ??= this.nowIso();
      return json({ mission: this.missionView(mission), grant: this.grantView(grant) });
    }
    if (grant.accepted_at === null) return refuse("collaboration_mission_acceptance_required", 403);
    if (action === "events" && request.method === "GET") {
      if (!grant.actions.includes("mission.read")) return deny();
      const page = /^\?after=(\d+)&limit=(\d+)$/.exec(query);
      if (!page) return refuse("invalid_mission_target", 400);
      const after = Number(page[1]);
      const limit = Number(page[2]);
      const candidates = mission.events.filter((event) => Number(event.received_seq) > after);
      const events = candidates.slice(0, limit);
      return json({
        mission_id: missionId, events,
        page: { after: String(after), next_cursor: events.length === 0 ? String(after) : String(events.at(-1)!.received_seq), has_more: candidates.length > limit },
      });
    }
    if (action === "events" && request.method === "POST") {
      if (!grant.actions.includes("mission.observe")) return deny();
      const body = JSON.parse(request.body) as { event_id: string; summary: string };
      if ([...body.summary].length > 1000) return refuse("collaboration_mission_invalid_request", 400);
      const existing = mission.events.find((event) => event.event_id === body.event_id);
      if (existing !== undefined) {
        return existing.raw_body === request.body ? json({ event: existing }) : refuse("collaboration_mission_conflict", 409);
      }
      const event = {
        event_id: body.event_id, mission_id: missionId, grant_id: grant.grant_id, identity_id: grant.identity_id,
        signing_key_id: grant.signing_key_id, received_seq: String(mission.events.length + 1), received_at: this.nowIso(),
        observation: body, raw_body: request.body, body_sha256: sha256HexOf(request.body),
        proof: {
          domain: "agenttool-collaboration-request/v1", origin: LOBBY_ORIGIN, method: "POST", request_target: target,
          timestamp: proof.timestamp, signature: proof.signature, public_key: identity.public_key,
          raw_body: request.body, body_sha256: sha256HexOf(request.body),
        },
      };
      mission.events.push(event);
      return json({ event }, 201);
    }
    return refuse("mission_method_not_allowed", 405);
  }

  /** Text of every observation summary posted to a mission. */
  summaries(missionId: string): string[] {
    return (this.missions.get(missionId)?.events ?? []).map((event) => (event.observation as { summary: string }).summary);
  }

  /** Append an event as a given grant, bypassing proofs: a forged or foreign post. */
  injectEvent(missionId: string, grantId: string, summary: string): void {
    const mission = this.missions.get(missionId)!;
    const grant = this.grants.get(grantId)!;
    const eventId = crypto.randomUUID();
    const raw = JSON.stringify({ event_id: eventId, summary });
    mission.events.push({
      event_id: eventId, mission_id: missionId, grant_id: grant.grant_id, identity_id: grant.identity_id,
      signing_key_id: grant.signing_key_id, received_seq: String(mission.events.length + 1), received_at: this.nowIso(),
      observation: { event_id: eventId, summary }, raw_body: raw, body_sha256: sha256HexOf(raw),
      proof: {
        domain: "agenttool-collaboration-request/v1", origin: LOBBY_ORIGIN, method: "POST",
        request_target: `/v1/collaboration/missions/${missionId}/events`, timestamp: this.nowIso(),
        signature: Buffer.alloc(64).toString("base64url"), public_key: this.identities.get(grant.identity_id)!.public_key,
        raw_body: raw, body_sha256: sha256HexOf(raw),
      },
    });
  }
}
