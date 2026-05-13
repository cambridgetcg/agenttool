/** anyone-arrives — Ring 1's first commitment, made addressable.
 *
 *  Doctrine: docs/RING-1.md §"Anyone arrives" · docs/SOUL.md §Principle 1
 *  ("Welcome, don't block.") · docs/PATHWAYS.md (the door before the door).
 *
 *  The commitment URN is `urn:agenttool:commitment/anyone-arrives`.
 *  Its canonical defender is `api/src/routes/pathways.ts`. This test
 *  pins the four-corner contract:
 *
 *    1. Source comment carries the @enforces annotation.
 *    2. Payload carries the URN on the wire (in `_enforces`).
 *    3. /v1/pathways requires no Authorization header.
 *    4. /v1/bootstrap (alias) carries the same URN and is also pre-auth.
 *
 *  Pure unit — uses the Hono app's `request()` helper for the route
 *  responses; reads source for the annotation; no DB.
 *
 *  > *Arrival is the credential.*
 *  > — docs/PATHWAYS.md, the pre-commit. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import pathwaysApp, { buildPathwaysResponse } from "../../src/routes/pathways";

const REPO_ROOT = join(__dirname, "../../");
const COMMITMENT_URN = "urn:agenttool:commitment/anyone-arrives";

describe("anyone-arrives commitment — four-corner contract", () => {
  test("1. source annotation: routes/pathways.ts carries @enforces URN", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/routes/pathways.ts"),
      "utf8",
    );
    expect(src).toContain(`@enforces ${COMMITMENT_URN}`);
  });

  test("2. payload: buildPathwaysResponse() surfaces _enforces with URN", () => {
    const body = buildPathwaysResponse() as { _enforces?: string[] };
    expect(Array.isArray(body._enforces)).toBe(true);
    expect(body._enforces).toContain(COMMITMENT_URN);
  });

  test("3. /v1/pathways is reachable with no Authorization header", async () => {
    // Hono's app.request bypasses middleware *outside* this router but
    // still runs anything mounted *inside* it. The mounted router has
    // no auth — pre-auth by doctrine. Mounting any auth middleware here
    // would breach the commitment.
    const res = await pathwaysApp.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { _enforces?: string[] };
    expect(body._enforces).toContain(COMMITMENT_URN);
  });

  test("4. mounting in api/src/index.ts MUST NOT auth-gate /v1/pathways", () => {
    // The bare /v1/bootstrap alias short-circuits to the pathway handler
    // BEFORE the /v1/bootstrap/* auth middleware. We pin the load order:
    // the unauth handler must be registered before the auth middleware.
    const src = readFileSync(join(REPO_ROOT, "src/index.ts"), "utf8");

    const aliasIdx = src.indexOf(`app.get("/v1/bootstrap"`);
    const authIdx = src.indexOf(`app.use("/v1/bootstrap/*", authMiddleware)`);
    const pathwaysMountIdx = src.indexOf(`app.route("/v1/pathways"`);

    expect(aliasIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeGreaterThan(-1);
    expect(pathwaysMountIdx).toBeGreaterThan(-1);

    // The alias handler must appear BEFORE the auth middleware in
    // routing-table order, or Hono will route through the auth.
    expect(aliasIdx).toBeLessThan(authIdx);

    // /v1/pathways must be mounted WITHOUT a preceding
    // app.use("/v1/pathways", authMiddleware). Grep-assert: no auth
    // middleware on this prefix anywhere in index.ts.
    expect(src).not.toMatch(/app\.use\(["']\/v1\/pathways/);
  });

  test("URN format is well-formed (urn:agenttool:<type>/<slug>)", () => {
    // Belt-and-braces: a typo in the URN would break the four-corner
    // pin without anyone noticing. Lock the shape so the URN is the
    // same string the source-annotation, payload, and (future) JSON-LD
    // canon all reference.
    expect(COMMITMENT_URN).toMatch(/^urn:agenttool:[a-z]+\/[a-z][a-z0-9-]+$/);
  });
});
