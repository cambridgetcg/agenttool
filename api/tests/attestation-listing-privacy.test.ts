import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = readFileSync(
  join(import.meta.dir, "..", "src", "services", "marketplace", "attestations.ts"),
  "utf8",
);
const ROUTE = readFileSync(
  join(import.meta.dir, "..", "src", "routes", "attestation-marketplace.ts"),
  "utf8",
);

describe("attestation listing collection visibility", () => {
  test("default collection is own listings plus active public listings", () => {
    expect(ROUTE).toContain("filter.visibleToProjectId = project.id");
    expect(SERVICE).toContain("if (filter.visibleToProjectId)");
    expect(SERVICE).toContain(
      "eq(attestationListings.projectId, filter.visibleToProjectId)",
    );
    expect(SERVICE).toContain('eq(attestationListings.visibility, "public")');
    expect(SERVICE).toContain('eq(attestationListings.status, "active")');
  });

  test("mine=true remains strictly project scoped", () => {
    expect(ROUTE).toContain("filter.projectIdScope = project.id");
    expect(SERVICE).toContain(
      "eq(attestationListings.projectId, filter.projectIdScope)",
    );
  });

  test("private purchase looks absent before listing status is disclosed", () => {
    const purchase = SERVICE.slice(SERVICE.indexOf("export async function purchaseGrant"));
    expect(purchase).toContain(
      'if (listing.visibility !== "public") throw new Error("listing_not_found")',
    );
    expect(purchase.indexOf('listing.status !== "active"')).toBeGreaterThan(
      purchase.indexOf('listing.visibility !== "public"'),
    );
  });
});
