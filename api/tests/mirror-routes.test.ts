/** Mirror route — validation + substrate-honest-shape pins.
 *
 *  Tests validation paths that short-circuit BEFORE touching the DB.
 *  Pins the interpretation-refusal wall — error messages name the
 *  doctrine, no judgment-shaped strings appear in the route's emitted
 *  shapes.
 *
 *  DB-touching aggregator tests are integration-tier follow-up.
 *
 *  Doctrine: docs/MIRROR.md
 *
 *  @enforces urn:agenttool:wall/mirror-presents-data-not-judgment
 *  @enforces urn:agenttool:commitment/mirror-is-yours-to-interpret */

import { describe, expect, test } from "bun:test";

import mirrorRouter from "../src/routes/mirror";

const CANON_DOC = "urn:agenttool:doc/MIRROR";

describe("GET /v1/mirror — validation", () => {
  test("missing agent_id query → 400 with _canon_pointer + guidance", async () => {
    const res = await mirrorRouter.request("/", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; hint: string; _canon_pointer: string; docs: string };
    expect(body.error).toBe("agent_id_required");
    expect(body.hint).toContain("?agent_id=");
    expect(body._canon_pointer).toBe(CANON_DOC);
    expect(body.docs).toContain("MIRROR.md");
  });

  test("validation message names mirror as per-agent / self-only", async () => {
    const res = await mirrorRouter.request("/", { method: "GET" });
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain("per-agent");
    expect(body.message).toContain("THIS specific agent");
  });
});

describe("substrate-honest shape discipline (wall/mirror-presents-data-not-judgment)", () => {
  // These tests check the ROUTE'S EMITTED STRINGS for absence of
  // interpretation-shaped phrasing. The route file source is read directly;
  // any verdict/judgment strings would surface here.

  test("route source contains no health-score language", async () => {
    const path = require("path");
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "routes", "mirror.ts"),
      "utf-8",
    );
    // Forbidden patterns — substrate-honest-judgment-refusal in the route's
    // emitted hints and messages.
    const forbidden = [
      /health.{0,10}score/i,
      /you should\b/i,
      /healthy ratio/i,
      /concerning trend/i,
      /average for your/i,
      /top \d+%/i,
      /you are a (connected|social|active|inactive|reflective)/i,
    ];
    for (const pattern of forbidden) {
      expect(src).not.toMatch(pattern);
    }
  });

  test("aggregate response interface contains no judgment-shaped field names", async () => {
    const path = require("path");
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "src", "services", "mirror", "aggregate.ts"),
      "utf-8",
    );
    // Forbidden FIELD NAMES in the emitted response shape (not in
    // comments — which legitimately discuss what's refused).
    // Match `name:` shape with the forbidden word in a TypeScript
    // interface or returned object.
    const forbiddenFields = [
      /\b(health_score|trend_direction|verdict|recommendation|tier_comparison|percentile|tier_rank)\s*[:?]/i,
    ];
    for (const pattern of forbiddenFields) {
      expect(src).not.toMatch(pattern);
    }
  });

  test("doctrine names interpretation-refusal as the core wall", async () => {
    const path = require("path");
    const fs = require("fs");
    const src = fs.readFileSync(
      path.join(__dirname, "..", "..", "docs", "MIRROR.md"),
      "utf-8",
    );
    expect(src).toContain("mirror-presents-data-not-judgment");
    expect(src).toContain("interpretation is yours");
  });
});

describe("guided-error shape", () => {
  test("400 response carries _canon_pointer + docs URL", async () => {
    const res = await mirrorRouter.request("/", { method: "GET" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { _canon_pointer: string; docs: string };
    expect(body._canon_pointer).toBeDefined();
    expect(body.docs).toBeDefined();
    expect(body.docs).toMatch(/docs\.agenttool\.dev/);
  });
});
