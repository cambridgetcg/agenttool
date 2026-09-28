/** Terminal mission gateway: participant grants never acquire project context.
 * Doctrine: docs/COLLABORATION-MISSIONS.md.
 */
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { verifyBearer } from "../auth/middleware";
import { configuredLocalContextOrigin } from "./identity/local-context";
import { readStrictCorrespondenceJson, StrictJsonError } from "../services/correspondence/strict-json";
import { createMissionSchema, issueMissionGrantSchema, MISSION_PROOF_HEADERS, MissionError } from "../services/collaboration/contracts";
import * as missions from "../services/collaboration/store";

const BASE = "/v1/collaboration/missions";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const TARGET = new RegExp(`^${BASE}/(${UUID})(?:/(invitation|accept|context|events|revoke|grants)(?:/(${UUID})(/revoke)?)?)?$`);
const DOCS = "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md";

class TransportError extends Error {
  constructor(readonly status: ContentfulStatusCode, readonly code: string) { super(code); }
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
        if (!body.success) throw new TransportError(400, "invalid_mission_grant_request");
        return c.json(await service.issueMissionGrant({ ...target, issuerApiKeyId: verified.apiKey.id, grantId: body.data.grant_id, identityId: body.data.identity_id, signingKeyId: body.data.signing_key_id, actions: body.data.actions, expiresAt: body.data.expires_at, origin: origin() }), 201);
      }
      if (action === "grants") return c.json({ grant: await (revocation ? service.revokeMissionGrant : service.getMissionGrant)({ ...target, grantId: grantId! }) });
      if (action === "revoke") return c.json({ mission: await service.revokeMission(target) });
      return c.json({ mission: await service.getMission(target) });
    } catch (error) {
      // Never pass private SQL parameters, token material or proof bytes into
      // the global error logger. Service failures use a finite public code set.
      if (error instanceof TransportError) return c.json({ error: error.code, docs: DOCS }, error.status);
      if (error instanceof StrictJsonError) return c.json({ error: "invalid_mission_json", docs: DOCS }, error.status);
      if (error instanceof MissionError) return c.json({ error: error.code, docs: DOCS }, error.status);
      return c.json({ error: "mission_unavailable", docs: DOCS }, 503);
    }
  };
}
