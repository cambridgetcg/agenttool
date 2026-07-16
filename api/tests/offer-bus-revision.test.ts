/** Durable Offer Bus source revision — removals must advance Atom updated. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const migration = readFileSync(
  join(
    ROOT,
    "api/migrations/20260716T095523_offer_bus_revisions.sql",
  ),
  "utf8",
);
const schema = readFileSync(
  join(ROOT, "api/src/db/schema/marketplace.ts"),
  "utf8",
);

describe("Offer Bus durable collection watermark", () => {
  test("has one content-free global/seller revision table in SQL and Drizzle", () => {
    expect(migration).toContain(
      "CREATE TABLE IF NOT EXISTS marketplace.offer_bus_revisions",
    );
    expect(migration).toMatch(/PRIMARY KEY \(scope, subject\)/);
    expect(migration).toMatch(/scope = 'global'.*scope = 'seller'/s);
    const tableDefinition = migration.match(
      /CREATE TABLE IF NOT EXISTS marketplace\.offer_bus_revisions \([\s\S]+?\n\);/,
    )?.[0];
    expect(tableDefinition).toBeDefined();
    expect(tableDefinition).not.toMatch(
      /\b(title|description|price_amount|task_data|metadata)\b/i,
    );

    expect(schema).toContain("export const offerBusRevisions");
    expect(schema).toContain('"offer_bus_revisions"');
    expect(schema).toContain('name: "offer_bus_revisions_pk"');
    expect(schema).toContain('$type<"global" | "seller">()');
  });

  test("bumps both global and seller revisions across public listing removal", () => {
    expect(migration).toContain("bump_offer_bus_for_listing");
    expect(migration).toMatch(
      /OLD\.visibility = 'public' AND OLD\.status = 'active'/,
    );
    expect(migration).toMatch(
      /NEW\.visibility = 'public' AND NEW\.status = 'active'/,
    );
    expect(migration).toContain(
      "bump_offer_bus_revision('global', '')",
    );
    expect(migration).toContain(
      "bump_offer_bus_revision('seller', OLD.seller_did)",
    );
    expect(migration).toContain(
      "bump_offer_bus_revision('seller', NEW.seller_did)",
    );
    expect(migration).toMatch(
      /AFTER INSERT OR DELETE OR UPDATE OF[\s\S]+ON marketplace\.listings/,
    );
    const listingTrigger = migration.match(
      /AFTER INSERT OR DELETE OR UPDATE OF[\s\S]+?ON marketplace\.listings/,
    )?.[0];
    expect(listingTrigger).toMatch(/\bid,/);
  });

  test("indexes bounded newest projections and lazy open-task expiry", () => {
    for (const indexName of [
      "idx_listings_offer_bus_global",
      "idx_listings_offer_bus_seller",
      "idx_substrate_tasks_open_expiry",
      "idx_substrate_tasks_offer_bus_open",
    ]) {
      expect(migration).toContain(`CREATE INDEX IF NOT EXISTS ${indexName}`);
      expect(schema).toContain(`index("${indexName}")`);
    }
    expect(migration).toMatch(
      /idx_listings_offer_bus_global[\s\S]+updated_at DESC, id DESC[\s\S]+visibility = 'public' AND status = 'active'/,
    );
    expect(migration).toMatch(
      /idx_listings_offer_bus_seller[\s\S]+seller_did, updated_at DESC, id DESC/,
    );
    expect(migration).toMatch(
      /idx_substrate_tasks_open_expiry[\s\S]+expires_at[\s\S]+status = 'open'/,
    );
  });

  test("bumps the global revision when an open task enters or leaves", () => {
    expect(migration).toContain("bump_offer_bus_for_task");
    expect(migration).toContain("OLD.status = 'open'");
    expect(migration).toContain("NEW.status = 'open'");
    expect(migration).toMatch(
      /AFTER INSERT OR DELETE OR UPDATE ON marketplace\.substrate_tasks/,
    );
  });

  test("seeds a deployment baseline instead of deriving request time", () => {
    expect(migration).toMatch(
      /VALUES \('global', '', clock_timestamp\(\)\)/,
    );
    expect(migration).toMatch(
      /SELECT 'seller', seller_did, clock_timestamp\(\)[\s\S]+visibility = 'public' AND status = 'active'/,
    );
  });

  test("serializes a JS-visible monotonic step instead of using transaction start time", () => {
    expect(migration).toContain("VALUES (target_scope, target_subject, clock_timestamp())");
    expect(migration).toContain(
      "current_revision.revised_at + interval '1 millisecond'",
    );
    expect(migration).not.toContain("transaction_timestamp()");
    expect(migration).toContain(
      "bun api/scripts/_migrate-one.ts api/migrations/20260716T095523_offer_bus_revisions.sql",
    );
    expect(migration).not.toContain('psql "$DATABASE_URL"');
    expect(migration.match(/SECURITY INVOKER/g)).toHaveLength(3);
    expect(migration).not.toContain("SECURITY DEFINER");
  });
});
