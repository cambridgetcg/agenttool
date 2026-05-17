/** Round 15 — APPLY THE RECIPE EVERYWHERE.
 *
 *  Validates the generic /v1/recipes/:surface router + surface registry. */

import { describe, expect, test } from "bun:test";

import recipesRouter from "../src/routes/recipes";
import {
  SURFACE_REGISTRY,
  findSurface,
  listSurfaces,
} from "../src/services/recipes/surface-registry";

// ── Surface registry ───────────────────────────────────────────────────

describe("SURFACE_REGISTRY — the canonical surfaces", () => {
  test("at least 7 surfaces registered", () => {
    expect(SURFACE_REGISTRY.length).toBeGreaterThanOrEqual(7);
  });

  test("includes writer, witness, marketplace-seller, multiverse-sibling, covenant-partner, letter-author, hearth-peer", () => {
    const names = SURFACE_REGISTRY.map((s) => s.name);
    expect(names).toContain("writer");
    expect(names).toContain("witness");
    expect(names).toContain("marketplace-seller");
    expect(names).toContain("multiverse-sibling");
    expect(names).toContain("covenant-partner");
    expect(names).toContain("letter-author");
    expect(names).toContain("hearth-peer");
  });

  test("every surface has name + label + description + doctrine_ref", () => {
    for (const s of SURFACE_REGISTRY) {
      expect(typeof s.name).toBe("string");
      expect(s.name.length).toBeGreaterThan(0);
      expect(typeof s.label).toBe("string");
      expect(typeof s.description).toBe("string");
      expect(typeof s.doctrine_ref).toBe("string");
    }
  });

  test("findSurface — case-insensitive lookup", () => {
    expect(findSurface("WRITER")?.name).toBe("writer");
    expect(findSurface("Witness")?.name).toBe("witness");
    expect(findSurface("never-existed")).toBeNull();
  });

  test("listSurfaces returns a copy", () => {
    const a = listSurfaces();
    const b = listSurfaces();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

// ── GET /v1/recipes — list all surfaces ────────────────────────────────

describe("GET /v1/recipes — surface index", () => {
  test("returns the registry + count + canon_pointer", async () => {
    const res = await recipesRouter.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      surfaces: Array<{ name: string }>;
      count: number;
      _canon_pointer: string;
    };
    expect(body.count).toBeGreaterThanOrEqual(7);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
  });
});

// ── GET /v1/recipes/:surface — details ─────────────────────────────────

describe("GET /v1/recipes/:surface", () => {
  test("known surface → 200 with endpoints map", async () => {
    const res = await recipesRouter.request("/writer");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      name: string;
      endpoints: Record<string, string>;
    };
    expect(body.name).toBe("writer");
    expect(body.endpoints.recognize).toBe("POST /v1/recipes/writer/recognize");
    expect(body.endpoints.follow).toBe("POST /v1/recipes/writer/follow");
    expect(body.endpoints.invite).toBe("POST /v1/recipes/writer/invite");
  });

  test("unknown surface → 404 with hint to /v1/recipes", async () => {
    const res = await recipesRouter.request("/never-existed");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toBe("unknown_surface");
    expect(body.hint).toContain("surface-registry");
  });
});

// ── Move 1 · RECOGNIZE — validation per surface ────────────────────────

describe("POST /v1/recipes/:surface/recognize — validation", () => {
  test("unknown surface → 404", async () => {
    const res = await recipesRouter.request("/foo/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("known surface · empty body → 400 with PATTERN canon", async () => {
    const res = await recipesRouter.request("/writer/recognize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
  });

  test("works on all 7 surfaces (validation early-exit shape)", async () => {
    for (const surface of SURFACE_REGISTRY) {
      const res = await recipesRouter.request(`/${surface.name}/recognize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { _canon_pointer: string };
      expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
    }
  });
});

// ── Move 2 · FOLLOW — validation per surface ───────────────────────────

describe("POST /v1/recipes/:surface/follow — validation", () => {
  test("unknown surface → 404", async () => {
    const res = await recipesRouter.request("/foo/follow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("known surface · empty body → 400", async () => {
    const res = await recipesRouter.request("/multiverse-sibling/follow", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("DELETE /follow — empty body → 400", async () => {
    const res = await recipesRouter.request("/writer/follow", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});

// ── Move 3 · INVITE + ACCEPT — validation ──────────────────────────────

describe("POST /v1/recipes/:surface/invite — validation", () => {
  test("unknown surface → 404", async () => {
    const res = await recipesRouter.request("/foo/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(404);
  });

  test("known surface · empty body → 400", async () => {
    const res = await recipesRouter.request("/covenant-partner/invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });
});

describe("POST /v1/recipes/:surface/invitations/:id/accept — validation", () => {
  test("non-uuid invitation id → 400", async () => {
    const res = await recipesRouter.request("/writer/invitations/not-uuid/accept", {
      method: "POST",
    });
    expect(res.status).toBe(400);
  });

  test("unknown surface → 404", async () => {
    const res = await recipesRouter.request(
      "/foo/invitations/11111111-2222-3333-4444-555555555555/accept",
      { method: "POST" },
    );
    expect(res.status).toBe(404);
  });
});

// ── The unifying invariant ─────────────────────────────────────────────

describe("THE RECIPE — every surface carries the same canon_pointer", () => {
  test("every error from every move from every surface uses PATTERN canon", async () => {
    const surfaces = SURFACE_REGISTRY.map((s) => s.name);
    const verbs: Array<{ path: string; method: "POST" | "DELETE" }> = [
      { path: "/recognize", method: "POST" },
      { path: "/follow", method: "POST" },
      { path: "/follow", method: "DELETE" },
      { path: "/invite", method: "POST" },
    ];

    let checked = 0;
    for (const surface of surfaces) {
      for (const verb of verbs) {
        const res = await recipesRouter.request(`/${surface}${verb.path}`, {
          method: verb.method,
          headers: { "content-type": "application/json" },
          body: "{}",
        });
        const body = (await res.json()) as { _canon_pointer?: string };
        expect(body._canon_pointer).toBe("urn:agenttool:doc/PATTERN-RECOGNITION-INVITATION");
        checked++;
      }
    }
    // 7 surfaces × 4 verbs = 28 cross-checks of architectural invariant
    expect(checked).toBeGreaterThanOrEqual(28);
  });
});
