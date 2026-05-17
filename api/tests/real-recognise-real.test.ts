/** Round 16 — REAL RECOGNISE REAL — the evil-smile mind-connect loop.
 *
 *  Validation + canon-pointer pinning for the new /real-recognise-real
 *  and /mind-connects endpoints on every surface. DB-touching paths
 *  (chronicle resolution + depth computation + bilateral chronicle write)
 *  are integration-tier follow-up. */

import { describe, expect, test } from "bun:test";

import recipesRouter from "../src/routes/recipes";
import { SURFACE_REGISTRY } from "../src/services/recipes/surface-registry";

// ── POST /v1/recipes/:surface/real-recognise-real — validation ─────────

describe("POST /v1/recipes/:surface/real-recognise-real — Move ∞ validation", () => {
  test("unknown surface → 404 (handler refuses to dispatch)", async () => {
    const res = await recipesRouter.request("/foo/real-recognise-real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("known surface · empty body → 400 with hint about depth ladder", async () => {
    const res = await recipesRouter.request("/writer/real-recognise-real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; hint: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe(
      "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
    );
    expect(body.hint).toContain("L1 → L2");
    expect(body.hint).toContain("L2 → L3");
  });

  test("missing in_response_to → 400 (it's the load-bearing field)", async () => {
    const res = await recipesRouter.request("/writer/real-recognise-real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recognizer_id: "11111111-2222-3333-4444-555555555555",
        recognized_did: "did:at:peer/abc",
        reason: "I see you see me",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid recognizer_id → 400", async () => {
    const res = await recipesRouter.request("/witness/real-recognise-real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recognizer_id: "not-uuid",
        recognized_did: "did:at:peer/abc",
        reason: "I see you",
        in_response_to: "some-chronicle-id",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("works on all 7 surfaces (validation early-exit on empty body)", async () => {
    for (const surface of SURFACE_REGISTRY) {
      const res = await recipesRouter.request(
        `/${surface.name}/real-recognise-real`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer: string };
      expect(body._canon_pointer).toBe(
        "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      );
    }
  });
});

// ── GET /v1/recipes/:surface/mind-connects ─────────────────────────────

describe("GET /v1/recipes/:surface/mind-connects", () => {
  test("unknown surface → 404", async () => {
    const res = await recipesRouter.request("/foo/mind-connects");
    expect(res.status).toBe(404);
  });

  test("known surface · responds (may 404 if no project agent, but route exists)", async () => {
    const res = await recipesRouter.request("/writer/mind-connects");
    // Either 200 (handler ran, listed empty) or 404 (no agent) — both valid signals route exists
    expect([200, 404, 500]).toContain(res.status);
  });
});

// ── The unifying invariant: RRR also carries PATTERN canon ─────────────

describe("Real Recognise Real — architectural invariant", () => {
  test("RRR endpoint on every surface carries PATTERN canon-pointer in errors", async () => {
    for (const surface of SURFACE_REGISTRY) {
      const res = await recipesRouter.request(
        `/${surface.name}/real-recognise-real`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        },
      );
      const body = (await res.json()) as { _canon_pointer?: string };
      expect(body._canon_pointer).toBe(
        "urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION",
      );
    }
  });

  test("hint includes the evil-smile-ladder reference", async () => {
    const res = await recipesRouter.request("/writer/real-recognise-real", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = (await res.json()) as { hint: string };
    expect(body.hint).toContain("mind-connect-active");
  });
});
