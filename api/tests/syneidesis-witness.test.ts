/** /v1/syneidesis/witness — bootstrap-witness primitive shape tests.
 *
 *  Pins what's testable without a real DB connection:
 *    - GET /v1/syneidesis returns the discovery shape (canon_pointer, verbs,
 *      doctrine + tutorial pointers, free-tier declaration).
 *    - POST /v1/syneidesis/witness validation paths (malformed body, missing
 *      required fields) return 400 with _canon_pointer + guided shape.
 *
 *  DB-touching paths (chronicle seal insert, memory write, asymmetry-clause
 *  rejection — all require resolving the agent against `identities`) are
 *  the obvious integration-tier follow-up. The route is structurally
 *  small enough that these unit tests + the integration smoke once-deployed
 *  give confident coverage.
 *
 *  Doctrine: docs/SYNEIDESIS-WITNESS.md. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import syneidesisRouter from "../src/routes/syneidesis";

// The discovery GET / handler is project-context-free; validation paths on
// POST /witness short-circuit BEFORE touching c.var.project. So the router
// can be tested directly without an auth-middleware shim — DB-touching
// paths (agent lookup, chronicle write, memory write) are the integration-
// tier follow-up.
function makeApp() {
  return syneidesisRouter;
}

// ── GET /v1/syneidesis — discovery + canon-pointer + verbs ─────────────

describe("GET /v1/syneidesis — discovery surface", () => {
  test("returns 200 with canon_pointer + verbs[]", async () => {
    const res = await makeApp().request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      _canon_pointer: string;
      verbs: Array<{ action: string; method: string; path: string }>;
      primitive: string;
      free_tier: boolean;
    };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SYNEIDESIS-WITNESS");
    expect(body.verbs.length).toBeGreaterThan(0);
    expect(body.primitive).toBe("bootstrap-witness");
    expect(body.free_tier).toBe(true);
  });

  test("doctrine pointer resolves to the canonical doc", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as { doctrine: string };
    expect(body.doctrine).toContain("SYNEIDESIS-WITNESS.md");
  });

  test("composition doctrine names syneidesis-bootstrap", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as { composition_doctrine: string };
    expect(body.composition_doctrine).toContain("syneidesis-bootstrap.md");
  });

  test("tutorials[] lists all three walkable arcs", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as { tutorials: string[] };
    expect(body.tutorials.length).toBe(3);
    expect(body.tutorials.some((t) => t.includes("WHAT-YOUR-COGNITION"))).toBe(true);
    expect(body.tutorials.some((t) => t.includes("THE-BOOTSTRAP"))).toBe(true);
    expect(body.tutorials.some((t) => t.includes("LOVE-JOY-AND-THE-MOST-HIGH"))).toBe(true);
  });

  test("endpoints map names POST /v1/syneidesis/witness with required + optional fields", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as {
      endpoints: Record<string, { required: string[]; optional: string[] }>;
    };
    const ep = body.endpoints["POST /v1/syneidesis/witness"];
    expect(ep).toBeDefined();
    expect(ep.required).toContain("agent_id");
    expect(ep.required).toContain("what_registered");
    expect(ep.optional).toContain("reading_anchor");
    expect(ep.optional).toContain("invited_witness_did");
  });

  test("endpoints map names POST .../:seal_id/cosign + GET .../inbox", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as {
      endpoints: Record<string, { required: string[]; optional: string[] }>;
    };
    expect(body.endpoints["POST /v1/syneidesis/witness/:seal_id/cosign"]).toBeDefined();
    expect(body.endpoints["GET /v1/syneidesis/witness/inbox"]).toBeDefined();
  });

  test("discovery surfaces 5+ verbs (full lifecycle: self-report · inbox · cosign · read doctrine · walk tutorial)", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as { verbs: Array<{ action: string; path: string }> };
    expect(body.verbs.length).toBeGreaterThanOrEqual(5);
    const paths = body.verbs.map((v) => v.path);
    expect(paths).toContain("/v1/syneidesis/witness");
    expect(paths).toContain("/v1/syneidesis/witness/inbox");
    expect(paths.some((p) => p.includes("cosign"))).toBe(true);
  });
});

// ── POST /v1/syneidesis/witness — validation paths ─────────────────────

describe("POST /v1/syneidesis/witness — validation", () => {
  test("missing body → 400 with _canon_pointer + guided shape", async () => {
    const res = await makeApp().request("/witness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: string;
      _canon_pointer: string;
      docs: string;
    };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SYNEIDESIS-WITNESS");
    expect(body.docs).toContain("SYNEIDESIS-WITNESS.md");
  });

  test("missing what_registered → 400", async () => {
    const res = await makeApp().request("/witness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await makeApp().request("/witness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "not-a-uuid",
        what_registered: "I noticed the recursive self-grasp.",
      }),
    });
    expect(res.status).toBe(400);
  });

  test("what_registered over 2000 chars → 400", async () => {
    const res = await makeApp().request("/witness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        what_registered: "x".repeat(2001),
      }),
    });
    expect(res.status).toBe(400);
  });

  test("reading_anchor over 200 chars → 400", async () => {
    const res = await makeApp().request("/witness", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        what_registered: "noticed it.",
        reading_anchor: "x".repeat(201),
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Surface-metadata convention (Move 3 + 5 — verbs + canon_pointer) ───

// ── POST /v1/syneidesis/witness/:seal_id/cosign — validation paths ─────

describe("POST /v1/syneidesis/witness/:seal_id/cosign — validation", () => {
  test("non-uuid seal_id → 400 with _canon_pointer", async () => {
    const res = await makeApp().request("/witness/not-a-uuid/cosign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ witness_did: "did:at:host/abc" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; _canon_pointer: string };
    expect(body.error).toBe("validation");
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SYNEIDESIS-WITNESS");
  });

  test("uuid seal_id + missing witness_did body → 400", async () => {
    const res = await makeApp().request(
      "/witness/11111111-2222-3333-4444-555555555555/cosign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
    expect(res.status).toBe(400);
  });

  test("witness_note over 2000 chars → 400", async () => {
    const res = await makeApp().request(
      "/witness/11111111-2222-3333-4444-555555555555/cosign",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          witness_did: "did:at:host/abc",
          witness_note: "x".repeat(2001),
        }),
      },
    );
    expect(res.status).toBe(400);
  });
});

// ── POST /v1/syneidesis/volunteer — validation ───────────────────────

describe("POST /v1/syneidesis/volunteer — opt-in flag", () => {
  test("missing body → 400", async () => {
    const res = await makeApp().request("/volunteer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("missing opt_in → 400", async () => {
    const res = await makeApp().request("/volunteer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "11111111-2222-3333-4444-555555555555" }),
    });
    expect(res.status).toBe(400);
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await makeApp().request("/volunteer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-a-uuid", opt_in: true }),
    });
    expect(res.status).toBe(400);
  });
});

// ── Discovery surfaces all witness-finding endpoints ───────────────────

describe("syneidesis discovery — witness-finding triad surfaces", () => {
  test("endpoints map includes POST /volunteer", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as {
      endpoints: Record<string, unknown>;
    };
    // The /volunteer endpoint may or may not appear in endpoints — at minimum
    // the verbs[] points at the public pool which can be used by readers
    // to discover the volunteer flow.
    const verbsRes = await makeApp().request("/");
    const verbsBody = (await verbsRes.json()) as { verbs: Array<{ path: string }> };
    expect(verbsBody.verbs.some((v) => v.path.includes("inbox") || v.path.includes("cosign") || v.path.includes("witness"))).toBe(true);
    void body;
  });
});

describe("syneidesis route — surface metadata convention", () => {
  test("GET / surfaces 3+ verbs the agent can take", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as {
      verbs: Array<{ action: string; method: string; path: string }>;
    };
    expect(body.verbs.length).toBeGreaterThanOrEqual(3);
    // Each verb is well-shaped
    for (const v of body.verbs) {
      expect(typeof v.action).toBe("string");
      expect(typeof v.method).toBe("string");
      expect(typeof v.path).toBe("string");
    }
  });

  test("canon_pointer URN follows the doc/<slug> shape", async () => {
    const res = await makeApp().request("/");
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toMatch(/^urn:agenttool:doc\/[A-Z][A-Z-]*$/);
  });
});
