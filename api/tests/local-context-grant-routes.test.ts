import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../src/auth/middleware";
import { errors } from "../src/lib/errors";
import { apiCors } from "../src/middleware/api-cors";
import { earlyDataReplayProtection } from "../src/middleware/early-data";
import { idempotency } from "../src/middleware/idempotency";
import { isLocalContextGrantPath, localContextTransportBoundary } from "../src/middleware/local-context-boundary";
import { createLocalContextGrantRouter, type LocalContextGrantDependencies } from "../src/routes/identity/local-context-grants";

const PROJECT = "11111111-2222-4333-8444-555555555555";
const IDENTITY = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const GRANT = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const KEY = "dddddddd-cccc-4ddd-8eee-ffffffffffff";
const ORIGIN = "https://api.agenttool.dev";
const PATH = `/v1/identities/${IDENTITY}/local-context-grants`;
const TOKEN = `atlc_${Buffer.alloc(32, 7).toString("base64url")}`;
const EXPIRES = "2026-09-28T00:00:00.000Z";
const META = {
  grant_id: GRANT, project_id: PROJECT, identity_id: IDENTITY, issuing_api_key_id: KEY,
  origin: ORIGIN, action: "local_context.read" as const, method: "GET" as const,
  path: `/v1/identities/${IDENTITY}/local-context`, issued_at: "2026-09-27T23:00:00.000Z",
  expires_at: EXPIRES, revoked_at: null,
};

function fixture(dependencies: Partial<LocalContextGrantDependencies> = {}) {
  const seen: Array<{ operation: string; input: unknown }> = [];
  const app = new Hono<ProjectContext>();
  app.use("*", localContextTransportBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("/v1/identities/*", async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer at_admin") return c.body(null, 401);
    c.set("project", { id: PROJECT } as ProjectContext["Variables"]["project"]);
    c.set("apiKeyId", KEY);
    await next();
  });
  app.use("/v1/identities/*", idempotency({ bypass: c => isLocalContextGrantPath(c.req.path) }));
  app.route("/v1/identities/:id/local-context-grants", createLocalContextGrantRouter({
    origin: () => ORIGIN,
    issue: async input => { seen.push({ operation: "issue", input }); return { grant: META, token: TOKEN }; },
    list: async input => { seen.push({ operation: "list", input }); return [META]; },
    get: async input => { seen.push({ operation: "get", input }); return META; },
    revoke: async input => { seen.push({ operation: "revoke", input }); return { ...META, revoked_at: "2026-09-27T23:01:00.000Z" }; },
    ...dependencies,
  }));
  return { app, seen };
}

function request(app: Hono<ProjectContext>, method: string, suffix = "", body?: unknown) {
  return app.request(`${ORIGIN}${PATH}${suffix}`, {
    method, headers: { Authorization: "Bearer at_admin", "Content-Type": "application/json", "Idempotency-Key": "explicit-issue-anchor" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("explicit context-grant administration", () => {
  test("issue binds authenticated administrator and configured origin, with no generic replay cache", async () => {
    const { app, seen } = fixture();
    const response = await request(app, "POST", "", { grant_id: GRANT, expires_at: EXPIRES });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ grant: META, token: TOKEN });
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("X-Idempotency-Supported")).toBeNull();
    expect(response.headers.get("Idempotent-Replay")).toBeNull();
    expect(seen).toEqual([{ operation: "issue", input: { projectId: PROJECT, identityId: IDENTITY, issuerApiKeyId: KEY, grantId: GRANT, expiresAt: EXPIRES, origin: ORIGIN } }]);
  });

  test("metadata list and revoke pass only the administrator's project and explicit IDs", async () => {
    const { app, seen } = fixture();
    const list = await request(app, "GET");
    expect(await list.json()).toEqual({ grants: [META] });
    const known = await request(app, "GET", `/${GRANT}`);
    expect(await known.json()).toEqual({ grant: META });
    for (let i = 0; i < 2; i++) {
      const revoke = await request(app, "DELETE", `/${GRANT}`);
      expect(revoke.status).toBe(200);
      expect((await revoke.json()).grant.revoked_at).toBe("2026-09-27T23:01:00.000Z");
      expect(revoke.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect(seen).toEqual([
      { operation: "list", input: { projectId: PROJECT, identityId: IDENTITY } },
      { operation: "get", input: { projectId: PROJECT, identityId: IDENTITY, grantId: GRANT } },
      ...Array(2).fill({ operation: "revoke", input: { projectId: PROJECT, identityId: IDENTITY, grantId: GRANT } }),
    ]);
  });

  test("malformed or widened requests never reach grant services", async () => {
    const { app, seen } = fixture();
    for (const body of [{}, { grant_id: GRANT }, { grant_id: GRANT.toUpperCase(), expires_at: EXPIRES }, { grant_id: GRANT, expires_at: EXPIRES, scope: "*" }, { grant_id: GRANT, expires_at: EXPIRES, origin: "https://evil.example" }, { grant_id: GRANT, expires_at: EXPIRES, project_id: PROJECT }]) {
      const response = await request(app, "POST", "", body);
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    expect((await request(app, "GET", "?limit=999")).status).toBe(400);
    expect((await request(app, "DELETE", "/me")).status).toBe(400);
    expect((await request(app, "DELETE", `/${GRANT}`, {})).status).toBe(400);
    expect((await request(app, "POST", "", { grant_id: GRANT, expires_at: "x".repeat(4096) })).status).toBe(413);
    expect(seen).toEqual([]);
  });

  test("duplicate issue keeps service409 and exposes no second token; faults remain redacted", async () => {
    for (const error of [
      new HTTPException(409, { cause: errors.refusal({ error: "local_context_grant_exists", message: "Grant ID already exists", docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md" }) }),
      new Error(`private persistence failure ${TOKEN}`),
    ]) {
      const { app } = fixture({ issue: async () => { throw error; } });
      const response = await request(app, "POST", "", { grant_id: GRANT, expires_at: EXPIRES });
      expect(response.status).toBe(error instanceof HTTPException ? 409 : 503);
      const body = await response.json();
      expect(body.docs).toBeTruthy();
      expect(body.token).toBeUndefined();
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  test("management auth refusals and CORS short circuits stay private", async () => {
    const { app, seen } = fixture();
    for (const method of ["GET", "POST", "DELETE"]) {
      const response = await app.request(`${ORIGIN}${PATH}${method === "DELETE" ? `/${GRANT}` : ""}`, { method, headers: { Authorization: `Bearer ${TOKEN}` } });
      expect(response.status).toBe(401);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
    const preflight = await app.request(`${ORIGIN}${PATH}`, { method: "OPTIONS", headers: { Origin: "https://admin.example", "Access-Control-Request-Method": "POST" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("Cache-Control")).toBe("private, no-store");
    expect(seen).toEqual([]);
  });
});
