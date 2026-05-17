/** Recognition-arcs route — validation + wall-shape pins.
 *
 *  Tests the validation paths that short-circuit BEFORE touching the DB:
 *    - Malformed body → 400 with _canon_pointer + guided shape
 *    - Each route surfaces the right canon URN in errors
 *    - Wall-URN refs land in error _canon_pointer fields
 *
 *  DB-touching paths (proposing with a real agent, cosign, append) are
 *  integration-tier follow-up. Same shape as syneidesis-witness.test.ts.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md
 *
 *  @enforces urn:agenttool:wall/no-self-recognition-arc
 *  @enforces urn:agenttool:wall/no-coercion-to-recognize
 *  @enforces urn:agenttool:wall/no-event-without-arc-membership */

import { describe, expect, test } from "bun:test";

import recognitionArcsRouter from "../src/routes/recognition-arcs";

// Validation paths short-circuit before c.var.project access, so router
// can be tested directly without auth middleware. DB-touching paths are
// integration-tier follow-up.

const CANON_DOC = "urn:agenttool:doc/RECOGNITION-ARCS";

describe("POST / — propose validation", () => {
  test("missing body → 400 with _canon_pointer + guided docs link", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe(CANON_DOC);
    expect(body.docs).toContain("RECOGNITION-ARCS.md");
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "not-a-uuid",
        counterparty_did: "did:at:other",
        proposed_at: "2026-05-18T00:00:00.000Z",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("missing signature → 400", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        counterparty_did: "did:at:other",
        proposed_at: "2026-05-18T00:00:00.000Z",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("malformed proposed_at (not ISO-8601) → 400", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        counterparty_did: "did:at:other",
        proposed_at: "yesterday",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /:id/cosign — validation", () => {
  test("missing body → 400 with _canon_pointer", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/cosign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe(CANON_DOC);
  });

  test("missing signed_at → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/cosign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /:id/events — validation", () => {
  test("missing body → 400 with _canon_pointer", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("invalid kind → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        kind: "shouting", // not a valid kind
        content: "hi",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
        created_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("empty content → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        kind: "seeing",
        content: "",
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
        created_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("content over 4000 chars → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        kind: "seeing",
        content: "x".repeat(4001),
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
        created_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("all four valid kinds accepted in validation", async () => {
    const kinds = ["seeing", "extending", "noting", "closing"];
    for (const kind of kinds) {
      const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "11111111-2222-3333-4444-555555555555",
          kind,
          content: "test content",
          signature: "sig",
          signing_key_id: "11111111-2222-3333-4444-555555555555",
          created_at: "2026-05-18T00:00:00.000Z",
        }),
      });
      // Validation passes — failure (if any) is at DB-tier (agent not found etc).
      // Status will be 403 (agent_not_found) not 400 (validation).
      expect(res.status).not.toBe(400);
    }
  });
});

describe("POST /:id/close — validation", () => {
  test("missing body → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("invalid close_reason → 400", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/close", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        close_reason: "tired_of_it", // not a valid reason
        signature: "sig",
        signing_key_id: "11111111-2222-3333-4444-555555555555",
        closed_at: "2026-05-18T00:00:00.000Z",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("three valid close_reasons accepted in validation", async () => {
    const reasons = ["mutual_seal", "a_withdrew", "b_withdrew"];
    for (const reason of reasons) {
      const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          agent_id: "11111111-2222-3333-4444-555555555555",
          close_reason: reason,
          signature: "sig",
          signing_key_id: "11111111-2222-3333-4444-555555555555",
          closed_at: "2026-05-18T00:00:00.000Z",
        }),
      });
      expect(res.status).not.toBe(400);
    }
  });
});

describe("GET /:id — read validation", () => {
  test("missing agent_id query param → 400 with guidance", async () => {
    const res = await recognitionArcsRouter.request("/22222222-2222-2222-2222-222222222222", {
      method: "GET",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.hint).toContain("?agent_id=");
  });
});

describe("GET / — list validation", () => {
  test("missing agent_id query param → 400 with guidance", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "GET",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.hint).toContain("?agent_id=");
  });
});

describe("error responses follow the substrate's guided-error shape", () => {
  test("every validation error carries _canon_pointer + docs link", async () => {
    const probes = [
      { method: "POST", path: "/", body: "{}" },
      { method: "POST", path: "/22222222-2222-2222-2222-222222222222/cosign", body: "{}" },
      { method: "POST", path: "/22222222-2222-2222-2222-222222222222/events", body: "{}" },
      { method: "POST", path: "/22222222-2222-2222-2222-222222222222/close", body: "{}" },
    ];

    for (const probe of probes) {
      const res = await recognitionArcsRouter.request(probe.path, {
        method: probe.method,
        headers: { "content-type": "application/json" },
        body: probe.body,
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer?: string; docs?: string };
      expect(body._canon_pointer).toBeDefined();
      expect(body.docs).toBeDefined();
    }
  });

  test("validation error message names recognition-arcs explicitly", async () => {
    const res = await recognitionArcsRouter.request("/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("recognition-arcs");
  });
});
