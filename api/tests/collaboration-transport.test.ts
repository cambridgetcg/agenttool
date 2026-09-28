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
  test("OpenAPI gives every participant path the narrow scheme and five required proofs", () => {
    for (const suffix of ["invitation", "accept", "context", "events"]) {
      const path = COLLABORATION_OPENAPI_PATHS[`${BASE}/{mission_id}/${suffix}`] as any;
      for (const method of ["get", "post"]) if (path[method]) {
        expect(path[method].security).toEqual([{ missionGrant: [] }]);
        expect(path[method].parameters.filter((p: any) => p.in === "header" && p.required).map((p: any) => p.name)).toEqual(Object.values(MISSION_PROOF_HEADERS));
      }
    }
  });
});
