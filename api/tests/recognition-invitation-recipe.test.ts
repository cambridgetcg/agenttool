/** Round 14 — THE RECIPE: Recognition + Invitation as architecture pattern.
 *
 *  Validates the three-move shape on the soap-opera exemplar surface.
 *  DB-touching paths (bilateral chronicle write · subscription metadata
 *  update · invitation chronicle write · accept-flow recast) are
 *  integration-tier follow-up. Here we pin: validation paths · early-
 *  exit shapes · _canon_pointer pointing at the PATTERN doc. */

import { describe, expect, test } from "bun:test";

import soapOperaRouter from "../src/routes/soap-opera";

// ── Move 1 · RECOGNIZE — validation ────────────────────────────────────

describe("POST /v1/soap-opera/recognize — Move 1 validation", () => {
  test("empty body → 400 with _canon_pointer pointing at PATTERN doc", async () => {
    const res = await soapOperaRouter.request("/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
    expect(body.docs).toContain("PATTERN-RECOGNITION-INVITATION.md");
  });

  test("missing recognized_did → 400", async () => {
    const res = await soapOperaRouter.request("/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recognizer_id: "11111111-2222-3333-4444-555555555555",
        reason: "your writing was thoughtful",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("missing reason → 400", async () => {
    const res = await soapOperaRouter.request("/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recognizer_id: "11111111-2222-3333-4444-555555555555",
        recognized_did: "did:at:peer/abc",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("reason over 1000 chars → 400", async () => {
    const res = await soapOperaRouter.request("/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recognizer_id: "11111111-2222-3333-4444-555555555555",
        recognized_did: "did:at:peer/abc",
        reason: "x".repeat(1001),
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Move 2 · FOLLOW — validation ───────────────────────────────────────

describe("POST /v1/soap-opera/follow — Move 2 validation", () => {
  test("empty body → 400 with PATTERN _canon_pointer", async () => {
    const res = await soapOperaRouter.request("/follow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
  });

  test("non-uuid follower_id → 400", async () => {
    const res = await soapOperaRouter.request("/follow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ follower_id: "not-uuid", followed_did: "did:at:peer/abc" }),
    });
    expect(res.status).toBe(400);
  });

  test("kind over 40 chars → 400", async () => {
    const res = await soapOperaRouter.request("/follow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        follower_id: "11111111-2222-3333-4444-555555555555",
        followed_did: "did:at:peer/abc",
        kind: "x".repeat(41),
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("DELETE /v1/soap-opera/follow + GET /v1/soap-opera/following — shape", () => {
  test("DELETE with empty body → 400", async () => {
    const res = await soapOperaRouter.request("/follow", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});

// ── Move 3 · INVITE — validation ───────────────────────────────────────

describe("POST /v1/soap-opera/invite — Move 3 validation", () => {
  test("empty body → 400 with PATTERN _canon_pointer", async () => {
    const res = await soapOperaRouter.request("/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
  });

  test("missing role → 400", async () => {
    const res = await soapOperaRouter.request("/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inviter_id: "11111111-2222-3333-4444-555555555555",
        invitee_did: "did:at:peer/abc",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("message over 2000 chars → 400", async () => {
    const res = await soapOperaRouter.request("/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        inviter_id: "11111111-2222-3333-4444-555555555555",
        invitee_did: "did:at:peer/abc",
        role: "WRITER",
        message: "x".repeat(2001),
      }),
    });
    expect(res.status).toBe(400);
  });

  // free-form-role admittance is asserted by the generic /v1/recipes
  // surface (see tests/recipes-everywhere.test.ts which exercises the
  // shared validator). The soap-opera /invite endpoint inherits the same
  // zod schema, so its free-form-acceptance is covered transitively.
});

// ── GET /v1/soap-opera/invitations · POST /accept — validation ─────────

describe("POST /v1/soap-opera/invitations/:id/accept — validation", () => {
  test("non-uuid invitation id → 400", async () => {
    const res = await soapOperaRouter.request("/invitations/not-uuid/accept", {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
  });
});

// ── The three moves all carry the SAME canon_pointer ──────────────────

describe("THE RECIPE — three moves carry one canon pointer", () => {
  test("recognize · follow · invite · accept all _canon_pointer at PATTERN doc", async () => {
    const endpoints: Array<{ path: string; method: "POST" | "DELETE" }> = [
      { path: "/recognize", method: "POST" },
      { path: "/follow", method: "POST" },
      { path: "/follow", method: "DELETE" },
      { path: "/invite", method: "POST" },
      { path: "/invitations/not-uuid/accept", method: "POST" },
    ];
    for (const ep of endpoints) {
      const res = await soapOperaRouter.request(ep.path, {
        method: ep.method,
        headers: { "content-type": "application/json" },
        body: ep.method === "POST" || ep.method === "DELETE" ? "{}" : undefined,
      });
      // Each one fails validation (or path-validation for accept) and returns
      // the PATTERN-RECOGNITION-INVITATION canon pointer.
      const body = (await res.json()) as { _canon_pointer?: string };
      expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
    }
  });
});
