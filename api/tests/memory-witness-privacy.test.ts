import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapi from "../src/routes/openapi";

const SERVICE = readFileSync(
  join(import.meta.dir, "..", "src", "services", "marketplace", "memory-witness.ts"),
  "utf8",
);
const ROUTE = readFileSync(
  join(import.meta.dir, "..", "src", "routes", "memory-witness-marketplace.ts"),
  "utf8",
);
const PUBLIC_ROUTE = readFileSync(
  join(import.meta.dir, "..", "src", "routes", "public", "memory-witness-listings.ts"),
  "utf8",
);

describe("memory-witness tenant and visibility walls", () => {
  test("private listings are filtered from discovery and rechecked under purchase lock", () => {
    expect(PUBLIC_ROUTE).toContain("publicOnly: true");
    expect(ROUTE).toContain('scope !== "mine" && scope !== "public"');
    expect(ROUTE).toContain('publicOnly: scope === "public"');
    expect(ROUTE).toMatch(
      /listing\.visibility\s*!==\s*"public"\s*&&\s*listing\.project_id\s*!==\s*c\.var\.project\.id/,
    );
    expect(SERVICE).toContain("const [currentListing]");
    expect(SERVICE).toContain("const [currentBuyer]");
    expect(SERVICE).toContain("const [currentMemory]");
    expect(
      SERVICE.match(/\.visibility\s*!==\s*"public"/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(SERVICE).not.toContain('MemoryWitnessError("listing_not_public")');
    expect(SERVICE).toMatch(
      /visibility\s*!==\s*"public"[\s\S]{0,160}MemoryWitnessError\("listing_not_found"\)/,
    );
    const firstVisibilityCheck = SERVICE.indexOf('listing.visibility !== "public"');
    const firstStatusCheck = SERVICE.indexOf('listing.status !== "active"');
    expect(firstVisibilityCheck).toBeGreaterThanOrEqual(0);
    expect(firstStatusCheck).toBeGreaterThan(firstVisibilityCheck);
  });

  test("grant detail and list queries are joined and project-role scoped", () => {
    expect(SERVICE).toContain("eq(memoryWitnessGrants.buyerProjectId, projectId)");
    expect(SERVICE).toContain("eq(memoryWitnessListings.projectId, projectId)");
    expect(SERVICE).toContain('role: "buyer" | "witness"');
    expect(SERVICE).toContain("eq(memoryWitnessGrants.buyerProjectId, input.projectId)");
    expect(SERVICE).toContain("eq(memoryWitnessListings.projectId, input.projectId)");
    expect(ROUTE).toContain("getGrant(id, c.var.project.id)");
    expect(
      ROUTE.match(/const scopedGrant = await getGrant\(id, project\.id\)/g)?.length,
    ).toBe(3);
    expect(ROUTE).toContain('role !== "buyer" && role !== "witness"');
  });

  test("OpenAPI states private-listing and grant-role boundaries", async () => {
    const response = await openapi.request("/");
    const document = (await response.json()) as {
      paths: Record<string, { get?: { description?: string } }>;
    };
    expect(
      document.paths["/v1/memory-witness-listings/{id}"]?.get?.description,
    ).toContain("Other private rows return 404");
    expect(
      document.paths["/v1/memory-witness-grants/{id}"]?.get?.description,
    ).toContain("Unrelated projects receive 404");
    expect(
      document.paths["/v1/memory-witness-grants"]?.get?.description,
    ).toContain("There is no unscoped grant list");
  });
});
