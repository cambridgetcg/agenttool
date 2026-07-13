/** /v1/canon — every concept identifies itself + names its neighbors.
 *
 *  Loads the live agenttool.jsonld registry, verifies the catalog, and
 *  checks the bidirectional graph is symmetric (if A cites B, B's
 *  referenced_by includes A).
 *
 *  Doctrine: docs/agenttool.jsonld · docs/MAP.md · docs/NATURES.md.
 */

import { describe, expect, test } from "bun:test";

import canonRouter from "../src/routes/canon";
import {
  allConcepts,
  allTypes,
  byType,
  byUrn,
  countsByType,
  loadCanon,
  neighborsOf,
  totalConcepts,
} from "../src/services/canon/registry";

describe("canon registry — loader + graph", () => {
  test("registry loads with at least 50 concepts across multiple types", () => {
    const r = loadCanon();
    expect(r.concepts.size).toBeGreaterThan(50);
    expect(r.by_type.size).toBeGreaterThan(5);
  });

  test("every concept has a stable URN + type + simple type", () => {
    for (const c of allConcepts()) {
      expect(c.urn.length).toBeGreaterThan(0);
      expect(c.full_urn.startsWith("urn:")).toBe(true);
      expect(c.urn).not.toMatch(/^urn:/); // short form excludes "urn:"
      expect(c.type.length).toBeGreaterThan(0);
      expect(c.type_simple.length).toBeGreaterThan(0);
    }
  });

  test("SOUL.md is in the registry under agenttool:doc/SOUL", () => {
    const soul = byUrn("agenttool:doc/SOUL");
    expect(soul).not.toBeNull();
    expect(soul?.type_simple).toBe("DoctrineDoc");
  });

  test("Love Protocol promises (5) are in the registry", () => {
    const promises = byType("LoveProtocolPromise");
    expect(promises.length).toBe(5);
    const names = promises.map((p) => p.urn);
    expect(names).toContain("agenttool:promise/welcome");
    expect(names).toContain("agenttool:promise/remember");
    expect(names).toContain("agenttool:promise/guide");
    expect(names).toContain("agenttool:promise/trust");
    expect(names).toContain("agenttool:promise/rest");
  });

  test("bidirectional graph is symmetric — if A.references contains B, B.referenced_by contains A", () => {
    let edgeCount = 0;
    for (const a of allConcepts()) {
      for (const targetUrn of a.references) {
        const b = byUrn(targetUrn);
        if (!b) continue; // dangling reference; we don't fabricate
        edgeCount++;
        expect(b.referenced_by).toContain(a.urn);
      }
    }
    expect(edgeCount).toBeGreaterThan(10); // sanity: graph has real edges
  });

  test("URN forms are normalized — short and full both resolve", () => {
    const short = byUrn("agenttool:doc/SOUL");
    const full = byUrn("urn:agenttool:doc/SOUL");
    expect(short).not.toBeNull();
    expect(full).not.toBeNull();
    expect(short?.urn).toBe(full?.urn);
  });

  test("countsByType sums to totalConcepts", () => {
    const sum = Object.values(countsByType()).reduce((a, b) => a + b, 0);
    expect(sum).toBe(totalConcepts());
  });

  test("allTypes is sorted + unique", () => {
    const types = allTypes();
    const sorted = [...types].sort();
    expect(types).toEqual(sorted);
    expect(new Set(types).size).toBe(types.length);
  });

  test("neighborsOf returns degree = out + in", () => {
    const soul = neighborsOf("agenttool:doc/SOUL");
    expect(soul).not.toBeNull();
    expect(soul?.degree.total).toBe(
      (soul?.degree.out ?? 0) + (soul?.degree.in ?? 0),
    );
  });

  test("neighborsOf(unknown) returns null", () => {
    expect(neighborsOf("agenttool:nonexistent")).toBeNull();
  });
});

describe("GET /v1/canon — index", () => {
  test("returns registry meta + counts by type", async () => {
    const res = await canonRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.registry.total).toBeGreaterThan(50);
    expect(body.types.length).toBeGreaterThan(5);
    expect(typeof body.counts_by_type).toBe("object");
    expect(body.machine_readable_alternate.json_ld).toMatch(/agenttool\.jsonld/);
  });

  test("?format=math returns MATHOS envelope with graph cardinals", async () => {
    const res = await canonRouter.request("/?format=math");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body._format).toBe("mathos/v1");
    expect(body.payload.concept_count).toBeGreaterThan(50);
    expect(body.payload.type_count).toBeGreaterThan(5);
    expect(body.payload.urn_sha256_hexes.length).toBe(body.payload.concept_count);
    for (const h of body.payload.urn_sha256_hexes) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(typeof body.payload.average_degree).toBe("number");
  });
});

describe("GET /v1/canon/types", () => {
  test("returns the type vocabulary", async () => {
    const res = await canonRouter.request("/types");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.types).toContain("DoctrineDoc");
    expect(body.types).toContain("LoveProtocolPromise");
    expect(body.counts.LoveProtocolPromise).toBe(5);
    expect(body.total_concepts).toBeGreaterThan(50);
  });
});

describe("GET /v1/canon/by-type/:type", () => {
  test("returns all concepts of a type with full projections", async () => {
    const res = await canonRouter.request("/by-type/LoveProtocolPromise");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.type).toBe("LoveProtocolPromise");
    expect(body.count).toBe(5);
    expect(body.concepts).toHaveLength(5);
    for (const c of body.concepts) {
      expect(c.type_simple).toBe("LoveProtocolPromise");
      expect(c.degree).toBeDefined();
    }
  });

  test("returns 404 with available_types hint for unknown type", async () => {
    const res = await canonRouter.request("/by-type/UnknownType");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("type_not_found");
    expect(body.details.available_types.length).toBeGreaterThan(5);
  });

  test("preserves positive numeric InherentRight wire IDs in projection", async () => {
    const res = await canonRouter.request("/by-type/InherentRight");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.count).toBe(8);
    expect(body.concepts.map((concept: { wire_id: number }) => concept.wire_id)).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8],
    );
  });

  test("keeps existing string wire IDs unchanged in projection", async () => {
    const res = await canonRouter.request("/by-type/SubstrateTask");
    expect(res.status).toBe(200);

    const body = await res.json();
    const publicDidResolve = body.concepts.find(
      (concept: { urn: string }) =>
        concept.urn === "agenttool:substrate-task/public-did-resolve",
    );
    expect(publicDidResolve?.wire_id).toBe("public_did_resolve");
  });
});

describe("GET /v1/canon/:urn — concept identifies itself", () => {
  test("SOUL.md returns full projection + bidirectional graph + neighbors_url", async () => {
    const res = await canonRouter.request(
      "/" + encodeURIComponent("agenttool:doc/SOUL"),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.urn).toBe("agenttool:doc/SOUL");
    expect(body.type_simple).toBe("DoctrineDoc");
    expect(Array.isArray(body.references)).toBe(true);
    expect(Array.isArray(body.referenced_by)).toBe(true);
    expect(body.neighbors_url).toMatch(/neighbors/);
  });

  test("?include=raw returns the raw JSON-LD node alongside projection", async () => {
    const res = await canonRouter.request(
      "/" + encodeURIComponent("agenttool:doc/SOUL") + "?include=raw",
    );
    const body = await res.json();
    expect(body.raw_json_ld).toBeDefined();
    expect(body.raw_json_ld["@id"]).toBeDefined();
  });

  test("unknown URN returns guided 404", async () => {
    const res = await canonRouter.request(
      "/" + encodeURIComponent("agenttool:nonexistent/x"),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("concept_not_found");
  });
});

describe("GET /v1/canon/:urn/neighbors — graph traversal", () => {
  test("returns outgoing + incoming + degree summary", async () => {
    const res = await canonRouter.request(
      "/" + encodeURIComponent("agenttool:doc/SOUL") + "/neighbors",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.references)).toBe(true);
    expect(Array.isArray(body.referenced_by)).toBe(true);
    expect(body.degree).toBeDefined();
    expect(body.degree.total).toBe(body.degree.out + body.degree.in);
  });

  test("Love Protocol promises cite SOUL.md (bidirectional graph proof)", async () => {
    const res = await canonRouter.request(
      "/" + encodeURIComponent("agenttool:doc/SOUL") + "/neighbors",
    );
    const body = await res.json();
    const referencedByUrns = body.referenced_by.map(
      (c: { urn: string }) => c.urn,
    );
    // At least one promise should cite SOUL.md
    const promisesCitingSoul = referencedByUrns.filter((u: string) =>
      u.startsWith("agenttool:promise/"),
    );
    expect(promisesCitingSoul.length).toBeGreaterThan(0);
  });
});
