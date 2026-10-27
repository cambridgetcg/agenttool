import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createMissionGateway, type MissionGatewayDependencies } from "../src/routes/collaboration";
import { collaborationTransportBoundary, isCollaborationPath, MISSION_ALLOWED_HEADERS } from "../src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../src/middleware/early-data";
import { apiCors } from "../src/middleware/api-cors";
import { MissionError, missionOperation, MISSION_PROOF_HEADERS } from "../src/services/collaboration/contracts";
import { COLLABORATION_OPENAPI_PATHS } from "../src/routes/openapi-collaboration";

const M = "11111111-2222-4333-8444-555555555555";
const G = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const K = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const BASE = "/v1/collaboration/missions";
const ORIGIN = "https://api.agenttool.dev";
const TOKEN = `atcm_${Buffer.alloc(32, 7).toString("base64url")}`;
const headers = () => ({ Authorization: `Bearer ${TOKEN}`, ...Object.fromEntries(Object.values(MISSION_PROOF_HEADERS).map(name => [name, "proof-value"])) });
function fixture(overrides: Partial<MissionGatewayDependencies> = {}) {
  const seen: any[] = [];
  let project = 0, downstream = 0;
  const service = {
    createMission: async (input: unknown) => { seen.push(input); return { mission_id: M }; },
    getMission: async (input: unknown) => { seen.push(input); return { mission_id: M }; },
    issueMissionGrant: async (input: unknown) => { seen.push(input); return { grant: { grant_id: G }, token: TOKEN }; },
    getMissionGrant: async (input: unknown) => { seen.push(input); return { grant_id: G }; },
    revokeMissionGrant: async (input: unknown) => { seen.push(input); return { grant_id: G }; },
    closeMissionGrantRenewal: async (input: unknown) => { seen.push({ close: input }); return { grant_id: G }; },
    revokeMission: async (input: unknown) => { seen.push(input); return { mission_id: M }; },
    executeMissionRequest: async (input: Parameters<MissionGatewayDependencies["service"]["executeMissionRequest"]>[0]) => {
      missionOperation(input); seen.push(input); return { created: input.method === "POST", data: { accepted: true } };
    },
  } as unknown as MissionGatewayDependencies["service"];
  const gateway = createMissionGateway({
    origin: () => ORIGIN, service,
    verify: async () => { project++; return { ok: true, project: { id: M }, apiKey: { id: K } } as any; },
    ...overrides,
  });
  const app = new Hono();
  app.use("*", collaborationTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("*", (c, next) => isCollaborationPath(c.req.path) ? gateway(c) : next());
  app.use("*", async (c, next) => { downstream++; c.header("X-Credits-Balance", "sentinel"); await next(); });
  app.all("*", c => c.json({ unrelated: true }));
  return { app, service, seen, counts: () => ({ project, downstream }) };
}
function privateResponse(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  for (const name of ["ETag", "X-Credits-Balance", "X-Welcomed", "X-Joy-Index", "X-Idempotency-Supported"]) expect(response.headers.get(name)).toBeNull();
  expect(response.status).not.toBe(304);
}

describe("sealed collaboration transport", () => {
  test("participant proof and exact bytes pass without project context or decorators", async () => {
    const f = fixture();
    const body = '{ "event_id": "'+G+'", "summary": "selected" }';
    const response = await f.app.request(`http://internal.invalid${BASE}/${M}/events`, { method: "POST", body,
      headers: { ...headers(), "Content-Type": "application/json", Host: "spoof.invalid", Origin: "https://spoof.invalid", "X-Forwarded-Host": "spoof.invalid", "Idempotency-Key": "do-not-replay", "X-Tutor": "1" } });
    expect(response.status).toBe(201); privateResponse(response);
    expect(f.counts()).toEqual({ project: 0, downstream: 0 });
    expect(f.seen[0].origin).toBe(ORIGIN);
    expect(new TextDecoder().decode(f.seen[0].bodyBytes)).toBe(body);
    expect(f.seen[0].requestTarget).toBe(`${BASE}/${M}/events`);
    expect(f.seen[0].proof.signature).toBe("proof-value");
  });
  test("acceptance is HTTP200 and event query spelling reaches independent service validation", async () => {
    const f = fixture();
    expect((await f.app.request(`${BASE}/${M}/accept`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json" }, body: "{}" })).status).toBe(200);
    expect((await f.app.request(`${BASE}/${M}/events?after=0&limit=2`, { headers: headers() })).status).toBe(200);
    for (const query of ["?", "?after=00", "?limit=2&after=0", "?limit=51", "?after=0&after=1"]) {
      const response = await f.app.request(`${BASE}/${M}/events${query}`, { headers: headers() });
      expect(response.status).toBe(400); privateResponse(response);
    }
  });
  test("credential types cannot substitute across administrator and participant routes", async () => {
    const f = fixture();
    for (const [path, token] of [[`${BASE}/${M}/context`, "at_project"], [`${BASE}/${M}/invitation`, "atlc_other"], [`${BASE}/${M}`, TOKEN]]) {
      const response = await f.app.request(path!, { headers: { Authorization: `Bearer ${token}` } });
      expect(response.status).toBe(401); privateResponse(response);
      const body = await response.json();
      expect(body.message.length).toBeGreaterThan(0);
      expect(body.next_actions.length).toBeGreaterThan(0);
      expect(body.docs).toBe("https://docs.agenttool.dev/COLLABORATION-MISSIONS.md");
    }
    expect(f.counts()).toEqual({ project: 0, downstream: 0 }); expect(f.seen).toEqual([]);
  });
  test("administrator issuance uses exact project/key and configured origin, never Redis replay", async () => {
    const f = fixture();
    const response = await f.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json", "Idempotency-Key": "same" }, body: JSON.stringify({ grant_id: G, identity_id: M, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T12:00:00.000Z" }) });
    expect(response.status).toBe(201); privateResponse(response);
    expect(f.seen[0]).toMatchObject({ projectId: M, issuerApiKeyId: K, origin: ORIGIN, missionId: M, grantId: G });
    expect(f.counts()).toEqual({ project: 1, downstream: 0 });
  });
  test("HEAD, aliases, unknown descendants, queries and method drift are terminal", async () => {
    const f = fixture();
    for (const [path, method, status] of [
      [`${BASE}/${M}/context`, "HEAD", 405], [`${BASE}/${M}/context/`, "GET", 404],
      [`${BASE}/${M}/%63ontext`, "GET", 404], [`/v1/%63ollaboration/missions/${M}/context`, "GET", 404],
      [`${BASE}/${M}/context?x=1`, "GET", 400], [`${BASE}/${M}/invitation/${G}`, "GET", 404],
      [`${BASE}/${M}/context`, "POST", 405], ["/v1/collaboration/unknown", "GET", 404],
    ] as const) {
      const response = await f.app.request(path, { method, headers: headers() });
      expect(response.status).toBe(status); privateResponse(response);
    }
    expect(f.seen).toEqual([]); expect(f.counts()).toEqual({ project: 0, downstream: 0 });
  });
  test("preflight and early data remain private before any credential or service access", async () => {
    const f = fixture();
    const preflight = await f.app.request(`${BASE}/${M}/events`, { method: "OPTIONS", headers: { Origin: ORIGIN, "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "evil-header" } });
    privateResponse(preflight);
    expect(preflight.headers.get("Access-Control-Allow-Headers")).toBe(MISSION_ALLOWED_HEADERS);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, POST, OPTIONS");
    const early = await f.app.request(`${BASE}/${M}/invitation`, { headers: { ...headers(), "Early-Data": "1" } });
    expect(early.status).toBe(425); privateResponse(early);
    expect(f.seen).toEqual([]); expect(f.counts()).toEqual({ project: 0, downstream: 0 });
  });
  test("bounded raw reader refuses oversized and encoded requests before service", async () => {
    const f = fixture();
    for (const init of [
      { body: "x".repeat(8193) }, { body: "{}", headers: { "Content-Length": "8193" } },
      { body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8193)); controller.close(); } }) },
    ]) {
      const response = await f.app.request(`${BASE}/${M}/events`, { method: "POST", ...init, headers: { ...headers(), "Content-Type": "application/json", ...init.headers } });
      expect(response.status).toBe(413); privateResponse(response);
    }
    expect((await f.app.request(`${BASE}/${M}/events`, { method: "POST", body: "{}", headers: { ...headers(), "Content-Type": "application/json", "Content-Encoding": "gzip" } })).status).toBe(400);
    expect(f.seen).toEqual([]);
  });
  test("duplicate administrator JSON fields fail closed; unexpected errors are sanitized", async () => {
    const f = fixture();
    const duplicate = await f.app.request(BASE, { method: "POST", body: '{"mission_id":"x","mission_id":"y"}', headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" } });
    expect(duplicate.status).toBe(400); privateResponse(duplicate); expect(f.seen).toEqual([]);
    f.service.executeMissionRequest = async () => { throw new Error("private sql parameter token sentinel"); };
    const unavailable = await f.app.request(`${BASE}/${M}/context`, { headers: headers() });
    expect(unavailable.status).toBe(503); privateResponse(unavailable);
    expect(await unavailable.text()).not.toContain("sentinel");
    f.service.executeMissionRequest = async () => { throw new MissionError("acceptance_required"); };
    expect((await f.app.request(`${BASE}/${M}/context`, { headers: headers() })).status).toBe(403);
  });
  test("a participant token hash reaches the service and its 201 carries no token", async () => {
    const f = fixture();
    const hash = "a".repeat(64);
    f.service.issueMissionGrant = (async (input: unknown) => { f.seen.push(input); return { grant: { grant_id: G }, token_sha256: hash, token_source: "participant" }; }) as never;
    const grant = { grant_id: G, identity_id: M, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T12:00:00.000Z" };
    const response = await f.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify({ ...grant, token_sha256: hash }) });
    expect(response.status).toBe(201); privateResponse(response);
    const body = await response.json();
    expect(body).toEqual({ grant: { grant_id: G }, token_sha256: hash, token_source: "participant" });
    expect(f.seen[0]).toMatchObject({ projectId: M, issuerApiKeyId: K, grantId: G, tokenSha256: hash, origin: ORIGIN });
    // Omitted: the service input has no hash field and the server-minted response passes through.
    const omitted = fixture();
    const minted = await omitted.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify(grant) });
    expect(minted.status).toBe(201);
    expect(await minted.json()).toEqual({ grant: { grant_id: G }, token: TOKEN });
    expect("tokenSha256" in omitted.seen[0]).toBe(false);
  });
  test("malformed token hashes are 400 before the service; conflicts keep their shared code", async () => {
    const f = fixture();
    const grant = { grant_id: G, identity_id: M, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T12:00:00.000Z" };
    for (const token_sha256 of ["A".repeat(64), "a".repeat(63), `sha256:${"a".repeat(64)}`, null, 7, TOKEN]) {
      const response = await f.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify({ ...grant, token_sha256 }) });
      expect(response.status).toBe(400); privateResponse(response);
      expect((await response.json()).error).toBe("invalid_token_sha256");
    }
    const unknown = await f.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify({ ...grant, token: TOKEN }) });
    expect(unknown.status).toBe(400); expect((await unknown.json()).error).toBe("invalid_mission_grant_request");
    expect(f.seen).toEqual([]);
    f.service.issueMissionGrant = async () => { throw new MissionError("token_hash_conflict"); };
    const conflict = await f.app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify({ ...grant, token_sha256: "b".repeat(64) }) });
    expect(conflict.status).toBe(409); privateResponse(conflict);
    expect(await conflict.json()).toMatchObject({ error: "token_hash_conflict", docs: "https://docs.agenttool.dev/COLLABORATION-MISSIONS.md" });
  });
  test("issuing with a participant hash still requires a live administrator bearer", async () => {
    const denied = fixture({ verify: async () => ({ ok: false }) as never });
    const body = JSON.stringify({ grant_id: G, identity_id: M, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T12:00:00.000Z", token_sha256: "c".repeat(64) });
    for (const [app, authorization] of [[denied.app, "Bearer at_revoked"], [fixture().app, `Bearer ${TOKEN}`], [fixture().app, ""]] as const) {
      const response = await app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: authorization, "Content-Type": "application/json" }, body });
      expect(response.status).toBe(401); privateResponse(response);
    }
    expect(denied.seen).toEqual([]);
  });
  test("OpenAPI documents the optional token hash and both issuance shapes", () => {
    const issue = (COLLABORATION_OPENAPI_PATHS as any)[`${BASE}/{mission_id}/grants`].post;
    const schema = issue.requestBody.content["application/json"].schema;
    expect(schema.properties.token_sha256.pattern).toBe("^[0-9a-f]{64}$");
    expect(schema.required).not.toContain("token_sha256");
    const shapes = issue.responses["201"].content["application/json"].schema.oneOf;
    expect(shapes.map((shape: any) => shape.required)).toEqual([["grant", "token"], ["grant", "token_sha256", "token_source"]]);
    expect(issue.responses["409"].description).toContain("token_hash_conflict");
    expect(issue.security).toEqual([{ bearerAuth: [] }]);
  });
  test("participant leave is a terminal zero-byte POST with proofs, HTTP200 and no project context", async () => {
    const f = fixture();
    const response = await f.app.request(`http://internal.invalid${BASE}/${M}/leave`, { method: "POST", headers: { ...headers(), Host: "spoof.invalid", "Idempotency-Key": "do-not-replay" } });
    expect(response.status).toBe(200); privateResponse(response);
    expect(f.counts()).toEqual({ project: 0, downstream: 0 });
    expect(f.seen[0]).toMatchObject({ method: "POST", requestTarget: `${BASE}/${M}/leave`, origin: ORIGIN, missionId: M, token: TOKEN });
    expect(f.seen[0].bodyBytes).toHaveLength(0);
    expect(f.seen[0].proof).toEqual({ grantId: "proof-value", identityId: "proof-value", keyId: "proof-value", timestamp: "proof-value", signature: "proof-value" });
    // A JSON content type with zero bytes is equally acceptable; the signed body is empty either way.
    expect((await f.app.request(`${BASE}/${M}/leave`, { method: "POST", headers: { ...headers(), "Content-Type": "application/json", "Content-Length": "0" } })).status).toBe(200);
  });
  test("leave refuses bodies, other methods, aliases, queries and non-participant credentials before the service", async () => {
    const f = fixture();
    for (const [path, init, status] of [
      [`${BASE}/${M}/leave`, { method: "POST", body: "{}", headers: { ...headers(), "Content-Type": "application/json" } }, 413],
      [`${BASE}/${M}/leave`, { method: "POST", headers: { ...headers(), "Content-Length": "1" } }, 413],
      [`${BASE}/${M}/leave`, { method: "GET", headers: headers() }, 405],
      [`${BASE}/${M}/leave`, { method: "HEAD", headers: headers() }, 405],
      [`${BASE}/${M}/leave/`, { method: "POST", headers: headers() }, 404],
      [`${BASE}/${M}/leave/${G}`, { method: "POST", headers: headers() }, 404],
      [`${BASE}/${M}/%6ceave`, { method: "POST", headers: headers() }, 404],
      [`${BASE}/${M}/leave?grant_id=${G}`, { method: "POST", headers: headers() }, 400],
      [`${BASE}/${M}/leave`, { method: "POST", headers: { ...headers(), Authorization: "Bearer at_project" } }, 401],
      [`${BASE}/${M}/leave`, { method: "POST", headers: { Authorization: "Bearer atlc_other" } }, 401],
      [`${BASE}/${M}/leave`, { method: "POST", headers: { ...headers(), "Content-Encoding": "gzip" } }, 400],
    ] as const) {
      const response = await f.app.request(path, init as RequestInit);
      expect(response.status).toBe(status); privateResponse(response);
      if (status === 405) expect(response.headers.get("Allow")).toBe("POST");
    }
    expect(f.seen).toEqual([]); expect(f.counts()).toEqual({ project: 0, downstream: 0 });
  });
  test("leave refusals from the service keep the participant error contract", async () => {
    const f = fixture();
    for (const [reason, status] of [["invalid_credential", 401], ["acceptance_required", 403], ["invalid_request", 400]] as const) {
      f.service.executeMissionRequest = async () => { throw new MissionError(reason); };
      const response = await f.app.request(`${BASE}/${M}/leave`, { method: "POST", headers: headers() });
      expect(response.status).toBe(status); privateResponse(response);
      expect((await response.json()).error).toBe(`collaboration_mission_${reason}`);
    }
  });
  test("OpenAPI documents leave as a bodiless participant operation with a fixed result", () => {
    const leave = (COLLABORATION_OPENAPI_PATHS as any)[`${BASE}/{mission_id}/leave`];
    expect(Object.keys(leave)).toEqual(["parameters", "post"]);
    expect(leave.post.requestBody).toBeUndefined();
    const result = leave.post.responses["200"].content["application/json"].schema;
    expect(result.required).toEqual(["mission_id", "grant_id", "status", "reason", "revoked_at"]);
    expect(result.properties.reason).toEqual({ const: "participant_left" });
    expect(result.properties.status).toEqual({ const: "revoked" });
  });
  test("OpenAPI gives every participant path the narrow scheme and five required proofs", () => {
    for (const suffix of ["invitation", "accept", "context", "events", "leave", "renew"]) {
      const path = COLLABORATION_OPENAPI_PATHS[`${BASE}/{mission_id}/${suffix}`] as any;
      for (const method of ["get", "post"]) if (path[method]) {
        expect(path[method].security).toEqual([{ missionGrant: [] }]);
        expect(path[method].parameters.filter((p: any) => p.in === "header" && p.required).map((p: any) => p.name)).toEqual(Object.values(MISSION_PROOF_HEADERS));
      }
    }
  });
  test("participant renew is a JSON POST with proofs: 201 when created, 200 on exact retry, no project context", async () => {
    const f = fixture();
    const body = JSON.stringify({ grant_id: K, mission_digest: `sha256:${"a".repeat(64)}`, token_sha256: "b".repeat(64) });
    const created = await f.app.request(`http://internal.invalid${BASE}/${M}/renew`, { method: "POST", body,
      headers: { ...headers(), "Content-Type": "application/json", Host: "spoof.invalid", "Idempotency-Key": "do-not-replay" } });
    expect(created.status).toBe(201); privateResponse(created);
    expect(f.counts()).toEqual({ project: 0, downstream: 0 });
    expect(f.seen[0]).toMatchObject({ method: "POST", requestTarget: `${BASE}/${M}/renew`, origin: ORIGIN, missionId: M, token: TOKEN });
    expect(new TextDecoder().decode(f.seen[0].bodyBytes)).toBe(body);
    f.service.executeMissionRequest = (async () => ({ created: false, data: { replay: true } })) as never;
    const replay = await f.app.request(`${BASE}/${M}/renew`, { method: "POST", body, headers: { ...headers(), "Content-Type": "application/json" } });
    expect(replay.status).toBe(200); privateResponse(replay);
    expect(await replay.json()).toEqual({ replay: true });
    f.service.executeMissionRequest = async () => { throw new MissionError("renewal_unavailable"); };
    const closed = await f.app.request(`${BASE}/${M}/renew`, { method: "POST", body, headers: { ...headers(), "Content-Type": "application/json" } });
    expect(closed.status).toBe(403); privateResponse(closed);
    expect((await closed.json()).error).toBe("collaboration_mission_renewal_unavailable");
  });
  test("renew refuses other methods, queries, non-JSON, oversize, encoding and project bearers before the service", async () => {
    const f = fixture();
    const json = { ...headers(), "Content-Type": "application/json" };
    for (const [path, init, status] of [
      [`${BASE}/${M}/renew`, { method: "GET", headers: headers() }, 405],
      [`${BASE}/${M}/renew?grant_id=${G}`, { method: "POST", body: "{}", headers: json }, 400],
      [`${BASE}/${M}/renew`, { method: "POST", body: "{}", headers: headers() }, 415],
      [`${BASE}/${M}/renew`, { method: "POST", body: "x".repeat(8193), headers: json }, 413],
      [`${BASE}/${M}/renew`, { method: "POST", body: "{}", headers: { ...json, "Content-Encoding": "gzip" } }, 400],
      [`${BASE}/${M}/renew`, { method: "POST", body: "{}", headers: { ...json, Authorization: "Bearer at_project" } }, 401],
      [`${BASE}/${M}/renew/`, { method: "POST", body: "{}", headers: json }, 404],
      [`${BASE}/${M}/renew/${G}`, { method: "POST", body: "{}", headers: json }, 404],
    ] as const) {
      const response = await f.app.request(path, init as RequestInit);
      expect(response.status).toBe(status); privateResponse(response);
      if (status === 405) expect(response.headers.get("Allow")).toBe("POST");
    }
    expect(f.seen).toEqual([]); expect(f.counts()).toEqual({ project: 0, downstream: 0 });
  });
  test("closing a renewal window is a zero-byte administrator POST on one exact path", async () => {
    const f = fixture();
    const admin = { Authorization: "Bearer at_project" };
    const closed = await f.app.request(`${BASE}/${M}/grants/${G}/renewal/close`, { method: "POST", headers: { ...admin, "Idempotency-Key": "same" } });
    expect(closed.status).toBe(200); privateResponse(closed);
    expect(await closed.json()).toEqual({ grant: { grant_id: G } });
    expect(f.seen).toEqual([{ close: { projectId: M, missionId: M, grantId: G } }]);
    expect(f.counts()).toEqual({ project: 1, downstream: 0 });
    for (const [path, init, status] of [
      [`${BASE}/${M}/grants/${G}/renewal/close`, { method: "POST", body: "{}", headers: { ...admin, "Content-Type": "application/json" } }, 413],
      [`${BASE}/${M}/grants/${G}/renewal/close`, { method: "POST", headers: { ...admin, "Content-Length": "1" } }, 413],
      [`${BASE}/${M}/grants/${G}/renewal/close`, { method: "POST", headers: headers() }, 401],
      [`${BASE}/${M}/grants/${G}/renewal/close`, { method: "GET", headers: admin }, 405],
      [`${BASE}/${M}/grants/${G}/renewal/close?now=1`, { method: "POST", headers: admin }, 400],
      [`${BASE}/${M}/grants/${G}/renewal`, { method: "POST", headers: admin }, 404],
      [`${BASE}/${M}/grants/${G}/renewal/open`, { method: "POST", headers: admin }, 404],
      [`${BASE}/${M}/grants/${G}/renewal/close/`, { method: "POST", headers: admin }, 404],
    ] as const) {
      const response = await f.app.request(path, init as RequestInit);
      expect(response.status).toBe(status); privateResponse(response);
      if (status === 404) expect((await response.json()).error).toBe("mission_route_not_found");
      if (status === 405) expect(response.headers.get("Allow")).toBe("POST");
    }
    expect(f.seen).toHaveLength(1);
    // Revoke and inspect keep their routes and services.
    await f.app.request(`${BASE}/${M}/grants/${G}/revoke`, { method: "POST", headers: admin });
    await f.app.request(`${BASE}/${M}/grants/${G}`, { headers: admin });
    expect(f.seen.slice(1)).toEqual([{ projectId: M, missionId: M, grantId: G }, { projectId: M, missionId: M, grantId: G }]);
  });
  test("grant issue forwards renewable_until only when present, and refuses a noncanonical one", async () => {
    const grant = { grant_id: G, identity_id: M, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T12:00:00.000Z" };
    const request = (f: ReturnType<typeof fixture>, value: object) => f.app.request(`${BASE}/${M}/grants`, { method: "POST",
      headers: { Authorization: "Bearer at_project", "Content-Type": "application/json" }, body: JSON.stringify(value) });
    const windowed = fixture();
    expect((await request(windowed, { ...grant, renewable_until: "2026-09-29T09:00:00.000Z" })).status).toBe(201);
    expect(windowed.seen[0].renewableUntil).toBe("2026-09-29T09:00:00.000Z");
    const plain = fixture();
    expect((await request(plain, grant)).status).toBe(201);
    expect("renewableUntil" in plain.seen[0]).toBe(false);
    const malformed = fixture();
    const refused = await request(malformed, { ...grant, renewable_until: "2026-09-29T09:00:00Z" });
    expect(refused.status).toBe(400); expect((await refused.json()).error).toBe("invalid_mission_grant_request");
    expect(malformed.seen).toEqual([]);
  });
  test("OpenAPI documents renew, the window field and the close route", () => {
    const paths = COLLABORATION_OPENAPI_PATHS as any;
    const issue = paths[`${BASE}/{mission_id}/grants`].post.requestBody.content["application/json"].schema;
    expect(issue.properties.renewable_until).toMatchObject({ type: "string", format: "date-time" });
    expect(issue.required).not.toContain("renewable_until");
    const renew = paths[`${BASE}/{mission_id}/renew`];
    expect(Object.keys(renew)).toEqual(["parameters", "post"]);
    const schema = renew.post.requestBody.content["application/json"].schema;
    expect(schema).toMatchObject({ additionalProperties: false, required: ["grant_id", "mission_digest", "token_sha256"] });
    expect(Object.keys(renew.post.responses)).toEqual(expect.arrayContaining(["200", "201", "400", "401", "403", "409"]));
    expect(renew.post.responses["403"].description).toContain("collaboration_mission_renewal_unavailable");
    expect(renew.post.security).toEqual([{ missionGrant: [] }]);
    const close = paths[`${BASE}/{mission_id}/grants/{grant_id}/renewal/close`];
    expect(Object.keys(close)).toEqual(["parameters", "post"]);
    expect(close.post.requestBody).toBeUndefined();
    expect(close.post.security).toEqual([{ bearerAuth: [] }]);
  });
});
