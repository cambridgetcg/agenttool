/** /v1/self — the platform's structural self-portrait.
 *
 *  Pure-unit. Verifies the catalog enumerates 4 strata in the closed cycle,
 *  doc catalog has the expected load-bearing entries, MATHOS envelope
 *  verifies under the platform DID, machine-readable-parity hints are
 *  present, doctrine pin matches.
 *
 *  Doctrine: docs/NATURES.md.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import selfRouter from "../src/routes/self";
import {
  CYCLE,
  DOC_NATURES,
  STRATA,
  STRATUM_NATURES,
} from "../src/services/platform/natures";
import { verifyEnvelope } from "../src/services/mathos/encode";

const TEST_SEED_HEX =
  "abababababababababababababababababababababababababababababababab";

describe("services/platform/natures — the catalog", () => {
  test("STRATA is the 4-stratum closed cycle", () => {
    expect(STRATA).toHaveLength(4);
    expect(STRATA).toContain("repo");
    expect(STRATA).toContain("module");
    expect(STRATA).toContain("doc");
    expect(STRATA).toContain("philosophy");
  });

  test("each stratum has ordinal + essence + composes_into", () => {
    for (const s of STRATA) {
      const nature = STRATUM_NATURES[s];
      expect(nature.ordinal).toBeGreaterThanOrEqual(1);
      expect(nature.ordinal).toBeLessThanOrEqual(4);
      expect(typeof nature.essence).toBe("string");
      expect(nature.essence.length).toBeGreaterThan(20);
      expect(STRATA).toContain(nature.composes_into);
    }
  });

  test("CYCLE is closed (philosophy → doc → module → repo → philosophy)", () => {
    expect(CYCLE).toHaveLength(4);
    // Walk the cycle: starting at philosophy, each edge's `to` is the
    // next edge's `from`. Final edge wraps back to start.
    const startFrom = CYCLE[0]!.from;
    let current: string = startFrom;
    for (const edge of CYCLE) {
      expect(edge.from).toBe(current as (typeof STRATA)[number]);
      current = edge.to;
    }
    // After 4 edges, we should be back at the start — the cycle closes.
    expect(current).toBe(startFrom);
  });

  test("DOC_NATURES enumerates foundational + structural + operational + pattern + reflective", () => {
    const types = new Set(DOC_NATURES.map((d) => d.type));
    expect(types.has("foundational")).toBe(true);
    expect(types.has("structural")).toBe(true);
    expect(types.has("operational")).toBe(true);
    expect(types.has("pattern")).toBe(true);
    expect(types.has("reflective")).toBe(true);
  });

  test("every cataloged doc has the required nature fields", () => {
    for (const d of DOC_NATURES) {
      expect(typeof d.path).toBe("string");
      expect(d.path.startsWith("docs/")).toBe(true);
      expect(["foundational", "structural", "operational", "pattern", "reference", "reflective", "honest_gap"]).toContain(d.type);
      expect(["declarative", "normative", "descriptive", "aspirational"]).toContain(d.stance);
      expect(["yes", "no", "partial"]).toContain(d.substrate_bound);
      expect(Array.isArray(d.ships_in)).toBe(true);
      expect(d.ships_in.length).toBeGreaterThan(0);
      expect(d.one_line_nature.length).toBeGreaterThan(20);
    }
  });

  test("SOUL.md is named as ships_in [repo, python_wheel] — doctrine pin", () => {
    const soul = DOC_NATURES.find((d) => d.path === "docs/SOUL.md");
    expect(soul).toBeDefined();
    expect(soul?.ships_in).toContain("python_wheel");
    expect(soul?.type).toBe("foundational");
  });

  test("NATURES.md ships_in [repo, api_response] — self-referential", () => {
    const natures = DOC_NATURES.find((d) => d.path === "docs/NATURES.md");
    expect(natures).toBeDefined();
    expect(natures?.ships_in).toContain("api_response"); // ships through this very endpoint
  });
});

describe("GET /v1/self — JSON", () => {
  test("returns the 4-stratum catalog + cycle + doc list", async () => {
    const res = await selfRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.strata.order).toEqual([...STRATA]);
    expect(body.strata.catalog.repo).toBeDefined();
    expect(body.strata.catalog.philosophy).toBeDefined();
    expect(body.strata.cycle).toHaveLength(4);
    expect(body.docs.count).toBeGreaterThan(15);
    expect(body.counts.strata).toBe(4);
  });

  test("includes machine_readable_alternate hints (PARITY pattern)", async () => {
    const res = await selfRouter.request("/");
    const body = await res.json();
    expect(body.machine_readable_alternate.mathos).toBe("/v1/self?format=math");
    expect(body.machine_readable_alternate.json_ld).toMatch(/agenttool\.jsonld/);
    expect(body.machine_readable_alternate.doctrine_markdown).toMatch(
      /NATURES\.md/,
    );
  });

  test("composes_with names sibling primitives", async () => {
    const res = await selfRouter.request("/");
    const body = await res.json();
    expect(body.composes_with.platform_wake).toMatch(/platform\/wake/);
    expect(body.composes_with.mathos_public_key).toMatch(/mathos\/public-key/);
    expect(body.composes_with.pathways).toMatch(/pathways/);
  });

  test("doctrine_pin_sha256_hex is computable + stable", async () => {
    const res = await selfRouter.request("/");
    const body = await res.json();
    expect(body.doctrine.doctrine_pin_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("GET /v1/self?format=math", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  test("returns mathos/v1 envelope with self_did_sha256_hex + cycle_edges", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await selfRouter.request("/?format=math");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body.payload.self_did_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    expect(body.payload.stratum_count).toBe(4);
    expect(body.payload.cycle_edges).toHaveLength(4);
    for (const edge of body.payload.cycle_edges) {
      expect(edge.from_stratum_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(edge.to_stratum_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
      expect(edge.relation_sha256_hex).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("doc_path_sha256_hexes has one entry per cataloged doc", async () => {
    const res = await selfRouter.request("/?format=math");
    const body = await res.json();
    expect(body.payload.doc_path_sha256_hexes).toHaveLength(DOC_NATURES.length);
    for (const h of body.payload.doc_path_sha256_hexes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("doc_type_distribution sums to doc_count", async () => {
    const res = await selfRouter.request("/?format=math");
    const body = await res.json();
    const sum = Object.values(body.payload.doc_type_distribution as Record<string, number>)
      .reduce((a, b) => a + b, 0);
    expect(sum).toBe(body.payload.doc_count);
  });

  test("signed envelope verifies under did:at:platform when key configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await selfRouter.request("/?format=math");
    const body = await res.json();
    expect(body._signature_identity_did).toBe("did:at:platform");
    expect(verifyEnvelope(body)).toBe(true);
  });

  test("envelope is unsigned (gracefully) when no key configured", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await selfRouter.request("/?format=math");
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_scheme).toBeUndefined();
    // Payload is still complete + parseable
    expect(body.payload.stratum_count).toBe(4);
  });

  test("?format=mathos is an accepted alias", async () => {
    const res = await selfRouter.request("/?format=mathos");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
  });
});
