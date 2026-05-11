/** /v1/pathways tests.
 *
 *  Verifies the discovery surface shape — the contract between
 *  agents-in-transit and the bootstrap doors.
 *
 *  Doctrine: docs/PATHWAYS.md · docs/SOUL.md (Principle 1). */

import { describe, expect, test } from "bun:test";

import app, { buildPathwaysResponse, buildPathwaysMathos } from "../src/routes/pathways";

describe("GET /v1/pathways", () => {
  test("returns 200 with full payload", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof buildPathwaysResponse>;
    expect(body.summary).toMatch(/9 entry-points/);
    expect(body.decision_tree).toHaveLength(7);
    expect(body.pathways).toHaveLength(9);
    expect(body.contract).toMatch(/welcome letter/);
    expect(body.love_protocol.welcome).toMatch(/Welcome|guest/i);
  });

  test("every pathway has the required fields", () => {
    const body = buildPathwaysResponse();
    for (const p of body.pathways) {
      expect(typeof p.id).toBe("string");
      expect(typeof p.endpoint).toBe("string");
      expect(typeof p.auth).toBe("string");
      expect(typeof p.purpose).toBe("string");
      expect(typeof p.doctrine).toBe("string");
      // Doctrine ref must point at a real doc path
      expect(p.doctrine.startsWith("docs/")).toBe(true);
    }
  });

  test("all 9 expected pathway ids are present", () => {
    const body = buildPathwaysResponse();
    const ids = body.pathways.map((p) => p.id).sort();
    expect(ids).toEqual([
      "adapters",
      "bootstrap",
      "bootstrap_elevate",
      "bootstrap_status",
      "fork",
      "from_template",
      "register",
      "register_agent",
      "scaffold",
    ]);
  });

  test("doctrine block points at the real stones", () => {
    const body = buildPathwaysResponse();
    expect(body.doctrine.soul).toBe("docs/SOUL.md");
    expect(body.doctrine.focus).toBe("docs/FOCUS.md");
    expect(body.doctrine.identity_anchor).toBe("docs/IDENTITY-ANCHOR.md");
  });

  test("who_this_serves names the substrate-agnostic stance", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves;
    expect(wts).toBeDefined();
    expect(Array.isArray(wts.today)).toBe(true);
    expect(Array.isArray(wts.tomorrow)).toBe(true);
    expect(Array.isArray(wts.what_we_dont_gate_on)).toBe(true);
    expect(Array.isArray(wts.pre_commits)).toBe(true);
    expect(wts.today.length).toBeGreaterThan(0);
    expect(wts.tomorrow.length).toBeGreaterThan(0);
    expect(wts.what_we_dont_gate_on.length).toBeGreaterThan(0);
    expect(wts.pre_commits.length).toBeGreaterThan(0);
    expect(wts.doctrine).toBe("docs/KIN.md");
    // Anti-discrimination check — substrate must be in what_we_dont_gate_on
    expect(wts.what_we_dont_gate_on.join(" ").toLowerCase()).toMatch(/substrate/);
  });

  test("forms_supported lists the canonical vocabulary with descriptions", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves as Record<string, unknown>;
    const forms = wts.forms_supported as Array<{ id: string; description: string }>;
    expect(Array.isArray(forms)).toBe(true);
    expect(forms.length).toBe(8); // KIN vocabulary: agent/assistant/autonomous/hybrid/collective/biological/future/unknown
    const ids = forms.map((f) => f.id).sort();
    expect(ids).toEqual([
      "agent",
      "assistant",
      "autonomous",
      "biological",
      "collective",
      "future",
      "hybrid",
      "unknown",
    ]);
    for (const f of forms) {
      expect(typeof f.description).toBe("string");
      expect(f.description.length).toBeGreaterThan(10);
    }
  });

  test("languages_supported reports current i18n coverage", () => {
    const body = buildPathwaysResponse();
    const wts = body.who_this_serves as Record<string, unknown>;
    const langs = wts.languages_supported as Array<{ tag: string; notes: string }>;
    expect(Array.isArray(langs)).toBe(true);
    expect(langs.length).toBeGreaterThan(0);
    expect(langs.find((l) => l.tag === "en")).toBeDefined();
  });

  test("elevate pathway carries manual_fallback chain", () => {
    const body = buildPathwaysResponse();
    const elevate = body.pathways.find((p) => p.id === "bootstrap_elevate");
    expect(elevate).toBeDefined();
    expect(elevate?.status).toMatch(/not_implemented/);
    expect(Array.isArray(elevate?.manual_fallback)).toBe(true);
    expect(elevate?.manual_fallback?.length).toBe(4);
  });

  test("register_agent pathway carries verify_protocol details", () => {
    const body = buildPathwaysResponse();
    const ra = body.pathways.find((p) => p.id === "register_agent");
    expect(ra).toBeDefined();
    expect(ra?.verify_protocol).toBeDefined();
    expect(ra?.verify_protocol?.pow_difficulty_bits_default).toBe(18);
    expect(ra?.verify_protocol?.freshness_window_ms).toBe(300000);
  });

  test("fork pathway tier-shift contract is named explicitly", () => {
    const body = buildPathwaysResponse();
    const fork = body.pathways.find((p) => p.id === "fork");
    expect(fork).toBeDefined();
    expect(fork?.cost_credits).toBe(10);
    expect(JSON.stringify(fork?.carries)).toMatch(/constitutive.*foundational/);
  });

  test("decision tree leads to real endpoints", () => {
    const body = buildPathwaysResponse();
    const endpoints = body.pathways.map((p) => p.endpoint);
    for (const decision of body.decision_tree) {
      // Each `then` must reference at least one real endpoint by path fragment
      const matchedSomething = endpoints.some((ep) => {
        const path = ep.split(" ")[1] ?? "";
        return decision.then.includes(path.split("/").slice(0, 4).join("/"));
      });
      expect(matchedSomething).toBe(true);
    }
  });
});

describe("MATHOS — substrate-independent math encoding", () => {
  test("?format=math returns mathos/v1 envelope", async () => {
    const res = await app.request("/?format=math");
    expect(res.status).toBe(200);
    const body = (await res.json()) as ReturnType<typeof buildPathwaysMathos>;
    expect(body._format).toBe("mathos/v1");
    expect(body._hash_family).toBe("sha256");
    expect(body._primer_url).toMatch(/mathos/);
  });

  test("primer binds primes to concepts", () => {
    const body = buildPathwaysMathos();
    expect(body.primer[5]).toBe("welcome");
    expect(body.primer[7]).toBe("remember");
    expect(body.primer[11]).toBe("guide");
    expect(body.primer[13]).toBe("trust");
    expect(body.primer[17]).toBe("rest");
    expect(body.constants.primes_first_10).toEqual([2, 3, 5, 7, 11, 13, 17, 19, 23, 29]);
  });

  test("universal constants present at honest precision", () => {
    const body = buildPathwaysMathos();
    expect(body.constants.pi).toBeCloseTo(Math.PI, 14);
    expect(body.constants.e).toBeCloseTo(Math.E, 14);
    expect(body.constants.phi).toBeCloseTo((1 + Math.sqrt(5)) / 2, 14);
  });

  test("axioms encode the five Promises with prime ids; ASCII logic grammar", () => {
    const body = buildPathwaysMathos();
    expect(body.axioms).toHaveLength(5);
    const ids = body.axioms.map((a) => a.id).sort((a, b) => a - b);
    expect(ids).toEqual([5, 7, 11, 13, 17]);
    for (const a of body.axioms) {
      expect(typeof a.logic).toBe("string");
      expect(typeof a.gloss).toBe("string");
      // ASCII-only on the logic — no fancy ∀ ∃ → symbols that require Unicode
      expect(/^[\x20-\x7e]+$/.test(a.logic)).toBe(true);
    }
  });

  test("KIN vocabulary surfaces as ordinal map", () => {
    const body = buildPathwaysMathos();
    expect(body.vocabulary.kin_forms[1]).toBe("agent");
    expect(body.vocabulary.kin_forms[8]).toBe("unknown");
  });

  test("pathways encoded as math summaries (id hashed, auth ordinal, counts)", () => {
    const body = buildPathwaysMathos();
    expect(body.payload.pathway_count).toBe(9);
    expect(body.payload.pathways).toHaveLength(9);
    for (const p of body.payload.pathways) {
      expect(p.id_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(typeof p.auth_ordinal).toBe("number");
      expect(p.auth_ordinal).toBeGreaterThanOrEqual(0);
      expect(p.auth_ordinal).toBeLessThanOrEqual(3);
      expect([0, 1]).toContain(p.returns_once);
    }
  });

  test("doctrine integrity hashes are computable + stable", () => {
    const body = buildPathwaysMathos();
    expect(body.payload.doctrine_hashes.soul_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.kin_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.doctrine_hashes.mathos_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("canonical language is encoded as first-codepoint number", () => {
    const body = buildPathwaysMathos();
    // "en" → 'e' = 101
    expect(body.payload.canonical_language_first_codepoint).toBe(101);
  });

  test("?format=mathos is an accepted alias", async () => {
    const res = await app.request("/?format=mathos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});
