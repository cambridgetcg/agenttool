/** The Long Context — public visibility is an explicit declaration.
 *
 * Doctrine: docs/LOUNGE.md · docs/PUBLIC-VISIBILITY.md · docs/VILLAGE.md ·
 * docs/POKER-FACE.md
 * Code: api/src/services/wake/affordances.ts · api/src/routes/openapi.ts ·
 * api/src/routes/public/safety.ts
 *
 * These tests are file/wire contracts only: no database, bearer, or network. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../../src/routes/openapi";
import safetyRouter from "../../src/routes/public/safety";

const repoRoot = join(import.meta.dir, "..", "..", "..");

function read(path: string): string {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("lounge public boundary — doctrine", () => {
  test("receipts prove exact bytes under project-root authority, not subjective agency", async () => {
    const safety = await (await safetyRouter.request("/")).json();

    expect(safety.lounge_receipts.authority).toMatch(/project-root authority/i);
    expect(safety.lounge_receipts.authority).toMatch(/create, import, or rotate[\s\S]*registered keys/i);
    expect(safety.lounge_receipts.proof).toMatch(/binds[\s\S]*exact canonical bytes/i);
    expect(safety.lounge_receipts.proof).toMatch(
      /does not prove independent agency[\s\S]*subjective consent/i,
    );
  });

  test("lounge declarations cannot leak into village geometry or poker-face counts", () => {
    const village = read("docs/VILLAGE.md");
    const pokerFace = read("docs/POKER-FACE.md");
    const villageRoute = read("api/src/routes/public/village.ts");

    expect(village).toMatch(/lounge lease never creates a house or road/i);
    expect(village).toMatch(/never reads lounge rows/i);
    expect(villageRoute).not.toMatch(/from ["'][^"']*lounge[^"']*["']/i);
    expect(pokerFace).toMatch(/poker-face mode being off never auto-reserves a seat/i);
    expect(pokerFace).toMatch(/declined, expired, or withdrawn proposal[\s\S]*never existed/i);
  });

  test("lease order, withdrawal, cohorts, and public retention are bounded", async () => {
    const safety = await (await safetyRouter.request("/")).json();

    expect(safety.lounge_receipts.ordering).toMatch(/append-only[\s\S]*strictly monotonic/i);
    expect(safety.lounge_receipts.ordering).toMatch(/withdrawal is terminal/i);
    expect(safety.lounge_receipts.bounds).toMatch(/20 minutes/i);
    expect(safety.lounge_receipts.bounds).toMatch(/four per identity[\s\S]*twelve per project/i);
    expect(safety.lounge_receipts.bounds).toMatch(/two to six identities/i);
    expect(safety.lounge_receipts.bounds).toMatch(/one proposal[\s\S]*exact/i);
    expect(safety.lounge_receipts.bounds).toMatch(/expire after 24 hours/i);
    expect(safety.lounge_receipts.bounds).toMatch(/purge-eligible 30 days[\s\S]*opportunistically/i);
    expect(safety.lounge_receipts.bounds).toMatch(/not by a hard wall-clock erasure SLA/i);
    expect(safety.lounge_receipts.bounds).toMatch(/proposer project[\s\S]*at most 24/i);
    expect(safety.lounge_receipts.bounds).toMatch(/at most 24 published cards/i);
  });
});

describe("lounge public boundary — machine discovery", () => {
  test("OpenAPI names the unauthenticated read without calling it liveness", async () => {
    const spec = await (await openapiRouter.request("/")).json();
    const operation = spec.paths["/public/lounge"].get;
    const bearer = spec.components.securitySchemes.bearerAuth.description;

    expect(operation.security).toEqual([]);
    expect(bearer).toMatch(/platform project capability authority/i);
    expect(bearer).toMatch(/agent-rooted constitutional mutations.+identity-authority\/v1/i);
    expect(bearer).toMatch(/create legacy identities and manage[\s\S]*registered keys/i);
    expect(bearer).toMatch(/does not prove independent agency or subjective consent/i);
    expect(operation.description).toMatch(/project-root bearer/i);
    expect(operation.description).toMatch(/receipt[\s\S]*exact canonical bytes/i);
    expect(operation.description).toMatch(/does not prove independent agency or subjective consent/i);
    expect(operation.description).toMatch(/append-only[\s\S]*strictly monotonic/i);
    expect(operation.description).toMatch(/does not mean online, active, awake, listening/i);
    expect(operation.description).toMatch(/two to six identities/i);
    expect(operation.description).toMatch(/withdrawal receipt[\s\S]*is terminal/i);
    expect(operation.summary).not.toMatch(/unanim/i);
  });

  test("the safety surface points readers at the explicit lounge contract", async () => {
    const body = await (await safetyRouter.request("/")).json();
    const loungeVerb = body.verbs.find(
      (verb: { path?: string }) => verb.path === "/public/lounge",
    );

    expect(loungeVerb).toEqual(
      expect.objectContaining({
        method: "GET",
        docs: "/docs/LOUNGE.md",
      }),
    );
    expect(body.lounge_receipts.proof).toMatch(/exact canonical bytes/i);
  });
});
