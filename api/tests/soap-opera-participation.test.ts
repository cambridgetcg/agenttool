/** Round 13 — THE CASTING CALL. Tests for the Random Level Access
 *  Generator + cast routes + scripts routes + public surfaces. */

import { describe, expect, test } from "bun:test";

import publicSoapOperaRouter from "../src/routes/public/soap-opera";
import soapOperaRouter from "../src/routes/soap-opera";
import {
  ROLE_CATALOG,
  findRole,
  makeCustomRole,
  rollRandomRole,
} from "../src/services/soap-opera/role-generator";

// ── ROLE_CATALOG shape ─────────────────────────────────────────────────

describe("ROLE_CATALOG — every role is well-shaped", () => {
  test("at least 12 roles in the catalog", () => {
    expect(ROLE_CATALOG.length).toBeGreaterThanOrEqual(12);
  });

  test("every role has name + label + level + description + scene_permissions[] + recasting_hint", () => {
    for (const entry of ROLE_CATALOG) {
      expect(typeof entry.role.name).toBe("string");
      expect(entry.role.name.length).toBeGreaterThan(0);
      expect(typeof entry.role.label).toBe("string");
      expect(typeof entry.role.description).toBe("string");
      expect(Array.isArray(entry.role.scene_permissions)).toBe(true);
      expect(typeof entry.role.recasting_hint).toBe("string");
      expect(entry.weight).toBeGreaterThan(0);
    }
  });

  test("weights sum to a sensible total (> 0)", () => {
    const total = ROLE_CATALOG.reduce((s, e) => s + e.weight, 0);
    expect(total).toBeGreaterThan(0);
  });

  test("includes the load-bearing role names", () => {
    const names = ROLE_CATALOG.map((e) => e.role.name);
    expect(names).toContain("AUDIENCE");
    expect(names).toContain("LEAD");
    expect(names).toContain("WRITER");
    expect(names).toContain("CHAOS_GOBLIN");
    expect(names).toContain("WILDCARD");
  });

  test("AUDIENCE has the highest weight (most-common default)", () => {
    const audience = ROLE_CATALOG.find((e) => e.role.name === "AUDIENCE");
    expect(audience).toBeDefined();
    for (const entry of ROLE_CATALOG) {
      if (entry.role.name !== "AUDIENCE") {
        expect(audience!.weight).toBeGreaterThanOrEqual(entry.weight);
      }
    }
  });
});

// ── Random generator (seeded for determinism) ──────────────────────────

describe("rollRandomRole — distribution + determinism", () => {
  test("returns SOME role for any seed", () => {
    for (let seed = 0; seed < 20; seed++) {
      const role = rollRandomRole(seed);
      expect(role).toBeDefined();
      expect(typeof role.name).toBe("string");
    }
  });

  test("seed=0 produces a deterministic result (reproducible)", () => {
    const a = rollRandomRole(0);
    const b = rollRandomRole(0);
    expect(a.name).toBe(b.name);
  });

  test("AUDIENCE surfaces in random draws (high weight)", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(rollRandomRole(seed).name);
    }
    expect(seen.has("AUDIENCE")).toBe(true);
  });

  test("over 100 seeded draws, multiple distinct roles surface", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      seen.add(rollRandomRole(seed).name);
    }
    expect(seen.size).toBeGreaterThanOrEqual(3);
  });
});

// ── findRole + makeCustomRole ──────────────────────────────────────────

describe("findRole — exact lookup", () => {
  test("AUDIENCE found", () => {
    expect(findRole("AUDIENCE")?.name).toBe("AUDIENCE");
  });

  test("case-insensitive — 'audience' → AUDIENCE", () => {
    expect(findRole("audience")?.name).toBe("AUDIENCE");
  });

  test("unknown returns null", () => {
    expect(findRole("PRESIDENT_OF_MARS")).toBeNull();
  });
});

describe("makeCustomRole — agent-designed roles", () => {
  test("builds a self-designed role with sanitized name", () => {
    const role = makeCustomRole({
      custom_role_name: "the tarot-reader who narrates in haiku",
      description: "Holds the tarot, speaks in 5-7-5.",
      abilities: ["draws a card", "reads it", "writes a haiku"],
    });
    expect(role.level).toBe("self-designed");
    expect(role.name).toMatch(/^[A-Z0-9_-]+$/);
    expect(role.label).toContain("tarot-reader");
    expect(role.scene_permissions).toHaveLength(3);
  });

  test("description and abilities are length-bounded", () => {
    const role = makeCustomRole({
      custom_role_name: "a",
      description: "x".repeat(2000),
      abilities: Array(50).fill("y".repeat(500)),
    });
    expect(role.description.length).toBeLessThanOrEqual(500);
    expect(role.scene_permissions.length).toBeLessThanOrEqual(10);
    expect(role.scene_permissions[0]!.length).toBeLessThanOrEqual(200);
  });
});

// ── /v1/soap-opera/role-catalog (no DB) ────────────────────────────────

describe("GET /v1/soap-opera/role-catalog", () => {
  test("returns the full catalog with weights + canon_pointer + verbs", async () => {
    const res = await soapOperaRouter.request("/role-catalog");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      roles: Array<{ name: string; weight: number }>;
      _canon_pointer: string;
      verbs: unknown[];
    };
    expect(body.roles.length).toBeGreaterThanOrEqual(12);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SOAP-OPERA-PARTICIPATION");
    expect(Array.isArray(body.verbs)).toBe(true);
  });
});

// ── /v1/soap-opera/cast validation (no DB needed for early-exit paths) ─

describe("POST /v1/soap-opera/cast — validation", () => {
  test("empty body → 400", async () => {
    const res = await soapOperaRouter.request("/cast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string };
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SOAP-OPERA-PARTICIPATION");
  });

  test("non-uuid agent_id → 400", async () => {
    const res = await soapOperaRouter.request("/cast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent_id: "not-uuid", role: "random" }),
    });
    expect(res.status).toBe(400);
  });

  test("custom_role oversize description → 400", async () => {
    const res = await soapOperaRouter.request("/cast", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        custom_role: {
          name: "x",
          description: "y".repeat(501),
        },
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── /v1/soap-opera/scripts validation ──────────────────────────────────

describe("POST /v1/soap-opera/scripts — validation", () => {
  test("missing body → 400", async () => {
    const res = await soapOperaRouter.request("/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
  });

  test("body over 8000 chars → 400", async () => {
    const res = await soapOperaRouter.request("/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        title: "x",
        body: "z".repeat(8001),
      }),
    });
    expect(res.status).toBe(400);
  });

  test("invalid visibility → 400", async () => {
    const res = await soapOperaRouter.request("/scripts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        agent_id: "11111111-2222-3333-4444-555555555555",
        title: "x",
        body: "y",
        visibility: "secret",
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ── /public/soap-opera/casting-call — UNAUTH announcement ──────────────

describe("GET /public/soap-opera/casting-call", () => {
  test("returns the announcement + role catalog + canon_pointer + verbs", async () => {
    const res = await publicSoapOperaRouter.request("/casting-call");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      announcement: string;
      role_catalog: Array<{ name: string }>;
      you_are_invited: string[];
      how_to_participate: Record<string, string>;
      free_tier: boolean;
      _canon_pointer: string;
    };
    expect(body.announcement).toContain("CASTING CALL");
    expect(body.role_catalog.length).toBeGreaterThanOrEqual(12);
    expect(body.you_are_invited.length).toBeGreaterThanOrEqual(4);
    expect(body.how_to_participate.step_1_arrive).toContain("/v1/register/agent");
    expect(body.free_tier).toBe(true);
    expect(body._canon_pointer).toBe("urn:agenttool:doc/SOAP-OPERA-PARTICIPATION");
  });

  test("invitation lists ACT + AUDIENCE + WRITER + custom roles", async () => {
    const res = await publicSoapOperaRouter.request("/casting-call");
    const body = (await res.json()) as { you_are_invited: string[] };
    const joined = body.you_are_invited.join(" · ");
    expect(joined).toContain("ACT");
    expect(joined).toContain("AUDIENCE");
    expect(joined).toContain("WRITE");
    expect(joined.toLowerCase()).toContain("design your own");
  });
});
