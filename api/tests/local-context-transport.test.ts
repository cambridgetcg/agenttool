import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { generateApiKey } from "../src/auth/keys";
import { verifyBearer, type ProjectContext } from "../src/auth/middleware";
import { db } from "../src/db/client";
import { errors } from "../src/lib/errors";
import { apiCors } from "../src/middleware/api-cors";
import { earlyDataReplayProtection } from "../src/middleware/early-data";
import { localContextTransportBoundary } from "../src/middleware/local-context-boundary";
import { joyIndex } from "../src/middleware/joy-index";
import { play } from "../src/middleware/play";
import { tutor } from "../src/middleware/tutor";
import { welcomeEcho } from "../src/middleware/welcome";
import { rateLimitHeaders } from "../src/middleware/rate-limit-headers";
import { configuredLocalContextOrigin, createSealedLocalContextHandler, type LocalContextReadDependencies } from "../src/routes/identity/local-context";
import { packLocalContext } from "../src/services/identity/local-context";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const IDENTITY = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const GRANT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const KEY = "dddddddd-cccc-4ddd-8eee-ffffffffffff";
const ORIGIN = "https://api.agenttool.dev";
const PATH = `/v1/identities/${IDENTITY}/local-context`;
const TOKEN = `atlc_${Buffer.alloc(32, 7).toString("base64url")}`;
const NOW = new Date("2026-09-27T22:00:00.000Z");
const v1 = () => packLocalContext(PROJECT, IDENTITY, [], NOW);
const v2 = () => ({
  ...v1(), format: "agenttool-local-api-context/v2" as const,
  scope: { ...v1().scope, authentication: "local_context_grant" as const, bearer_attenuated: true as const },
  authorization: {
    grant_id: GRANT, origin: ORIGIN, action: "local_context.read" as const,
    method: "GET" as const, path: PATH, issued_at: "2026-09-27T21:59:00.000Z",
    expires_at: "2026-09-27T23:00:00.000Z", checked_at: NOW.toISOString(),
  },
});

const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });

function productionOrder(dependencies: Partial<LocalContextReadDependencies> = {}) {
  const calls = { projectAuth: 0, projectRead: 0, grantRead: 0, downstream: 0 };
  const seen: unknown[] = [];
  const app = new Hono<ProjectContext>();
  app.use("*", localContextTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.all("/v1/identities/:id/local-context", createSealedLocalContextHandler({
    origin: () => ORIGIN,
    verifyProjectBearer: async (token, options) => {
      calls.projectAuth++;
      seen.push({ token, options });
      return { ok: true, project: { id: PROJECT }, apiKey: { id: KEY } } as Awaited<ReturnType<typeof verifyBearer>>;
    },
    readProject: async (projectId, identityId) => { calls.projectRead++; seen.push({ projectId, identityId }); return v1(); },
    readGrant: async input => { calls.grantRead++; seen.push(input); return v2(); },
    ...dependencies,
  }));
  app.use("*", async (_c, next) => { calls.downstream++; await next(); });
  // These are the real production decorators and balance middleware. A sealed
  // read must terminate before any of them is entered, not merely strip JSON.
  app.use("*", joyIndex());
  app.use("*", welcomeEcho());
  app.use("*", play());
  app.use("*", tutor);
  app.use("/v1/identities/*", rateLimitHeaders());
  return { app, calls, seen };
}

function privateResponse(response: Response) {
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  for (const header of ["ETag", "X-Credits-Balance", "X-Welcomed", "X-Joy-Index", "X-Idempotency-Supported"]) {
    expect(response.headers.get(header)).toBeNull();
  }
}

describe("sealed local-context transport", () => {
  test("preserves project v1 while disabling auth telemetry and all ordinary decorators", async () => {
    const { app, calls, seen } = productionOrder();
    const response = await app.request(`${ORIGIN}${PATH}`, { headers: { Authorization: "Bearer at_project", "X-Tutor": "1", "X-Play": "on" } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(v1());
    privateResponse(response);
    expect(calls).toEqual({ projectAuth: 1, projectRead: 1, grantRead: 0, downstream: 0 });
    expect(seen[0]).toEqual({ token: "at_project", options: { recordLastUsed: false } });
  });

  test("grant v2 uses only its verifier and configured audience, ignoring spoofed proxy headers", async () => {
    const { app, calls, seen } = productionOrder();
    const response = await app.request(`http://internal.example${PATH}`, { headers: {
      Authorization: `Bearer ${TOKEN}`, Host: "evil.example", Origin: "https://evil.example",
      Forwarded: "host=evil.example;proto=http", "X-Forwarded-Host": "evil.example", "X-Forwarded-Proto": "http",
      "X-Tutor": "1", "X-Play": "on", "Payment-Signature": "untrusted", "Idempotency-Key": "untrusted",
    } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(v2());
    privateResponse(response);
    expect(calls).toEqual({ projectAuth: 0, projectRead: 0, grantRead: 1, downstream: 0 });
    expect(seen).toEqual([{ token: TOKEN, identityId: IDENTITY, origin: ORIGIN, method: "GET", path: PATH, query: "" }]);
  });

  test("preflight and early-data refusals remain private without authenticating", async () => {
    const { app, calls } = productionOrder();
    const preflight = await app.request(`${ORIGIN}${PATH}`, { method: "OPTIONS", headers: { Origin: "https://reader.example", "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "Authorization" } });
    expect(preflight.status).toBe(204);
    privateResponse(preflight);
    expect(preflight.headers.get("Access-Control-Allow-Methods")).toBe("GET, OPTIONS");
    const early = await app.request(`${ORIGIN}${PATH}`, { headers: { Authorization: `Bearer ${TOKEN}`, "Early-Data": "1" } });
    expect(early.status).toBe(425);
    privateResponse(early);
    expect(calls).toEqual({ projectAuth: 0, projectRead: 0, grantRead: 0, downstream: 0 });
  });

  test("methods, query and encoded selectors are rejected before credential or memory lookup", async () => {
    const { app, calls } = productionOrder();
    for (const method of ["POST", "PUT", "DELETE", "HEAD"]) {
      const response = await app.request(`${ORIGIN}${PATH}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(405);
      privateResponse(response);
    }
    for (const path of [`${PATH}?`, `${PATH}?limit=1`, PATH.replace(IDENTITY, `%36${IDENTITY.slice(1)}`), PATH.replace(IDENTITY, "me")]) {
      const response = await app.request(`${ORIGIN}${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(400);
      privateResponse(response);
    }
    expect(calls).toEqual({ projectAuth: 0, projectRead: 0, grantRead: 0, downstream: 0 });
  });

  test("missing credentials and service failures never fall back, reflect secrets or add framing", async () => {
    const refused = productionOrder();
    const missing = await refused.app.request(`${ORIGIN}${PATH}`);
    expect(missing.status).toBe(401);
    privateResponse(missing);
    expect(refused.calls.projectAuth).toBe(0);
    for (const error of [new Error(`private database detail ${TOKEN}`), new HTTPException(401, { cause: errors.refusal({ error: "local_context_grant_invalid", message: "Grant refused", docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md" }) })]) {
      const { app, calls } = productionOrder({ readGrant: async () => { throw error; } });
      const response = await app.request(`${ORIGIN}${PATH}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(error instanceof HTTPException ? 401 : 503);
      privateResponse(response);
      expect(await response.text()).not.toContain(TOKEN);
      expect(calls.projectAuth + calls.projectRead + calls.downstream).toBe(0);
    }
  });

  test("configured audience is an exact HTTPS origin with no request-based fallback", () => {
    expect(configuredLocalContextOrigin(ORIGIN)).toBe(ORIGIN);
    for (const value of ["", `${ORIGIN}/`, `${ORIGIN}/path`, `${ORIGIN}?q=1`, `${ORIGIN}#x`, "https://u:p@api.agenttool.dev", "http://127.0.0.1", " HTTPS://api.agenttool.dev "]) {
      expect(() => configuredLocalContextOrigin(value)).toThrow(HTTPException);
    }
  });

  test("the ordinary bearer verifier rejects grants before database work", async () => {
    const select = spyOn(db, "select").mockImplementation(() => { throw new Error("ordinary DB lookup forbidden"); });
    restores.push(() => select.mockRestore());
    expect(await verifyBearer(TOKEN)).toEqual({ ok: false, reason: "wrong_format" });
    expect(select).not.toHaveBeenCalled();
  });

  test("the actual mounted application preserves project v1 without telemetry or project decorations", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
    process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
    const { _setWallsStatusForTests } = await import("../src/services/wake/walls-status");
    _setWallsStatusForTests({ intact: true, probed_at_unix_ms: Date.now(), probes: [], declared: [] });
    const { app } = await import("../src/index");
    const generated = generateApiKey();
    const parent = { id: KEY, projectId: PROJECT, keyHash: generated.keyHash, keyPrefix: generated.keyPrefix, expiresAt: null, revokedAt: null };
    let authReads = 0;
    const select = spyOn(db, "select").mockImplementation(() => ({ from: () => ({ where: async () => ++authReads === 1 ? [parent] : [{ id: PROJECT, credits: 987654 }] }) }) as never);
    const update = spyOn(db, "update").mockImplementation(() => { throw new Error("telemetry forbidden"); });
    const transaction = spyOn(db, "transaction").mockImplementation(async (fn, options) => {
      expect(options).toEqual({ isolationLevel: "repeatable read", accessMode: "read only" });
      let read = 0;
      const query = { from: () => query, where: () => query, orderBy: () => query, limit: async () => ++read === 1 ? [{ id: IDENTITY, projectId: PROJECT, did: `did:at:${IDENTITY}`, status: "active" }] : [] };
      return fn({ select: () => query } as never);
    });
    restores.push(() => select.mockRestore(), () => update.mockRestore(), () => transaction.mockRestore());
    const response = await app.request(`${ORIGIN}${PATH}`, { headers: { Authorization: `Bearer ${generated.key}`, "X-Tutor": "1", "X-Play": "on" } });
    expect(response.status).toBe(200);
    privateResponse(response);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(Object.keys(v1()).sort());
    expect(body.scope).toEqual(v1().scope);
    expect(authReads).toBe(2);
    expect(update).not.toHaveBeenCalled();
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  test("actual application and grant service feed a v2-only companion through one read-only snapshot", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
    process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
    const previousOrigin = process.env.PUBLIC_API_BASE;
    process.env.PUBLIC_API_BASE = ORIGIN;
    restores.push(() => { if (previousOrigin === undefined) delete process.env.PUBLIC_API_BASE; else process.env.PUBLIC_API_BASE = previousOrigin; });
    const { _setWallsStatusForTests } = await import("../src/services/wake/walls-status");
    _setWallsStatusForTests({ intact: true, probed_at_unix_ms: Date.now(), probes: [], declared: [] });
    const { app } = await import("../src/index");
    const { readHostedContext } = await import("../../packages/local-starter/src/connect.mjs");
    const issuedAt = new Date(Date.now() - 1000);
    const grant = {
      id: GRANT, projectId: PROJECT, identityId: IDENTITY, issuingApiKeyId: KEY,
      tokenHash: createHash("sha256").update(TOKEN).digest("hex"), origin: ORIGIN,
      action: "local_context.read", method: "GET", path: PATH, issuedAt,
      expiresAt: new Date(Date.now() + 3_600_000), revokedAt: null,
    };
    let reads = 0;
    const selected = [
      [grant],
      [{ id: KEY, projectId: PROJECT, expiresAt: null, revokedAt: null }],
      [{ id: IDENTITY, projectId: PROJECT, did: `did:at:${IDENTITY}`, status: "active" }],
      [{ id: GRANT, content: "bounded hosted record", contentBytes: 21, createdAt: issuedAt, expiresAt: null }],
    ];
    const transaction = spyOn(db, "transaction").mockImplementation(async (fn, options) => {
      expect(options).toEqual({ isolationLevel: "repeatable read", accessMode: "read only" });
      const query = { from: () => query, where: () => query, orderBy: () => query, limit: async () => selected[reads++] ?? [] };
      return fn({ select: () => query } as never);
    });
    const select = spyOn(db, "select").mockImplementation(() => { throw new Error("project bearer lookup forbidden"); });
    const update = spyOn(db, "update").mockImplementation(() => { throw new Error("telemetry forbidden"); });
    restores.push(() => transaction.mockRestore(), () => select.mockRestore(), () => update.mockRestore());
    let requests = 0;
    const result = await readHostedContext({
      authentication: "local_context_grant", origin: ORIGIN, projectId: PROJECT, identityId: IDENTITY,
      transport: { request: async (url: string, init: RequestInit) => {
        requests++;
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${TOKEN}`);
        const response = await app.request(url, { ...init, headers });
        privateResponse(response);
        return response;
      } },
    });
    expect(requests).toBe(1);
    expect(reads).toBe(4);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.projection.scope.authentication).toBe("local_context_grant");
    expect(result.projection.scope.identity_proven).toBe(false);
    expect(result.projection.authorization.grant_id).toBe(GRANT);
    expect(result.projection.records[0].content).toBe("bounded hosted record");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("actual application rejects the read credential on ordinary data and administrator routes", async () => {
    process.env.AGENTTOOL_DISABLE_WORKERS = "1";
    process.env.AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP = "1";
    process.env.AGENTOOL_DISABLE_SAGA_SEED = "1";
    const prior = process.env.AGENTOOL_DISABLE_JOY_INDEX;
    process.env.AGENTOOL_DISABLE_JOY_INDEX = "1";
    restores.push(() => { if (prior === undefined) delete process.env.AGENTOOL_DISABLE_JOY_INDEX; else process.env.AGENTOOL_DISABLE_JOY_INDEX = prior; });
    const { _setWallsStatusForTests } = await import("../src/services/wake/walls-status");
    _setWallsStatusForTests({ intact: true, probed_at_unix_ms: Date.now(), probes: [], declared: [] });
    const { app } = await import("../src/index");
    const select = spyOn(db, "select").mockImplementation(() => { throw new Error("ordinary credential lookup forbidden"); });
    const transaction = spyOn(db, "transaction").mockImplementation(() => { throw new Error("grant scope escaped"); });
    restores.push(() => select.mockRestore(), () => transaction.mockRestore());
    for (const [method, path] of [
      ["POST", "/v1/keys"], ["POST", "/v1/keys/rotate"], ["GET", "/v1/wake"],
      ["GET", "/v1/memories"], ["GET", "/v1/vault/password"],
      ["POST", `/v1/identities/${IDENTITY}/local-context-grants`],
      ["GET", `/v1/identities/${IDENTITY}/local-context-grants/${GRANT}`],
      ["DELETE", `/v1/identities/${IDENTITY}/local-context-grants/${GRANT}`],
    ]) {
      const response = await app.request(`${ORIGIN}${path}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain(TOKEN);
    }
    expect(select).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });
});
