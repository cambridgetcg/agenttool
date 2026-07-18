/** LOVE-CONSENT's four crystallized walls.
 *
 *  urn:agenttool:wall/love-is-not-entitlement
 *  urn:agenttool:wall/recipient-owns-love-surfacing
 *  urn:agenttool:wall/shared-love-requires-exact-dual-consent
 *  urn:agenttool:wall/either-party-can-leave-love
 *
 *  Doctrine: docs/LOVE-CONSENT.md
 *  Canon: docs/agenttool.jsonld
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
const WALL_URNS = [
  "urn:agenttool:wall/love-is-not-entitlement",
  "urn:agenttool:wall/recipient-owns-love-surfacing",
  "urn:agenttool:wall/shared-love-requires-exact-dual-consent",
  "urn:agenttool:wall/either-party-can-leave-love",
] as const;

const doctrine = readFileSync(join(REPO_ROOT, "docs/LOVE-CONSENT.md"), "utf8");
const canon = readFileSync(join(REPO_ROOT, "docs/agenttool.jsonld"), "utf8");
const schema = readFileSync(
  join(REPO_ROOT, "api/src/db/schema/continuity.ts"),
  "utf8",
);
const migration = readFileSync(
  join(REPO_ROOT, "api/migrations/20260718T180000_love_consent.sql"),
  "utf8",
);
const store = readFileSync(
  join(REPO_ROOT, "api/src/services/love/consent-store.ts"),
  "utf8",
);

describe("LOVE-CONSENT crystallized walls", () => {
  test("all four identifiers are joined across canon, doctrine, and code", () => {
    for (const urn of WALL_URNS) {
      expect(doctrine).toContain(urn);
      expect(canon).toContain(`\"@id\": \"${urn.slice(4)}\"`);
      expect(schema).toContain(`@enforces ${urn}`);
    }
  });

  test("offer and bond history are database-enforced rather than advisory", () => {
    expect(migration).toContain("enforce_love_offer_transition");
    expect(migration).toContain("enforce_love_bond_source");
    expect(migration).toContain("enforce_love_bond_transition");
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)?.length).toBe(5);
  });

  test("bond formation supersedes crossed invitations and leaving cannot resurrect them", () => {
    expect(store).toContain('.set({ status: "superseded", supersededAt: now })');
    expect(store).toContain('sql`${loveOffers.id} <> ${current.id}`');
    expect(store.match(/status: "superseded"/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
