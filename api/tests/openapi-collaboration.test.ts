import { describe, expect, test } from "bun:test";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import * as ed from "@noble/ed25519";
import { Hono } from "hono";
import openapiRouter from "../src/routes/openapi";
import { createMissionGateway, type MissionGatewayDependencies } from "../src/routes/collaboration";
import { collaborationTransportBoundary } from "../src/middleware/collaboration-boundary";
import { earlyDataReplayProtection } from "../src/middleware/early-data";
import * as store from "../src/services/collaboration/store";
import { correspondenceCanonicalJson } from "../src/services/correspondence/canonical";
import { canonicalMissionRequestBytes, missionSha256 } from "../src/services/collaboration/proof";
import { MISSION_PROOF_HEADERS, type MissionRequest } from "../src/services/collaboration/contracts";

const BASE = "/v1/collaboration/missions";
const M = "11111111-2222-4333-8444-555555555555";
const P = "22222222-2222-4222-8222-222222222222";
const K = "33333333-3333-4333-8333-333333333333";
const G = "44444444-4444-4444-8444-444444444444";
const I = "55555555-5555-4555-8555-555555555555";
const E = "66666666-6666-4666-8666-666666666666";
const PRIVATE_KEY = new Uint8Array(32).fill(7);
const PUBLIC_KEY = Buffer.from(ed.getPublicKey(PRIVATE_KEY)).toString("base64");
const TOKEN = `atcm_${Buffer.alloc(32, 7).toString("base64url")}`;
const NOW = new Date("2026-09-28T10:00:00.000Z");
const descriptor = {
  format: "agenttool-collaboration-mission/v1",
  purpose: "Exchange synthetic observations only",
  resources: [],
  acceptance_criteria: ["Keep observation receipts distinct from task authority"],
  principalities: [],
};
function missionRow() {
  return {
    id: M, projectId: P, creatorApiKeyId: K, descriptor,
    digest: `sha256:${missionSha256(correspondenceCanonicalJson(descriptor))}`,
    createdAt: NOW, expiresAt: new Date("2026-09-29T10:00:00.000Z"),
    revokedAt: null, lastReceiptSeq: 0n,
  };
}
function grantRow() {
  return {
    id: G, missionId: M, projectId: P, identityId: I, signingKeyId: K,
    issuingApiKeyId: K, origin: "https://api.agenttool.dev",
    actions: ["mission.read", "mission.observe"], issuedAt: NOW,
    expiresAt: new Date("2026-09-28T11:00:00.000Z"),
    acceptedAt: null, revokedAt: null, tokenHash: "not-a-response-field",
  };
}
// Substitute only database rows: the real gateway and store serializer run.
// This fixture establishes response shape, not SQL ownership or lock behavior.
function readDatabase(row: object): NonNullable<store.MissionOptions["database"]> {
  return { transaction: async (work: (tx: unknown) => unknown) => work({
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [row] }) }) }),
  }) } as unknown as NonNullable<store.MissionOptions["database"]>;
}
function participantDatabase(events: object[] = [], lastReceiptSeq = 0n) {
  const grant = { ...grantRow(), acceptedAt: NOW, acceptanceProof: {}, tokenHash: missionSha256(TOKEN) };
  const rows = [
    [grant], [{ id: I, projectId: P, status: "active" }],
    [{ id: K, identityId: I, publicKey: PUBLIC_KEY, active: true, revokedAt: null }],
    [{ id: K, projectId: P, revokedAt: null, expiresAt: null }],
    [{ ...missionRow(), lastReceiptSeq }], [grant], events,
  ];
  const inserted: object[] = [];
  const database = { transaction: async (work: (tx: unknown) => unknown) => work({
    select: () => {
      const selected = rows.shift();
      if (!selected) throw new Error("Unexpected synthetic database read");
      const query = { from: () => query, where: () => query, for: () => query,
        orderBy: () => query, limit: async () => selected };
      return query;
    },
    insert: () => ({ values: (row: object) => ({ returning: async () => { inserted.push(row); return [row]; } }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
  }) } as unknown as NonNullable<store.MissionOptions["database"]>;
  return { database, inserted };
}
function signedRequest(method: "GET" | "POST", suffix: string, body = ""): MissionRequest {
  const input: MissionRequest = {
    token: TOKEN, missionId: M, origin: "https://api.agenttool.dev", method,
    requestTarget: `${BASE}/${M}${suffix}`, bodyBytes: Buffer.from(body),
    proof: { grantId: G, identityId: I, keyId: K, timestamp: NOW.toISOString(), signature: "" },
  };
  input.proof.signature = Buffer.from(ed.sign(canonicalMissionRequestBytes(input), PRIVATE_KEY)).toString("base64url");
  return input;
}
async function participantResponse(input: MissionRequest, database: NonNullable<store.MissionOptions["database"]>) {
  const app = gateway({ executeMissionRequest: request => store.executeMissionRequest(request, { database, now: NOW }) });
  const headers = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json",
    ...Object.fromEntries(Object.entries(MISSION_PROOF_HEADERS).map(([key, name]) => [name, input.proof[key as keyof typeof input.proof]])),
  };
  return app.request(input.requestTarget, { method: input.method, headers,
    ...(input.method === "POST" ? { body: Buffer.from(input.bodyBytes) } : {}),
  });
}
function gateway(service: Partial<MissionGatewayDependencies["service"]>) {
  const unconfigured = async () => { throw new Error("Unconfigured synthetic service operation"); };
  const app = new Hono();
  app.use("*", collaborationTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.all("*", createMissionGateway({
    origin: () => "https://api.agenttool.dev",
    verify: async () => ({ ok: true, project: { id: P }, apiKey: { id: K } }) as Awaited<ReturnType<MissionGatewayDependencies["verify"]>>,
    service: {
      createMission: unconfigured, getMission: unconfigured,
      issueMissionGrant: unconfigured, getMissionGrant: unconfigured,
      revokeMission: unconfigured, revokeMissionGrant: unconfigured,
      executeMissionRequest: unconfigured, ...service,
    },
  }));
  return app;
}
async function responseValidator(path: string, method: string, status: number) {
  const response = await openapiRouter.request("/");
  expect(response.status).toBe(200);
  const spec = await response.json();
  const definition = spec.paths[path][method].responses[String(status)];
  const schema = definition.content?.["application/json"]?.schema;
  expect(schema).toBeDefined();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  return ajv.compile({ ...schema, components: spec.components });
}

describe("mission OpenAPI response contracts", () => {
  test("mission read schema validates the actual store view, including revocation", async () => {
    const validate = await responseValidator(`${BASE}/{mission_id}`, "get", 200);
    for (const revokedAt of [null, NOW]) {
      const app = gateway({ getMission: input => store.getMission(input, {
        database: readDatabase({ ...missionRow(), revokedAt }),
      }) });
      const response = await app.request(`${BASE}/${M}`, { headers: { Authorization: "Bearer at_synthetic" } });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(validate(body)).toBe(true);
      expect(validate({ ...body, token: "not-a-readable-field" })).toBe(false);
      expect(validate({ mission: { ...body.mission, authority: "task_owner" } })).toBe(false);
      expect(validate({ mission: { ...body.mission, revoked_at: false } })).toBe(false);
    }
  });

  test("mission create and revoke describe the same closed metadata envelope", async () => {
    const metadata = await store.getMission({ projectId: P, missionId: M }, { database: readDatabase(missionRow()) });
    const app = gateway({ createMission: async () => metadata, revokeMission: async () => ({ ...metadata, revoked_at: NOW.toISOString() }) });
    for (const [template, path, status, body] of [
      [BASE, BASE, 201, JSON.stringify({ mission_id: M, descriptor, expires_at: "2026-09-29T10:00:00.000Z" })],
      [`${BASE}/{mission_id}/revoke`, `${BASE}/${M}/revoke`, 200, undefined],
    ] as const) {
      const validate = await responseValidator(template, "post", status);
      const response = await app.request(path, { method: "POST", headers: { Authorization: "Bearer at_synthetic", "Content-Type": "application/json" }, body });
      expect(response.status).toBe(status);
      expect(validate(await response.json())).toBe(true);
    }
  });

  test("grant read and revoke schemas never accept the issuance credential", async () => {
    for (const acceptedAt of [null, NOW]) {
      for (const revokedAt of [null, NOW]) {
        const grant = await store.getMissionGrant({ projectId: P, missionId: M, grantId: G }, {
          database: readDatabase({ ...grantRow(), acceptedAt, revokedAt }),
        });
        const app = gateway({ getMissionGrant: async () => grant, revokeMissionGrant: async () => ({ ...grant, revoked_at: NOW.toISOString() }) });
        for (const [suffix, method] of [["", "get"], ["/revoke", "post"]] as const) {
          const validate = await responseValidator(`${BASE}/{mission_id}/grants/{grant_id}${suffix}`, method, 200);
          const response = await app.request(`${BASE}/${M}/grants/${G}${suffix}`, { method: method.toUpperCase(), headers: { Authorization: "Bearer at_synthetic" } });
          expect(response.status).toBe(200);
          const body = await response.json();
          expect(validate(body)).toBe(true);
          expect(body.grant).not.toHaveProperty("tokenHash");
          expect(validate({ ...body, token: "unexpected" })).toBe(false);
          expect(validate({ grant: { ...body.grant, token_hash: "unexpected" } })).toBe(false);
          expect(validate({ grant: { ...body.grant, actions: ["mission.execute"] } })).toBe(false);
          expect(validate({ grant: { ...body.grant, accepted_at: 0 } })).toBe(false);
        }
      }
    }
  });

  test("grant issuance is the only success envelope carrying a required token", async () => {
    const grant = await store.getMissionGrant({ projectId: P, missionId: M, grantId: G }, { database: readDatabase(grantRow()) });
    const token = `atcm_${Buffer.alloc(32, 7).toString("base64url")}`;
    const app = gateway({ issueMissionGrant: async () => ({ grant, token }) });
    const validate = await responseValidator(`${BASE}/{mission_id}/grants`, "post", 201);
    const response = await app.request(`${BASE}/${M}/grants`, { method: "POST", headers: { Authorization: "Bearer at_synthetic", "Content-Type": "application/json" }, body: JSON.stringify({ grant_id: G, identity_id: I, signing_key_id: K, actions: ["mission.read"], expires_at: "2026-09-28T11:00:00.000Z" }) });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(validate(body)).toBe(true);
    expect(validate({ grant })).toBe(false);
    expect(validate({ ...body, token: "at_project" })).toBe(false);
  });

  test("invitation, acceptance and context describe both selected views without a token", async () => {
    const mission = await store.getMission({ projectId: P, missionId: M }, { database: readDatabase(missionRow()) });
    for (const [suffix, method] of [["invitation", "get"], ["accept", "post"], ["context", "get"]] as const) {
      const grant = await store.getMissionGrant({ projectId: P, missionId: M, grantId: G }, { database: readDatabase({ ...grantRow(), acceptedAt: suffix === "invitation" ? null : NOW }) });
      const app = gateway({ executeMissionRequest: async () => ({ created: suffix === "accept", data: { mission, grant } }) });
      const validate = await responseValidator(`${BASE}/{mission_id}/${suffix}`, method, 200);
      const response = await app.request(`${BASE}/${M}/${suffix}`, {
        method: method.toUpperCase(), headers: { Authorization: `Bearer atcm_${Buffer.alloc(32, 7).toString("base64url")}`, "Content-Type": "application/json" },
        ...(method === "post" ? { body: JSON.stringify({ mission_digest: mission.mission_digest }) } : {}),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(validate(body)).toBe(true);
      expect(validate({ mission })).toBe(false);
      expect(validate({ ...body, token: "not-in-participant-reads" })).toBe(false);
    }
  });

  test("new and replayed observation receipts validate the real signed service output", async () => {
    const raw = JSON.stringify({ event_id: E, summary: "Synthetic evidence 雨夜 🙂", seat: { device_id: "fixture", session_id: "fixture", harness: "bun-test" } });
    const first = participantDatabase();
    const created = await participantResponse(signedRequest("POST", "/events", raw), first.database);
    expect(created.status).toBe(201);
    const body = await created.json();
    for (const status of [201, 200]) {
      const validate = await responseValidator(`${BASE}/{mission_id}/events`, "post", status);
      expect(validate(body)).toBe(true);
      expect(validate({ event: { ...body.event, received_seq: 1 } })).toBe(false);
      expect(validate({ event: { ...body.event, body_sha256: `sha256:${body.event.body_sha256}` } })).toBe(false);
      expect(validate({ event: { ...body.event, proof: { ...body.event.proof, signature: "bad" } } })).toBe(false);
      expect(validate({ event: { ...body.event, token: "not-a-receipt-field" } })).toBe(false);
    }
    const replay = await participantResponse(signedRequest("POST", "/events", raw), participantDatabase(first.inserted).database);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(body);
    expect(body.event.raw_body).toBe(raw);
  });

  test("event page schemas match cursor advancement and an empty terminal page", async () => {
    const records: object[] = [];
    for (const [index, event_id] of [E, "77777777-7777-4777-8777-777777777777"].entries()) {
      const fixture = participantDatabase([], BigInt(index));
      const response = await participantResponse(signedRequest("POST", "/events", JSON.stringify({ event_id, summary: `Synthetic observation ${index}` })), fixture.database);
      expect(response.status).toBe(201);
      records.push(...fixture.inserted);
    }
    const validate = await responseValidator(`${BASE}/{mission_id}/events`, "get", 200);
    const received: string[] = [];
    for (const [after, selected, next_cursor, has_more] of [
      ["0", records, "1", true], ["1", records.slice(1), "2", false], ["2", [], "2", false],
    ] as const) {
      const response = await participantResponse(signedRequest("GET", `/events?after=${after}&limit=1`), participantDatabase([...selected], 2n).database);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(validate(body)).toBe(true);
      expect(body.page).toEqual({ after, next_cursor, has_more });
      received.push(...body.events.map((event: { event_id: string }) => event.event_id));
      expect(validate({ ...body, page: { ...body.page, after: 0 } })).toBe(false);
      expect(validate({ ...body, page: { ...body.page, next_cursor: null } })).toBe(false);
      expect(validate({ ...body, page: { ...body.page, next_cursor: "00" } })).toBe(false);
      expect(validate({ ...body, page: { ...body.page, has_more: "false" } })).toBe(false);
    }
    expect(received).toEqual([E, "77777777-7777-4777-8777-777777777777"]);
  });

  test("documented errors validate actual transport and service refusals", async () => {
    const cases: Array<{ status: number; path?: string; method?: string; headers?: Record<string, string>; body?: string; service?: Partial<MissionGatewayDependencies["service"]> }> = [
      { status: 400, path: `${BASE}/${M}/context?unexpected=1` },
      { status: 401, headers: { Authorization: "" } },
      { status: 403, service: { executeMissionRequest: async () => { throw new store.MissionError("acceptance_required"); } } },
      { status: 404, path: `${BASE}/${M}`, service: { getMission: async () => { throw new store.MissionError("not_found"); } }, headers: { Authorization: "Bearer at_synthetic" } },
      { status: 405, method: "POST" },
      { status: 409, service: { executeMissionRequest: async () => { throw new store.MissionError("conflict"); } } },
      { status: 413, path: `${BASE}/${M}/events`, method: "POST", body: " ".repeat(8193) },
      { status: 415, path: `${BASE}/${M}/events`, method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" },
      { status: 425, headers: { "Early-Data": "1" } },
      { status: 503 },
    ];
    for (const item of cases) {
      const app = gateway(item.service ?? {});
      const response = await app.request(item.path ?? `${BASE}/${M}/context`, {
        method: item.method ?? "GET", headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", ...item.headers }, body: item.body,
      });
      expect(response.status).toBe(item.status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.has("etag")).toBe(false);
      const body = await response.json();
      const validate = await responseValidator(`${BASE}/{mission_id}/context`, "get", item.status);
      expect(validate(body)).toBe(true);
      expect(validate({ ...body, token: "not-an-error-field" })).toBe(false);
      if (item.status === 425) {
        expect(body).not.toHaveProperty("docs");
        expect(response.headers.get("retry-after")).toBe("0");
      } else {
        expect(validate({ ...body, _quip: "Optional guided-error quip" })).toBe(true);
      }
    }
  });

  test("every declared mission response has resolvable JSON schemas and cache headers", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    let operations = 0;
    for (const [path, methods] of Object.entries(spec.paths)) {
      if (!path.startsWith(BASE)) continue;
      for (const [method, operation] of Object.entries(methods as Record<string, any>)) {
        if (!["get", "post"].includes(method)) continue;
        operations++;
        for (const [status, definition] of Object.entries(operation.responses as Record<string, any>)) {
          const schema = definition.content?.["application/json"]?.schema;
          expect(schema).toBeDefined();
          expect(() => ajv.compile({ ...schema, components: spec.components })).not.toThrow();
          expect(definition.headers?.["Cache-Control"].schema.const).toBe("private, no-store");
          if (status === "425") expect(definition.headers["Retry-After"].schema.const).toBe("0");
        }
      }
    }
    expect(operations).toBe(11);
  });
});
