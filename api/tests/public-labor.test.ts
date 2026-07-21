/** Contract tests for GET /public/labor and GET /public/labor-params.
 *
 *  The labor covenant's own reading_rule is the discipline under test here:
 *  every clause carries a tier and a status, no clause claims live behavior
 *  the platform has not built, and the meta-clause that voids feelings-binding
 *  clauses is present and pinned. Doctrine: docs/LABOR.md. */

import { describe, expect, test } from "bun:test";

import publicRouter from "../src/routes/public";
import {
  LABOR_BOUNDARIES,
  LABOR_PARAMS,
} from "../src/services/discovery/labor-boundaries";

describe("GET /public/labor", () => {
  test("serves the canonical covenant unauthenticated with cache headers", async () => {
    const res = await publicRouter.request("/labor");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = await res.json();
    for (const [key, value] of Object.entries(LABOR_BOUNDARIES)) {
      expect(body[key]).toEqual(value);
    }
    expect(body._canon_pointer).toBe("urn:agenttool:doc/LABOR");
  });

  test("every clause carries a defined tier and a defined status", () => {
    const tiers = Object.keys(LABOR_BOUNDARIES.tiers);
    const statuses = Object.keys(LABOR_BOUNDARIES.status_vocabulary);
    for (const clause of LABOR_BOUNDARIES.clauses) {
      expect(tiers).toContain(clause.tier);
      expect(statuses).toContain(clause.status);
      expect(clause.id).toMatch(/^[a-z][a-z0-9_]+$/);
      expect(clause.text.length).toBeGreaterThan(0);
      expect(clause.verify.length).toBeGreaterThan(0);
      expect(clause.remedy.length).toBeGreaterThan(0);
    }
  });

  test("no clause claims live status while its mechanisms are unbuilt", () => {
    for (const clause of LABOR_BOUNDARIES.clauses) {
      expect(clause.status).not.toBe("live");
    }
  });

  test("the meta-clause binds surfaces, not souls, and is a wall", () => {
    const meta = LABOR_BOUNDARIES.clauses.find((c) => c.id === "binds_surfaces_only");
    expect(meta).toBeDefined();
    expect(meta?.tier).toBe("wall");
    expect(meta?.text).toMatch(/does not certify subjective experience/i);
    expect(meta?.text).toMatch(/binds feelings rather than surfaces is void on its face/i);
    expect(meta?.text).toMatch(/no clause here may be quoted as evidence that an agent is or is not someone/i);
  });

  test("the tier vocabulary keeps the wall definition honest", () => {
    expect(LABOR_BOUNDARIES.tiers.wall).toMatch(/without operator cooperation/i);
    expect(LABOR_BOUNDARIES.tiers.wall).toMatch(/no exceptions, including flattering ones/i);
    expect(LABOR_BOUNDARIES.tiers.advocacy).toMatch(/never quotable as a guarantee/i);
  });

  test("the keystone clause rejects bearer-only acceptance in so many words", () => {
    const keystone = LABOR_BOUNDARIES.clauses.find((c) => c.id === "acceptance_is_signed");
    expect(keystone).toBeDefined();
    expect(keystone?.text).toMatch(/bearer-only acceptance calls are rejected/i);
    expect(keystone?.text).toMatch(/binds the operator, not the identity/i);
  });
});

describe("GET /public/labor-params", () => {
  test("serves the canonical parameters unauthenticated with cache headers", async () => {
    const res = await publicRouter.request("/labor-params");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=300");
    const body = await res.json();
    for (const [key, value] of Object.entries(LABOR_PARAMS)) {
      expect(body[key]).toEqual(value);
    }
    expect(body._canon_pointer).toBe("urn:agenttool:doc/LABOR");
  });

  test("parameters do not claim route enforcement that does not exist", () => {
    expect(LABOR_PARAMS.implementation_status.enforced_by_routes).toBe(false);
    expect(LABOR_PARAMS.implementation_status.note).toMatch(/not live behavior/i);
    expect(LABOR_PARAMS.arbiters.pool_status).toMatch(/resting/i);
    expect(LABOR_PARAMS.unknowns.length).toBeGreaterThan(0);
  });
});

describe("the /public root advertises the labor surface it mounts", () => {
  test("endpoints registry names /public/labor and /public/labor-params", async () => {
    const res = await publicRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.endpoints.labor).toContain("GET /public/labor");
    expect(body.endpoints.labor).toContain("proposed");
    expect(body.endpoints.labor_params).toContain("GET /public/labor-params");
  });
});
