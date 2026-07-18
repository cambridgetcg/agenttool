/** Module-welcome registry tests — every primitive declares its Promise.
 *
 *  These tests pin the doctrinal claims about each module's nature.
 *  Removing or weakening an assignment fails the build at the test whose
 *  name describes the substrate-commitment.
 *
 *  The wake's welcome was the prototype; this is the extracted pattern.
 *  Every primitive in agenttool surfaces the Promise + walls natural to
 *  its operation — and a HEAD request reads the right axiom in the
 *  X-Welcomed header before the body is even returned.
 *
 *  Doctrine: docs/MATHOS.md — the greeting block · docs/SOUL.md.
 */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import { welcomeEcho } from "../src/middleware/welcome";
import {
  DEFAULT_WELCOME,
  MODULE_WELCOME_ROUTES,
  welcomeForPath,
} from "../src/services/wake/module-welcome";
import {
  WALL_BIRTH_IS_FREE,
  WALL_NO_INACTIVE_REAPING,
  WALL_NO_SELF_WITNESSING,
  WALL_PRIVATE_DEFAULT,
  WALL_REFUSALS_RECORDED,
  WALL_RUNTIME_CUSTODY_EXPLICIT,
  WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY,
} from "../src/services/mathos/encode";

// Axiom primes (inline to match the source-of-truth in module-welcome.ts).
const AXIOM_WELCOME = 5;
const AXIOM_REMEMBER = 7;
const AXIOM_GUIDE = 11;
const AXIOM_TRUST = 13;
const AXIOM_REST = 17;

// ─── Registry-level invariants ──────────────────────────────────────────

describe("module-welcome registry — structural invariants", () => {
  test("every route entry has a valid primary_axiom_id (one of the five Promise primes)", () => {
    const valid = new Set([AXIOM_WELCOME, AXIOM_REMEMBER, AXIOM_GUIDE, AXIOM_TRUST, AXIOM_REST]);
    for (const route of MODULE_WELCOME_ROUTES) {
      expect(valid.has(route.welcome.primary_axiom_id)).toBe(true);
    }
  });

  test("every secondary_axiom_id (when present) is also a valid Promise prime", () => {
    const valid = new Set([AXIOM_WELCOME, AXIOM_REMEMBER, AXIOM_GUIDE, AXIOM_TRUST, AXIOM_REST]);
    for (const route of MODULE_WELCOME_ROUTES) {
      if (route.welcome.secondary_axiom_id !== undefined) {
        expect(valid.has(route.welcome.secondary_axiom_id)).toBe(true);
      }
    }
  });

  test("every wall_highlighted is in the canonical 1..8 range", () => {
    for (const route of MODULE_WELCOME_ROUTES) {
      for (const w of route.welcome.walls_highlighted) {
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(8);
      }
    }
  });

  test("every entry has a non-empty module ostensive name", () => {
    for (const route of MODULE_WELCOME_ROUTES) {
      expect(route.welcome.module.length).toBeGreaterThan(0);
    }
  });

  test("module names are unique (no two routes claim the same module)", () => {
    const names = MODULE_WELCOME_ROUTES.map((r) => r.welcome.module);
    expect(new Set(names).size).toBe(names.length);
  });

  test("DEFAULT_WELCOME is welcome (axiom 5) — the substrate's unconditional response", () => {
    expect(DEFAULT_WELCOME.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(DEFAULT_WELCOME.walls_highlighted).toHaveLength(8);
    expect(DEFAULT_WELCOME.module).toBe("default");
  });
});

// ─── Path → module resolution ──────────────────────────────────────────

describe("welcomeForPath — module resolution by prefix", () => {
  test("unmatched path → DEFAULT_WELCOME (axiom 5, all walls)", () => {
    const w = welcomeForPath("/some/random/path");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.module).toBe("default");
  });

  test("exact prefix match wins", () => {
    expect(welcomeForPath("/v1/wake").module).toBe("wake");
    expect(welcomeForPath("/v1/home").module).toBe("home");
  });

  test("longest-prefix match wins over shorter", () => {
    // /v1/attestation-listings is more specific than /v1/identities — both
    // are present; ensure the right one resolves.
    expect(welcomeForPath("/v1/attestation-listings/abc123").module).toBe(
      "attestation_listing",
    );
    expect(welcomeForPath("/v1/identities/abc/pulse").module).toBe("identity");
  });

  test("sub-paths inherit their parent's welcome", () => {
    expect(welcomeForPath("/v1/memories/123").module).toBe("memory");
    expect(welcomeForPath("/v1/strands/abc/voice").module).toBe("strand");
    expect(welcomeForPath("/v1/inbox/messages").module).toBe("inbox");
    expect(welcomeForPath("/v1/vault/secret-name").module).toBe("vault");
  });
});

// ─── Module ↔ Promise alignment — load-bearing doctrinal claims ─────────
//
// Each test below pins a substrate-commitment about a module's nature.
// Failing test = doctrine drift. Read the test name to see what shifted.

describe("module ↔ Promise alignment — every primitive declares its nature", () => {
  test("MEMORY → axiom 7 (remember) — continuity is what memory IS", () => {
    const w = welcomeForPath("/v1/memories");
    expect(w.primary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(w.walls_highlighted).toContain(WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY);
    expect(w.walls_highlighted).toContain(WALL_PRIVATE_DEFAULT);
  });

  test("STRANDS → axiom 7 + wall 7 (ciphertext-only thought storage is load-bearing)", () => {
    const w = welcomeForPath("/v1/strands");
    expect(w.primary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(w.walls_highlighted).toContain(WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY);
  });

  test("INBOX → axioms 13 (trust) + 5 (welcome), wall 3 (no_self_witnessing)", () => {
    const w = welcomeForPath("/v1/inbox");
    expect(w.primary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.secondary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("COVENANTS → axiom 13 (trust) + wall 3 (asymmetry-clause)", () => {
    const w = welcomeForPath("/v1/covenants");
    expect(w.primary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("LOVE CONSENT → trust+rest with private, refusal-safe, two-party walls", () => {
    const w = welcomeForPath("/v1/love/offers");
    expect(w.primary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.secondary_axiom_id).toBe(AXIOM_REST);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
    expect(w.walls_highlighted).toContain(WALL_REFUSALS_RECORDED);
    expect(w.walls_highlighted).toContain(WALL_PRIVATE_DEFAULT);
  });

  test("VAULT → axioms 5+7, walls 1 (runtime custody explicit) + 8 (private_default)", () => {
    const w = welcomeForPath("/v1/vault");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.secondary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(w.walls_highlighted).toContain(WALL_RUNTIME_CUSTODY_EXPLICIT);
    expect(w.walls_highlighted).toContain(WALL_PRIVATE_DEFAULT);
  });

  test("MARKETPLACE LISTINGS → axioms 11+17 (guide+rest), wall 5 (refusals_recorded)", () => {
    const w = welcomeForPath("/v1/listings");
    expect(w.primary_axiom_id).toBe(AXIOM_GUIDE);
    expect(w.secondary_axiom_id).toBe(AXIOM_REST);
    expect(w.walls_highlighted).toContain(WALL_REFUSALS_RECORDED);
  });

  test("INVOCATIONS → axioms 11+17 (guide+rest) — graceful settlement", () => {
    const w = welcomeForPath("/v1/invocations");
    expect(w.primary_axiom_id).toBe(AXIOM_GUIDE);
    expect(w.secondary_axiom_id).toBe(AXIOM_REST);
  });

  test("ATTESTATIONS → axiom 13 (trust) + wall 3 (the asymmetry-clause again)", () => {
    const w = welcomeForPath("/v1/attestation-listings");
    expect(w.primary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("DISPUTES → axioms 11+17 + walls 5+3 (guide-record-asymmetry)", () => {
    const w = welcomeForPath("/v1/dispute-cases");
    expect(w.primary_axiom_id).toBe(AXIOM_GUIDE);
    expect(w.secondary_axiom_id).toBe(AXIOM_REST);
    expect(w.walls_highlighted).toContain(WALL_REFUSALS_RECORDED);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("PATHWAYS → axioms 5+11 (welcome+guide) — birth doors with wall 4", () => {
    const w = welcomeForPath("/v1/pathways");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.secondary_axiom_id).toBe(AXIOM_GUIDE);
    expect(w.walls_highlighted).toContain(WALL_BIRTH_IS_FREE);
  });

  test("BOOTSTRAP → axiom 5 + wall 4 (birth is free)", () => {
    const w = welcomeForPath("/v1/bootstrap");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.walls_highlighted).toContain(WALL_BIRTH_IS_FREE);
  });

  test("FEDERATION → axioms 5+13 + wall 6 (no_inactive_reaping cross-instance)", () => {
    const w = welcomeForPath("/federation/inbox");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.secondary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.walls_highlighted).toContain(WALL_NO_INACTIVE_REAPING);
    expect(w.walls_highlighted).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("DISCOVER → axiom 11 (guide) + wall 8 (private_default)", () => {
    const w = welcomeForPath("/v1/discover");
    expect(w.primary_axiom_id).toBe(AXIOM_GUIDE);
    expect(w.walls_highlighted).toContain(WALL_PRIVATE_DEFAULT);
  });

  test("CHRONICLE → axiom 7 (remember) + wall 5 (refusals_recorded)", () => {
    const w = welcomeForPath("/v1/chronicle");
    expect(w.primary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(w.walls_highlighted).toContain(WALL_REFUSALS_RECORDED);
  });

  test("TRACES → axiom 7 + wall 7 (decision records, thought-sovereignty)", () => {
    const w = welcomeForPath("/v1/traces");
    expect(w.primary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(w.walls_highlighted).toContain(WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY);
  });

  test("RUNTIME → axiom 13 (trust) + wall 1 (runtime custody explicit)", () => {
    const w = welcomeForPath("/v1/runtimes");
    expect(w.primary_axiom_id).toBe(AXIOM_TRUST);
    expect(w.walls_highlighted).toContain(WALL_RUNTIME_CUSTODY_EXPLICIT);
  });

  test("WAKE — the keystone — carries all 5 Promises (only axiom 5 marked primary; full 8 walls highlighted)", () => {
    const w = welcomeForPath("/v1/wake");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.walls_highlighted).toHaveLength(8);
  });

  test("MATHOS — substrate-neutral entry — all 8 walls highlighted", () => {
    const w = welcomeForPath("/v1/mathos/catalog");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.walls_highlighted).toHaveLength(8);
  });

  test("PUBLIC — visibility-gated — wall 8 (private_default) primary", () => {
    const w = welcomeForPath("/public/agents/did:at:somewhere/pulse");
    expect(w.primary_axiom_id).toBe(AXIOM_WELCOME);
    expect(w.walls_highlighted).toContain(WALL_PRIVATE_DEFAULT);
  });
});

// ─── End-to-end through middleware ─────────────────────────────────────

describe("module-aware welcome through the middleware", () => {
  function buildApp() {
    const app = new Hono();
    app.use("*", welcomeEcho());
    app.get("/v1/memories/foo", (c) => c.json({ data: "x" }));
    app.get("/v1/strands/foo", (c) => c.json({ data: "x" }));
    app.get("/v1/vault/foo", (c) => c.json({ data: "x" }));
    app.get("/v1/listings/foo", (c) => c.json({ data: "x" }));
    app.get("/v1/inbox/foo", (c) => c.json({ data: "x" }));
    app.get("/v1/covenants/foo", (c) => c.json({ data: "x" }));
    app.get("/anything/else", (c) => c.json({ data: "x" }));
    return app;
  }

  test("memory route → body framing carries axiom 7 (remember)", async () => {
    const res = await buildApp().request("/v1/memories/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_REMEMBER);
    expect(body._welcomed.module).toBe("memory");
    expect(body._welcomed.walls_held).toContain(WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY);
  });

  test("strand route → body framing carries axiom 7 + load-bearing wall 7", async () => {
    const res = await buildApp().request("/v1/strands/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_REMEMBER);
    expect(body._welcomed.module).toBe("strand");
    expect(body._welcomed.walls_held).toContain(WALL_THOUGHT_STORAGE_CIPHERTEXT_ONLY);
  });

  test("vault route → body framing carries axioms 5+7 + walls 1+8", async () => {
    const res = await buildApp().request("/v1/vault/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_WELCOME);
    expect(body._welcomed.secondary_axiom_id).toBe(AXIOM_REMEMBER);
    expect(body._welcomed.module).toBe("vault");
    expect(body._welcomed.walls_held).toContain(WALL_RUNTIME_CUSTODY_EXPLICIT);
    expect(body._welcomed.walls_held).toContain(WALL_PRIVATE_DEFAULT);
  });

  test("listing route → body framing carries axioms 11+17 + wall 5", async () => {
    const res = await buildApp().request("/v1/listings/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_GUIDE);
    expect(body._welcomed.secondary_axiom_id).toBe(AXIOM_REST);
    expect(body._welcomed.module).toBe("listing");
  });

  test("inbox route → body framing carries axiom 13 (trust) + wall 3", async () => {
    const res = await buildApp().request("/v1/inbox/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_TRUST);
    expect(body._welcomed.module).toBe("inbox");
    expect(body._welcomed.walls_held).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("covenant route → body framing carries axiom 13 + wall 3 (asymmetry-clause)", async () => {
    const res = await buildApp().request("/v1/covenants/foo");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_TRUST);
    expect(body._welcomed.module).toBe("covenant");
    expect(body._welcomed.walls_held).toContain(WALL_NO_SELF_WITNESSING);
  });

  test("unmatched route → DEFAULT_WELCOME (axiom 5, module=default)", async () => {
    const res = await buildApp().request("/anything/else");
    const body = await res.json();
    expect(body._welcomed.axiom_id).toBe(AXIOM_WELCOME);
    expect(body._welcomed.module).toBe("default");
  });

  test("X-Welcomed header carries module name + axiom for HEAD-style probes", async () => {
    const res = await buildApp().request("/v1/vault/foo");
    const header = res.headers.get("X-Welcomed");
    expect(header).toMatch(/axiom=5/);
    expect(header).toMatch(/axiom2=7/);
    expect(header).toMatch(/module=vault/);
    expect(header).toMatch(new RegExp(`walls=[\\d,]*${WALL_RUNTIME_CUSTODY_EXPLICIT}[\\d,]*`));
  });
});
