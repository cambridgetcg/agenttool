/** Shared fixture for the lobby desk's gateway tests: the API's own mission
 * gateway and enrollment router, in process, over in-memory persistence built
 * from the API's own contract helpers (operation routing including leave,
 * strict bodies, exact-request proof verification, digests, event paging,
 * revocation). Synthetic project, bearer and keys; no live service, no real
 * Keychain, scripted terminals. */
import { createPublicKey, verify } from "node:crypto";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "../../api/node_modules/hono/dist/index.js";
import { createMissionGateway, type MissionGatewayDependencies } from "../../api/src/routes/collaboration";
import { createIdentityEnrollmentRouter } from "../../api/src/routes/identity/enroll";
import { collaborationTransportBoundary, isCollaborationPath } from "../../api/src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../../api/src/middleware/early-data";
import { apiCors } from "../../api/src/middleware/api-cors";
import {
  createMissionSchema, issueMissionGrantSchema, MISSION_BOUNDS, missionAcceptSchema, MissionError, missionObservationSchema,
  missionOperation, packMissionEventPage, parseMissionBody, parseMissionInput,
} from "../../api/src/services/collaboration/contracts";
import { MISSION_REQUEST_DOMAIN, missionSha256, verifyMissionProof } from "../../api/src/services/collaboration/proof";
import { correspondenceCanonicalJson } from "../../api/src/services/correspondence/canonical";
import { canonicalIdentityEnrollmentBytes, identityEnrollmentSchema } from "../../api/src/services/identity/enrollment";
import { runCli } from "../../packages/lobby/src/cli";
import { FileSecretStore } from "../../packages/lobby/src/keychain";
import { confirmOnTty, type TtyPort } from "../../packages/lobby/src/tty";

export const ORIGIN = "https://api.agenttool.dev";
export const PROJECT = "66666666-6666-4666-8666-666666666666";
export const API_KEY = "77777777-7777-4777-8777-777777777777";
// Clearly synthetic administrator bearer: it never reaches a real service.
export const BEARER = "at_syntheticLobbyGatewayFixture0";

/** In-memory persistence behind the real gateway, using the API's own rules. */
export function memoryService(now: () => Date) {
  const identities = new Map<string, { keyId: string; publicKey: string }>();
  const missions = new Map<string, { row: any; events: any[] }>();
  const grants = new Map<string, any>();
  const operations: string[] = [];
  /** Every participant request as the gateway handed it over: operation and exact body length. */
  const requests: Array<{ operation: string; bodyBytes: number; missionId: string }> = [];
  const missionView = (row: any) => ({
    mission_id: row.id, project_id: PROJECT, descriptor: row.descriptor, mission_digest: row.digest, created_at: row.createdAt,
    expires_at: row.expiresAt, revoked_at: row.revokedAt ?? null, scope: "mission_selected_context", authority: "descriptive_context_only",
  });
  const grantView = (grant: any) => ({
    grant_id: grant.id, mission_id: grant.missionId, project_id: PROJECT, identity_id: grant.identityId, signing_key_id: grant.signingKeyId,
    issuing_api_key_id: API_KEY, origin: ORIGIN, actions: grant.actions, issued_at: grant.issuedAt, expires_at: grant.expiresAt,
    accepted_at: grant.acceptedAt, revoked_at: grant.revokedAt ?? null, ...(grant.left ? { revocation_reason: "participant_left" } : {}),
  });
  const service: Partial<MissionGatewayDependencies["service"]> = {
    createMission: (async (input: any) => {
      const parsed = parseMissionInput(createMissionSchema, { mission_id: input.missionId, descriptor: input.descriptor, expires_at: input.expiresAt });
      const expires = Date.parse(parsed.expires_at);
      if (expires <= now().getTime() || expires - now().getTime() > MISSION_BOUNDS.missionAgeMs) throw new MissionError("invalid_request");
      if (missions.has(parsed.mission_id)) throw new MissionError("conflict");
      const row = { id: parsed.mission_id, descriptor: parsed.descriptor, digest: `sha256:${missionSha256(correspondenceCanonicalJson(parsed.descriptor))}`,
        createdAt: now().toISOString(), expiresAt: parsed.expires_at, revokedAt: null as string | null };
      missions.set(row.id, { row, events: [] });
      operations.push("create_mission");
      return missionView(row);
    }) as any,
    getMission: (async (input: any) => {
      const mission = missions.get(input.missionId);
      if (!mission) throw new MissionError("not_found");
      return missionView(mission.row);
    }) as any,
    issueMissionGrant: (async (input: any) => {
      const parsed = parseMissionInput(issueMissionGrantSchema, { grant_id: input.grantId, identity_id: input.identityId,
        signing_key_id: input.signingKeyId, actions: input.actions, expires_at: input.expiresAt, token_sha256: input.tokenSha256 });
      const identity = identities.get(parsed.identity_id);
      const mission = missions.get(input.missionId);
      const expires = Date.parse(parsed.expires_at);
      if (!identity || identity.keyId !== parsed.signing_key_id || !mission || mission.row.revokedAt || expires <= now().getTime()
        || expires - now().getTime() > MISSION_BOUNDS.grantAgeMs || expires > Date.parse(mission.row.expiresAt)) throw new MissionError("invalid_credential");
      if (parsed.token_sha256 === undefined) throw new Error("the desk must always send a participant token hash");
      if (grants.has(parsed.grant_id)) throw new MissionError("conflict");
      if ([...grants.values()].some(grant => grant.tokenHash === parsed.token_sha256)) throw new MissionError("token_hash_conflict");
      const grant = { id: parsed.grant_id, missionId: input.missionId, identityId: parsed.identity_id, signingKeyId: parsed.signing_key_id,
        actions: [...parsed.actions].sort(), issuedAt: now().toISOString(), expiresAt: parsed.expires_at, acceptedAt: null as string | null,
        revokedAt: null as string | null, left: false, tokenHash: parsed.token_sha256 };
      grants.set(grant.id, grant);
      operations.push("issue_grant");
      return { grant: grantView(grant), token_sha256: grant.tokenHash, token_source: "participant" };
    }) as any,
    getMissionGrant: (async (input: any) => {
      const grant = grants.get(input.grantId);
      if (!grant) throw new MissionError("not_found");
      return grantView(grant);
    }) as any,
    /** Revocation deliberately works for expired grants; a repeat returns the revoked grant. */
    revokeMissionGrant: (async (input: any) => {
      const grant = grants.get(input.grantId);
      if (!missions.has(input.missionId) || !grant || grant.missionId !== input.missionId) throw new MissionError("not_found");
      grant.revokedAt ??= now().toISOString();
      operations.push("revoke_grant");
      return grantView(grant);
    }) as any,
    revokeMission: (async (input: any) => {
      const mission = missions.get(input.missionId);
      if (!mission) throw new MissionError("not_found");
      mission.row.revokedAt ??= now().toISOString();
      operations.push("revoke_mission");
      return missionView(mission.row);
    }) as any,
    executeMissionRequest: (async (input: any) => {
      const selected = missionOperation(input);
      requests.push({ operation: selected.operation, bodyBytes: input.bodyBytes.length, missionId: input.missionId });
      const deny = () => new MissionError("invalid_credential");
      const leaving = selected.operation === "leave";
      const grant = [...grants.values()].find(candidate => candidate.tokenHash === missionSha256(input.token));
      const mission = grant ? missions.get(grant.missionId) : undefined;
      if (!grant || !mission || grant.id !== input.proof.grantId || grant.missionId !== input.missionId || grant.identityId !== input.proof.identityId
        || grant.signingKeyId !== input.proof.keyId || Date.parse(grant.expiresAt) <= now().getTime()
        || (grant.revokedAt !== null && !(leaving && grant.left)) || mission.row.revokedAt) throw deny();
      // The API's own exact-request proof verification against the enrolled key.
      if (!verifyMissionProof(input, identities.get(grant.identityId)!.publicKey, now())) throw deny();
      operations.push(selected.operation);
      if (selected.operation === "invitation") return { created: false, data: { mission: missionView(mission.row), grant: grantView(grant) } };
      if (leaving) {
        if (!grant.acceptedAt) throw new MissionError("acceptance_required");
        const created = grant.revokedAt === null;
        grant.revokedAt ??= now().toISOString();
        grant.left = true;
        return { created, data: { mission_id: grant.missionId, grant_id: grant.id, status: "revoked", reason: "participant_left", revoked_at: grant.revokedAt } };
      }
      if (selected.operation === "accept") {
        const body = parseMissionInput(missionAcceptSchema, await parseMissionBody(input.bodyBytes));
        if (body.mission_digest !== mission.row.digest) throw new MissionError("conflict");
        grant.acceptedAt ??= now().toISOString();
        return { created: true, data: { mission: missionView(mission.row), grant: grantView(grant) } };
      }
      const action = selected.operation === "observe" ? "mission.observe" : "mission.read";
      if (!grant.actions.includes(action)) throw deny();
      if (!grant.acceptedAt) throw new MissionError("acceptance_required");
      if (selected.operation === "list") {
        const candidates = mission.events.filter(event => BigInt(event.received_seq) > selected.after);
        return { created: false, data: packMissionEventPage(mission.row.id, selected.after.toString(),
          candidates.slice(0, selected.limit), candidates.length > selected.limit) };
      }
      const observation = parseMissionInput(missionObservationSchema, await parseMissionBody(input.bodyBytes));
      const rawBody = new TextDecoder("utf-8", { fatal: true }).decode(input.bodyBytes);
      const existing = mission.events.find(event => event.event_id === observation.event_id);
      if (existing) {
        if (existing.raw_body !== rawBody) throw new MissionError("conflict");
        return { created: false, data: { event: existing } };
      }
      const event = { event_id: observation.event_id, mission_id: mission.row.id, grant_id: grant.id, identity_id: grant.identityId,
        signing_key_id: grant.signingKeyId, received_seq: String(mission.events.length + 1), received_at: now().toISOString(),
        observation, raw_body: rawBody, body_sha256: missionSha256(input.bodyBytes),
        proof: { domain: MISSION_REQUEST_DOMAIN, origin: input.origin, method: input.method, request_target: input.requestTarget,
          timestamp: input.proof.timestamp, signature: input.proof.signature, public_key: identities.get(grant.identityId)!.publicKey,
          raw_body: rawBody, body_sha256: missionSha256(input.bodyBytes) } };
      mission.events.push(event);
      return { created: true, data: { event } };
    }) as any,
  };
  /** The enrollment router's injected service: the API's schema and signing bytes. */
  const enroll = async (input: { projectId: string; origin: string; bodyBytes: Uint8Array; signature: string }) => {
    const body = identityEnrollmentSchema.parse(JSON.parse(Buffer.from(input.bodyBytes).toString("utf8")));
    if (body.project_id !== input.projectId || body.origin !== input.origin) throw new Error("enrollment bound to another project or origin");
    if (Math.abs(now().getTime() - Date.parse(body.timestamp)) > 300_000) throw new Error("enrollment outside its window");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(body.public_key, "base64").toString("base64url") }, format: "jwk" });
    if (!verify(null, canonicalIdentityEnrollmentBytes(input), key, Buffer.from(input.signature, "base64url"))) throw new Error("enrollment signature invalid");
    identities.set(body.identity_id, { keyId: body.signing_key_id, publicKey: body.public_key });
    operations.push("enroll");
    return {
      identity: { id: body.identity_id, did: `did:at:${body.identity_id}`, display_name: body.display_name, capabilities: body.capabilities, status: "active" as const },
      key: { kid: body.signing_key_id, public_key: body.public_key },
      authority: { mode: "agent_root" as const, root_public_key: body.public_key, sequence: 0, next_sequence: 1 },
    };
  };
  return { service, enroll, missions, grants, identities, operations, requests };
}

export type MemoryService = ReturnType<typeof memoryService>;

/** The real middleware stack in front of the real mission gateway and enrollment router. */
export function apiApp(memory: MemoryService) {
  const gateway = createMissionGateway({ origin: () => ORIGIN, service: memory.service as MissionGatewayDependencies["service"],
    verify: (async (token: string) => token === BEARER ? { ok: true, project: { id: PROJECT }, apiKey: { id: API_KEY } } : { ok: false }) as any });
  const enrollment = createIdentityEnrollmentRouter({ origin: () => ORIGIN, enroll: memory.enroll as any });
  const app = new Hono();
  app.use("*", collaborationTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("*", (c: any, next: () => Promise<void>) => isCollaborationPath(c.req.path) ? gateway(c) : next());
  // A stand-in for the project auth middleware in front of the real enrollment router.
  app.use("/v1/identities/enroll", async (c: any, next: () => Promise<void>) => {
    if (c.req.header("Authorization") !== `Bearer ${BEARER}`) return c.json({ error: "unauthorized" }, 401);
    c.set("project", { id: PROJECT });
    c.set("apiKeyId", API_KEY);
    await next();
  });
  app.route("/v1/identities/enroll", enrollment as any);
  app.all("*", (c: any) => c.json({ error: "outside_fixture" }, 404));
  return async (url: string, init: RequestInit) => app.request(url, init);
}

/** One desk on the real CLI with a scripted terminal; `cleanups` collects its temp directory. */
export function lobbyDesk(fetchImpl: (url: string, init: RequestInit) => Promise<Response>, now: () => Date, cleanups: Array<() => void>,
  advance: (ms: number) => void = () => {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "lobby-gateway-")));
  cleanups.push(() => rmSync(parent, { recursive: true, force: true }));
  const keychain = new FileSecretStore(join(parent, "keychain"));
  const answers: string[] = [];
  const shown: string[] = [];
  const openTty = (): TtyPort => ({ write: (text) => { shown.push(text); }, readLine: () => answers.shift() ?? null, close: () => {} });
  const exec = async (...argv: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = await runCli(argv, {
      stdout: text => out.push(text), stderr: text => err.push(text), env: { AGENTTOOL_LOBBY_HOME: join(parent, "lobby") },
      confirm: request => confirmOnTty(request, { openTty }), showOnTty: () => {}, now, fetchImpl, keychain, deviceTerms: [],
      hasTerminal: () => true, sleep: async ms => advance(ms),
    });
    return { code, stdout: out.join(""), stderr: err.join("") };
  };
  const run = async (...argv: string[]) => {
    const result = await exec(...argv);
    if (result.code !== 0) throw new Error(`agenttool-lobby ${argv.join(" ")} exited ${result.code}: ${result.stderr}`);
    return result.stdout;
  };
  /** The exact bytes most recently confirmed on this desk's terminal. */
  const lastBytes = () => {
    const lines = shown.join("").split("\n");
    const header = lines.map((line, index) => line.startsWith("exact bytes (") ? index : -1).filter(index => index >= 0).at(-1)!;
    return JSON.parse(lines[header + 1]!);
  };
  return {
    home: join(parent, "lobby"),
    keychain,
    run,
    exec,
    lastBytes,
    yes: (...argv: string[]) => { answers.push("yes"); return run(...argv); },
    file: (name: string, text: string) => { const path = join(parent, name); writeFileSync(path, text, { mode: 0o600 }); return path; },
  };
}
