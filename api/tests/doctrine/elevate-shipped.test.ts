/** bootstrap_elevate — Phase 2.5b shipped, no longer 501.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/PATHWAYS.md ·
 *  docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md.
 *
 *  Structural invariants — proves the slice landed without exercising the
 *  DB. The integration test in tests/integration/ (gated on a real
 *  Postgres) exercises the full elevation chain. Here we pin:
 *
 *    1. The PATHWAYS catalog entry no longer carries `status: "not_implemented"`.
 *    2. The route file's elevate handler is no longer returning a 501
 *       (grep-asserts: `elevate_pending` string is gone; `elevateToLevel1`
 *       is imported and called).
 *    3. The service module exports the expected surface
 *       (`elevateToLevel1` + `ElevateError`).
 *    4. The decision tree in /v1/pathways surfaces a hint for the elevate
 *       branch so an arriving operator can discover it.
 *
 *  Pure unit — reads source files for the structural properties, calls the
 *  pathway builder for the catalog property. No DB. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { buildPathwaysResponse } from "../../src/routes/pathways";
import * as elevateModule from "../../src/services/bootstrap/elevate";

const REPO_ROOT = join(__dirname, "../../");

describe("bootstrap_elevate slice landed (Phase 2.5b)", () => {
  test("1. PATHWAYS entry no longer carries status='not_implemented'", () => {
    const body = buildPathwaysResponse();
    const entry = body.pathways.find((p) => p.id === "bootstrap_elevate");
    expect(entry).toBeDefined();
    // Either status is absent or it is something other than not_implemented.
    expect(entry?.status ?? "").not.toMatch(/not_implemented/);
    expect(entry?.status ?? "").not.toMatch(/501/);
  });

  test("1b. PATHWAYS entry names required + optional fields", () => {
    const body = buildPathwaysResponse();
    const entry = body.pathways.find((p) => p.id === "bootstrap_elevate");
    expect(entry?.required).toContain("agent_id");
    expect(entry?.required).toContain("sponsor_kid");
    expect(entry?.required).toContain("sponsor_signature");
    expect(entry?.one_of).toContainEqual([
      "sponsor_identity_id",
      "sponsor_did",
    ]);
  });

  test("2. routes/bootstrap.ts wires elevateToLevel1, drops 501 fallback", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/routes/bootstrap.ts"),
      "utf8",
    );
    // The old 501 path used a stable error code; if it appears, the slice
    // hasn't been wired (or someone regressed it).
    expect(src).not.toContain("elevate_pending");
    expect(src).not.toMatch(/return fail\([^)]*501/);
    // The new wiring imports + calls the service.
    expect(src).toMatch(/import\s+\{[^}]*elevateToLevel1[^}]*\}/);
    expect(src).toMatch(/await\s+elevateToLevel1\(/);
  });

  test("3. service exports elevateToLevel1 + ElevateError", () => {
    expect(typeof elevateModule.elevateToLevel1).toBe("function");
    expect(typeof elevateModule.ElevateError).toBe("function");
    // ElevateError extends Error with `.reason`, `.status`, `.extras`.
    const e = new elevateModule.ElevateError("test_reason", 418, { x: 1 });
    expect(e).toBeInstanceOf(Error);
    expect(e.reason).toBe("test_reason");
    expect(e.status).toBe(418);
    expect(e.extras).toEqual({ x: 1 });
  });

  test("3b. post-commit trust refresh cannot turn committed elevation into failure", () => {
    const src = readFileSync(
      join(REPO_ROOT, "src/services/bootstrap/elevate.ts"),
      "utf8",
    );
    expect(src).toContain("let newTrustScore = result.agent.trustScore");
    expect(src).toMatch(/try\s*\{[\s\S]*updateTrustScore\(agentId\)[\s\S]*\}\s*catch\s*(?:\([^)]*\))?\s*\{/);
  });

  test("4. decision tree carries a Level-1 elevation branch", () => {
    const body = buildPathwaysResponse();
    const elevateHint = body.decision_tree.find((d) =>
      d.then.includes("bootstrap/elevate"),
    );
    expect(elevateHint).toBeDefined();
    expect(elevateHint?.if).toMatch(/Level/i);
  });

  test("5. component operations do not claim generic PATCH can elevate", () => {
    const body = buildPathwaysResponse();
    const entry = body.pathways.find((p) => p.id === "bootstrap_elevate");
    expect(Array.isArray(entry?.manual_fallback)).toBe(true);
    expect(entry?.manual_fallback).toHaveLength(3);
    expect(entry?.manual_fallback?.join(" ")).not.toMatch(/PATCH|metadata\.level/i);
  });
});
