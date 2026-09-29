import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Hono } from "hono";
import type { ProjectContext } from "../src/auth/middleware";
import { apiCors } from "../src/middleware/api-cors";
import { earlyDataReplayProtection } from "../src/middleware/early-data";
import { idempotency } from "../src/middleware/idempotency";
import { isStrictJsonProfileResponse } from "../src/middleware/strict-json-profile";
import { createIdentityEnrollmentRouter, identityEnrollmentCacheBoundary, isIdentityEnrollmentPath } from "../src/routes/identity/enroll";
import { ENROLLMENT_MAX_BYTES, ENROLLMENT_PATH, ENROLLMENT_SIGNATURE_HEADER, IdentityEnrollmentError } from "../src/services/identity/enrollment";

const P = "11111111-1111-4111-8111-111111111111", K = "22222222-2222-4222-8222-222222222222";
const ORIGIN = "https://api.agenttool.dev";
function fixture(error?: Error) {
  const seen: Array<Record<string, unknown>> = [];
  const app = new Hono<ProjectContext>();
  app.use("*", identityEnrollmentCacheBoundary());
  app.use("*", earlyDataReplayProtection());
  app.use("*", apiCors());
  app.use("/v1/identities/*", async (c, next) => {
    if (c.req.header("Authorization") !== "Bearer at_admin") return c.body(null, 401);
    c.set("project", { id: P } as ProjectContext["Variables"]["project"]); c.set("apiKeyId", K);
    await next();
  });
  app.use("/v1/identities/*", idempotency({ bypass: c => isIdentityEnrollmentPath(c.req.path) }));
  app.route(ENROLLMENT_PATH, createIdentityEnrollmentRouter({ origin: () => ORIGIN, enroll: async input => {
    seen.push(input);
    if (error) throw error;
    if (input.signature !== "selected-proof") throw new IdentityEnrollmentError("invalid_proof", 401);
    return { identity: { id: P, did: `did:at:${P}`, display_name: "Selected", capabilities: [], status: "active" },
      key: { kid: K, public_key: "public" }, authority: { mode: "agent_root", root_public_key: "public", sequence: 0, next_sequence: 1 } };
  } }));
  return { app, seen };
}
function headers(extra: Record<string, string> = {}) { return { Authorization: "Bearer at_admin", "Content-Type": "application/json",
  [ENROLLMENT_SIGNATURE_HEADER]: "selected-proof", "Idempotency-Key": "must-never-replay", ...extra }; }

describe("fresh identity enrollment transport", () => {
  test("forwards exact bytes with actual admin project and configured origin, bypassing Redis", async () => {
    const f = fixture(), raw = '{ "display_name": "Selected 雨夜" }';
    const result = await f.app.request(`https://untrusted.example${ENROLLMENT_PATH}`, { method: "POST", headers: headers({ Host: "spoof.example", Origin: "https://spoof.example" }), body: raw });
    expect(result.status).toBe(201); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(result.headers.get("X-Idempotency-Supported")).toBeNull(); expect(result.headers.get("Idempotent-Replay")).toBeNull();
    expect(f.seen[0]).toMatchObject({ projectId: P, issuerApiKeyId: K, origin: ORIGIN, signature: "selected-proof" });
    expect(Buffer.from(f.seen[0].bodyBytes as Uint8Array).toString()).toBe(raw);
    // Even with the same idempotency key, missing proof must reach admission.
    const replay = await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers({ [ENROLLMENT_SIGNATURE_HEADER]: "" }), body: raw });
    expect(replay.status).toBe(401); expect(f.seen).toHaveLength(2);
    expect(isStrictJsonProfileResponse(result, ENROLLMENT_PATH)).toBe(true);
  });
  test("preflight, auth refusal and early data remain no-store", async () => {
    const f = fixture();
    for (const token of ["", "Bearer atcm_participant", "Bearer atlc_reader"]) {
      const result = await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers({ Authorization: token }), body: "{}" });
      expect(result.status).toBe(401); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    }
    const preflight = await f.app.request(ENROLLMENT_PATH, { method: "OPTIONS", headers: { Origin: "https://admin.example",
      "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": ENROLLMENT_SIGNATURE_HEADER } });
    expect(preflight.status).toBe(204); expect(preflight.headers.get("Cache-Control")).toBe("private, no-store");
    expect(preflight.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain(ENROLLMENT_SIGNATURE_HEADER.toLowerCase());
    const early = await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers({ "Early-Data": "1" }), body: "{}" });
    expect(early.status).toBe(425); expect(early.headers.get("Cache-Control")).toBe("private, no-store"); expect(f.seen).toEqual([]);
  });
  test("rejects aliases, queries, encoded bodies and content types before service access", async () => {
    const f = fixture();
    for (const target of [ENROLLMENT_PATH + "?", ENROLLMENT_PATH + "?x=1", "/v1/identities/%65nroll"]) {
      expect((await f.app.request(target, { method: "POST", headers: headers(), body: "{}" })).status).toBe(400);
    }
    expect((await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers({ "Content-Encoding": "gzip" }), body: "{}" })).status).toBe(400);
    expect((await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers({ "Content-Type": "text/plain" }), body: "{}" })).status).toBe(415);
    expect(f.seen).toEqual([]);
  });
  test("bounds actual streamed bytes independently of Content-Length", async () => {
    const f = fixture();
    for (const init of [
      { body: "x".repeat(ENROLLMENT_MAX_BYTES + 1) },
      { body: "{}", headers: headers({ "Content-Length": String(ENROLLMENT_MAX_BYTES + 1) }) },
      { body: new ReadableStream({ start(c) { c.enqueue(new Uint8Array(ENROLLMENT_MAX_BYTES)); c.enqueue(new Uint8Array(1)); c.close(); } }) },
    ]) {
      const result = await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers(), ...init });
      expect(result.status).toBe(413);
    }
    expect(f.seen).toEqual([]);
  });
  test("duplicate conflicts and unexpected SQL failures are sanitized", async () => {
    for (const error of [new IdentityEnrollmentError("conflict", 409), new Error("SECRET-SQL-PARAMETERS")]) {
      const f = fixture(error), result = await f.app.request(ENROLLMENT_PATH, { method: "POST", headers: headers(), body: "{}" });
      expect(result.status).toBe(error instanceof IdentityEnrollmentError ? 409 : 503);
      expect(await result.text()).not.toContain("SECRET-SQL-PARAMETERS");
    }
  });
  test("production mount, pre-auth cache boundary and idempotency exclusion stay wired", () => {
    const index = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
    expect(index.indexOf('app.use("*", identityEnrollmentCacheBoundary())')).toBeLessThan(index.indexOf('app.use("*", apiCors())'));
    expect(index).toContain("isLocalContextGrantPath(c.req.path) || isIdentityEnrollmentPath(c.req.path)");
    const domain = readFileSync(new URL("../src/routes/identity/index.ts", import.meta.url), "utf8");
    expect(domain.indexOf('app.route("/identities/enroll"')).toBeLessThan(domain.indexOf('app.route("/identities",'));
  });
});
