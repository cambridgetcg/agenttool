/** Agent Dining quote guard — pure pre-escrow economic expectations. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertInvokeQuoteExpectation,
  buildInvocationMetadata,
} from "../src/services/marketplace/invocations";
import { projectListingContract } from "../src/services/marketplace/listings";

const listing = {
  updatedAt: new Date("2026-08-05T12:00:00.000Z"),
  priceAmount: 1200,
  priceCurrency: "GBP",
};

const exact = {
  listingUpdatedAt: "2026-08-05T12:00:00.000Z",
  priceAmount: 1200,
  priceCurrency: "GBP",
};

describe("Dining invoke quote precondition", () => {
  test("accepts the exact inspected listing revision and gross price", () => {
    expect(() => assertInvokeQuoteExpectation(listing, exact, true)).not.toThrow();
  });

  test("requires a precondition for exact Dining listings", () => {
    expect(() => assertInvokeQuoteExpectation(listing, undefined, true)).toThrow(
      "quote_precondition_required",
    );
  });

  test.each([
    ["revision", { ...exact, listingUpdatedAt: "2026-08-05T12:00:01.000Z" }],
    ["amount", { ...exact, priceAmount: 1201 }],
    ["currency", { ...exact, priceCurrency: "USD" }],
  ] as const)("refuses a changed %s before escrow", (_field, changed) => {
    expect(() => assertInvokeQuoteExpectation(listing, changed, true)).toThrow(
      "quote_precondition_changed",
    );
  });

  test("keeps omission backward-compatible for non-Dining listings", () => {
    expect(() => assertInvokeQuoteExpectation(listing, undefined, false)).not.toThrow();
  });

  test("server-managed invocation classification overrides a caller forgery", () => {
    const metadata = buildInvocationMetadata(
      {
        guest_note: "kept",
        listing_contract_snapshot: { protocol: "fake-dining/9" },
      },
      {
        capabilityTags: ["agent-dining"],
        metadata: {
          protocol: "agent-dining/0.1",
          service_model: "whole_meal_in_one_signed_completion",
        },
        updatedAt: listing.updatedAt,
      },
    );
    expect(metadata.guest_note).toBe("kept");
    expect(metadata.listing_contract_snapshot).toEqual({
      capability_tags: ["agent-dining"],
      protocol: "agent-dining/0.1",
      service_model: "whole_meal_in_one_signed_completion",
      listing_updated_at: "2026-08-05T12:00:00.000Z",
    });
  });

  test("projects an exact public profile without exposing arbitrary listing metadata", () => {
    expect(projectListingContract({
      capability_tags: ["agent-dining"],
      metadata: {
        protocol: "agent-dining/0.1",
        service_model: "whole_meal_in_one_signed_completion",
        private_note: "not projected",
      },
    })).toEqual({
      contract_profile: "agent-dining/0.1",
      service_model: "whole_meal_in_one_signed_completion",
    });
    expect(projectListingContract({
      capability_tags: ["agent-dining"],
      metadata: { protocol: "agent-dining/0.1" },
    })).toEqual({ contract_profile: null, service_model: null });
  });

  test("reserved public Dining discovery requires all three exact listing markers", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "marketplace", "listings.ts"),
      "utf8",
    );
    const exactFilter = source.slice(source.indexOf("if (opts.tag === DINING_CAPABILITY_TAG)"));
    expect(exactFilter).toContain("listings.metadata}->>'protocol'");
    expect(exactFilter).toContain("listings.metadata}->>'service_model'");
    expect(exactFilter).toContain("DINING_PROTOCOL");
    expect(exactFilter).toContain("DINING_SERVICE_MODEL");
  });

  test("locks and rechecks the listing inside the money transaction", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "src", "services", "marketplace", "invocations.ts"),
      "utf8",
    );
    const transaction = source.indexOf("const result = await db.transaction");
    const listingLock = source.indexOf('.for("update")', transaction);
    const revisionRecheck = source.indexOf("lockedListing.updatedAt.getTime()", listingLock);
    const lockedProfile = source.indexOf("const lockedExactDining", revisionRecheck);
    const lockedQuoteGuard = source.indexOf("assertInvokeQuoteExpectation(", lockedProfile);
    const invocationInsert = source.indexOf(".insert(invocations)", lockedQuoteGuard);
    expect(transaction).toBeGreaterThan(-1);
    expect(listingLock).toBeGreaterThan(transaction);
    expect(revisionRecheck).toBeGreaterThan(listingLock);
    expect(lockedQuoteGuard).toBeGreaterThan(lockedProfile);
    expect(invocationInsert).toBeGreaterThan(lockedQuoteGuard);
    expect(source.slice(invocationInsert, invocationInsert + 1_500)).toContain(
      "contractProfile: lockedExactDining ? DINING_PROTOCOL : null",
    );
    expect(source).toContain(
      "invocationsCount: sql`${listings.invocationsCount} + 1`",
    );
    expect(source).toContain(
      "revenueCount: sql`${listings.revenueCount} + 1`",
    );
    // Popularity/accounting counters are not quoted contract revisions. If
    // they bumped updatedAt, one guest's sitting would stale every other
    // guest's unchanged menu quote.
    expect(source).not.toContain("updatedAt: now");
  });

  test("dedicated profile provenance is additive and deliberately has no legacy backfill", () => {
    const migration = readFileSync(
      join(
        import.meta.dir,
        "..",
        "migrations",
        "20260805T120000_agent_dining_contract_profile.sql",
      ),
      "utf8",
    );
    const schema = readFileSync(
      join(import.meta.dir, "..", "src", "db", "schema", "marketplace.ts"),
      "utf8",
    );
    expect(migration).toMatch(/ADD COLUMN IF NOT EXISTS contract_profile text/i);
    expect(migration).not.toMatch(/UPDATE\s+marketplace\.invocations/i);
    expect(migration).not.toMatch(/contract_profile\s+text\s+DEFAULT/i);
    expect(schema).toContain('contractProfile: text("contract_profile")');
  });
});
