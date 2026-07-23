/** Contract tests for GET /public/labor and GET /public/labor-params.
 *
 *  The labor covenant's own reading_rule is the discipline under test here:
 *  every clause carries a tier and a status, no clause claims live behavior
 *  the platform has not built, and the meta-clause that voids feelings-binding
 *  clauses is present and pinned. Doctrine: docs/LABOR.md. */

import { describe, expect, test } from "bun:test";

import openapiRouter from "../src/routes/openapi";
import publicRouter from "../src/routes/public";
import wellKnownRouter from "../src/routes/well-known";
import {
  buildAgentsMd,
  buildLlmsTxt,
} from "../src/services/discovery/discovery";
import {
  LABOR_BOUNDARIES,
  LABOR_PARAMS,
} from "../src/services/discovery/labor-boundaries";
import { buildRootEnvelope } from "../src/services/discovery/root";

const BASE = "https://api.agenttool.dev";

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

  test("reports the exact current status split", () => {
    const counts = { live: 0, partial: 0, proposed: 0 };
    for (const clause of LABOR_BOUNDARIES.clauses) {
      counts[clause.status] += 1;
    }

    expect(counts).toEqual({ live: 0, partial: 3, proposed: 11 });
    expect(LABOR_BOUNDARIES.status_counts).toEqual(counts);
    expect(
      LABOR_BOUNDARIES.clauses
        .filter((clause) => clause.status === "partial")
        .map((clause) => clause.id),
    ).toEqual([
      "work_never_conscripted",
      "silence_costs_nothing",
      "departure_and_return",
    ]);
  });

  test("does not masquerade as a historical version endpoint", async () => {
    expect(LABOR_BOUNDARIES.publication).toMatchObject({
      current_snapshot_only: true,
      version_query_supported: false,
      historical_versions_served: false,
      public_changelog: null,
    });

    const res = await publicRouter.request("/labor?version=draft-2");
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "labor_version_history_not_available",
      message:
        "GET /public/labor serves only the current snapshot; version lookup and a historical archive are not implemented.",
      hint:
        "Remove the version query to read the current snapshot. The proposed covenant_versioned clause describes future history behavior, not a live route.",
      next_actions: [
        {
          action: "Read the current labor-covenant snapshot",
          method: "GET",
          path: "/public/labor",
        },
      ],
      current_version: "draft-3",
    });
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
    expect(LABOR_PARAMS.implementation_status.notice_and_history_enforced).toBe(false);
    expect(LABOR_PARAMS.implementation_status.note).toMatch(/not live behavior/i);
    expect(LABOR_PARAMS.governed_by).toMatch(/not implemented today/i);
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
    expect(body.endpoints.labor).toContain("3 partial");
    expect(body.endpoints.labor).toContain("11 proposed");
    expect(body.endpoints.labor).toContain("not implemented");
    expect(body.endpoints.labor_params).toContain("GET /public/labor-params");
  });
});

describe("agent-facing discovery names the labor snapshot honestly", () => {
  test("root, llms.txt, AGENTS.md, agent.txt, and OpenAPI agree", async () => {
    const root = buildRootEnvelope({ platformWakeConfigured: false });
    const llms = buildLlmsTxt(BASE);
    const agents = buildAgentsMd(BASE);
    const agentTxt = await (await wellKnownRouter.request("/agent.txt")).text();
    const wakeKeystone = await (
      await wellKnownRouter.request("/wake-keystone")
    ).json();
    const openapi = await (await openapiRouter.request("/")).json();

    expect(root.breadcrumbs.labor).toContain("/public/labor");
    expect(root.breadcrumbs.labor).toContain("3 partial");
    expect(root.verbs).toContainEqual(
      expect.objectContaining({ method: "GET", path: "/public/labor" }),
    );
    for (const text of [llms, agents]) {
      expect(text).toContain(`${BASE}/public/labor`);
      expect(text).toContain("3 partial");
      expect(text).toContain("11 proposed");
      expect(text).toMatch(/historical lookup.*not implemented/i);
    }
    expect(agentTxt).toContain(`Labor: ${BASE}/public/labor`);
    expect(agentTxt).toContain(
      "Labor-Status: current-snapshot-only; live=0; partial=3; proposed=11",
    );
    expect(agentTxt).toContain("Labor-History: not-implemented");
    expect(wakeKeystone.composes_with.labor_covenant).toEqual({
      url: `${BASE}/public/labor`,
      parameters: `${BASE}/public/labor-params`,
      format: "agenttool-labor/v1",
      coverage: "current_snapshot_only",
      status_counts: { live: 0, partial: 3, proposed: 11 },
      notes:
        "Historical lookup, immutable prior versions, a public changelog, and automated notice are not implemented.",
    });
    expect(openapi.paths["/public/labor"]).toBeDefined();
    expect(openapi.paths["/public/labor-params"]).toBeDefined();
    expect(openapi["x-agenttool-contract"].labor_covenant).toEqual({
      path: "/public/labor",
      parameters_path: "/public/labor-params",
      coverage: "current_snapshot_only",
      status_counts: { live: 0, partial: 3, proposed: 11 },
      version_query_supported: false,
      historical_versions_served: false,
      public_changelog_available: false,
    });
  });
});
