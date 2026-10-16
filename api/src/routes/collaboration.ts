/** Terminal mission gateway: participant grants never acquire project context.
 * Doctrine: docs/COLLABORATION-MISSIONS.md.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { verifyBearer } from "../auth/middleware";
import { errors, fail } from "../lib/errors";
import { configuredLocalContextOrigin } from "./identity/local-context";
import { readStrictCorrespondenceJson, StrictJsonError } from "../services/correspondence/strict-json";
import { createMissionSchema, issueMissionGrantSchema, MISSION_PROOF_HEADERS, MissionError, missionTokenSha256Schema } from "../services/collaboration/contracts";
import * as missions from "../services/collaboration/store";

const BASE = "/v1/collaboration/missions";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TARGET = new RegExp(`^${BASE}/(${UUID})(?:/(invitation|accept|context|events|revoke|grants)(?:/(${UUID})(/revoke)?)?)?$`);
const DOCS = "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md";

class TransportError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string) { super(code); }
}

const TRANSPORT_MESSAGES: Record<string, string> = {
  invalid_content_length: "Content-Length must use canonical unsigned decimal spelling.",
  mission_body_too_large: "The request exceeds this mission operation's body limit.",
  mission_route_not_found: "No mission operation is available at this exact path.",
  mission_method_not_allowed: "This mission path does not accept the requested method.",
  invalid_mission_target: "Use only the exact path and query forms in the mission contract.",
  mission_credential_invalid: "Use the credential and signing proof required by this operation.",
  mission_content_encoding_not_supported: "Send unencoded bytes so the exact signed body can be checked.",
  mission_json_required: "Mission mutations with a body require application/json.",
  invalid_mission_request: "Provide a canonical mission UUID, bounded descriptor and explicit expiry.",
  invalid_mission_grant_request: "Provide the grant UUID, identity, registered key, actions and expiry.",
  invalid_token_sha256: "token_sha256 must be the 64 lowercase hex SHA-256 of the participant's atcm_ token UTF-8 bytes.",
};
function malformedTokenHash(json: unknown): boolean {
  return typeof json === "object" && json !== null && !Array.isArray(json) && Object.hasOwn(json, "token_sha256")
    && !missionTokenSha256Schema.safeParse((json as Record<string, unknown>).token_sha256).success;
}
function missionFailure(c: Context, code: string, status: ContentfulStatusCode, message: string) {
  return fail(c, errors.refusal({
    error: code, message, docs: DOCS,
    hint: status === 409 || status === 503
      ? "After an uncertain mutation, inspect its known identifier before changing or retrying it. Issued tokens cannot be recovered."
      : "Check the selected mission, credential type, exact request bytes and current invitation scope.",
    next_actions: [{ action: "Read the mission request contract and recovery steps", method: null }],
  }), status);
}

async function bodyBytes(request: Request, maxBytes: number): Promise<Uint8Array> {
  const declared = request.headers.get("content-length");
  if (declared !== null && !/^(0|[1-9][0-9]*)$/.test(declared)) throw new TransportError(400, "invalid_content_length");
  if (declared !== null && BigInt(declared) > BigInt(maxBytes)) throw new TransportError(413, "mission_body_too_large");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value.byteLength > maxBytes - count) {
        try { await reader.cancel(); } catch { /* Refusal does not depend on client cancellation. */ }
        throw new TransportError(413, "mission_body_too_large");
      }
      chunks.push(value); count += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export interface MissionGatewayDependencies {
  verify: typeof verifyBearer;
  origin: () => string;
  service: Pick<typeof missions, "createMission" | "getMission" | "issueMissionGrant" | "getMissionGrant" | "revokeMissionGrant" | "revokeMission" | "executeMissionRequest">;
}

export function createMissionGateway(dependencies: Partial<MissionGatewayDependencies> = {}) {
  const verify = dependencies.verify ?? verifyBearer;
  const origin = dependencies.origin ?? configuredLocalContextOrigin;
  const service = dependencies.service ?? missions;
  return async (c: Context) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Content-Type", "application/json; charset=utf-8");
    try {
      const url = new URL(c.req.url);
      const query = url.search || (url.href.endsWith("?") ? "?" : "");
      const method = c.req.method;
      const match = TARGET.exec(url.pathname);
      const collection = url.pathname === BASE;
      if (!match && !collection) throw new TransportError(404, "mission_route_not_found");
      const [, missionId = "", action, grantId, revocation] = match ?? [];
      if (grantId && action !== "grants") throw new TransportError(404, "mission_route_not_found");
      const participant = ["invitation", "accept", "context", "events"].includes(action ?? "");
      const allowed = participant
        ? action === "events" ? ["GET", "POST"] : action === "accept" ? ["POST"] : ["GET"]
        : collection || action === "revoke" || action === "grants" && (!grantId || revocation) ? ["POST"] : ["GET"];
      if (!allowed.includes(method)) { c.header("Allow", allowed.join(", ")); throw new TransportError(405, "mission_method_not_allowed"); }
      if (query && !(participant && action === "events" && method === "GET")) throw new TransportError(400, "invalid_mission_target");
      const authorization = c.req.header("Authorization") ?? "";
      const token = /^Bearer ([A-Za-z0-9_-]{1,256})$/.exec(authorization)?.[1];
      if (!token || (participant ? !/^atcm_[A-Za-z0-9_-]{43}$/.test(token) : !token.startsWith("at_"))) throw new TransportError(401, "mission_credential_invalid");
      if (c.req.header("Content-Encoding")) throw new TransportError(400, "mission_content_encoding_not_supported");
      const carriesJson = method === "POST" && (participant || collection || action === "grants" && !grantId);
      if (carriesJson && !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(c.req.header("Content-Type") ?? "")) throw new TransportError(415, "mission_json_required");

      if (participant) {
        const proof = {
          grantId: c.req.header(MISSION_PROOF_HEADERS.grantId) ?? "",
          identityId: c.req.header(MISSION_PROOF_HEADERS.identityId) ?? "",
          keyId: c.req.header(MISSION_PROOF_HEADERS.keyId) ?? "",
          timestamp: c.req.header(MISSION_PROOF_HEADERS.timestamp) ?? "",
          signature: c.req.header(MISSION_PROOF_HEADERS.signature) ?? "",
        };
        const bytes = await bodyBytes(c.req.raw, method === "GET" ? 0 : 8192);
        const result = await service.executeMissionRequest({ token, missionId, origin: origin(), method, requestTarget: url.pathname + query, bodyBytes: bytes, proof });
        return c.json(result.data, result.created && action === "events" ? 201 : 200);
      }

      const verified = await verify(token, { recordLastUsed: false });
      if (!verified.ok) throw new TransportError(401, "mission_credential_invalid");
      const target = { projectId: verified.project.id, missionId };
      const bytes = await bodyBytes(c.req.raw, carriesJson ? 32768 : 0);
      const json = carriesJson ? await readStrictCorrespondenceJson(new Request("https://mission.invalid/", { method: "POST", body: Buffer.from(bytes) })) : null;
      if (collection) {
        const body = createMissionSchema.safeParse(json);
        if (!body.success) throw new TransportError(400, "invalid_mission_request");
        return c.json({ mission: await service.createMission({ projectId: target.projectId, issuerApiKeyId: verified.apiKey.id, missionId: body.data.mission_id, descriptor: body.data.descriptor, expiresAt: body.data.expires_at }) }, 201);
      }
      if (action === "grants" && !grantId) {
        const body = issueMissionGrantSchema.safeParse(json);
        if (!body.success) throw new TransportError(400, malformedTokenHash(json) ? "invalid_token_sha256" : "invalid_mission_grant_request");
        const participantHash = body.data.token_sha256 === undefined ? {} : { tokenSha256: body.data.token_sha256 };
        return c.json(await service.issueMissionGrant({ ...target, issuerApiKeyId: verified.apiKey.id, grantId: body.data.grant_id, identityId: body.data.identity_id, signingKeyId: body.data.signing_key_id, actions: body.data.actions, expiresAt: body.data.expires_at, origin: origin(), ...participantHash }), 201);
      }
      if (action === "grants") return c.json({ grant: await (revocation ? service.revokeMissionGrant : service.getMissionGrant)({ ...target, grantId: grantId! }) });
      if (action === "revoke") return c.json({ mission: await service.revokeMission(target) });
      return c.json({ mission: await service.getMission(target) });
    } catch (error) {
      // Never pass private SQL parameters, token material or proof bytes into
      // the global error logger. Service failures use a finite public code set.
      if (error instanceof TransportError) return missionFailure(c, error.code, error.status, TRANSPORT_MESSAGES[error.code] ?? "Use the exact mission request contract.");
      if (error instanceof StrictJsonError) return missionFailure(c, "invalid_mission_json", error.status, "Provide bounded, duplicate-free JSON with well-formed UTF-8.");
      if (error instanceof MissionError) return missionFailure(c, error.code, error.status, error.message);
      return missionFailure(c, "mission_unavailable", 503, "The mission operation could not be completed.");
    }
  };
}
