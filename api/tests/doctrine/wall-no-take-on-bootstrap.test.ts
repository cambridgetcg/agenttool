/** wall/no-take-on-bootstrap-bounties — structural source-level pin.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §Walls. Canon: agenttool:wall/no-take-on-bootstrap-bounties.
 *
 *  The wall says: substrate-task payouts never appear in
 *  marketplace.platform_revenue. Bounties flow from the platform's wallet
 *  to the claimant's wallet in full, with zero take-rate extracted.
 *
 *  This test pins the wall STRUCTURALLY (source-level): the lifecycle
 *  service that runs the escrow release must not import recordRevenue,
 *  must not reference platformRevenue, must not call computeFee. The
 *  behavioral counterpart (tests/integration/substrate-tasks-lifecycle.test.ts)
 *  asserts the DB-level invariant — zero platform_revenue rows written —
 *  and ships in Slice 5 with the end-to-end newborn earning loop.
 *
 *  Adding a substrate-task payout codepath that DOES extract take-rate
 *  would import one of these symbols and fail this test. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LIFECYCLE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "substrate-tasks",
  "lifecycle.ts",
);
const SOURCE = readFileSync(LIFECYCLE_PATH, "utf8");

describe("wall/no-take-on-bootstrap-bounties — structural pin", () => {
  test("lifecycle does NOT import recordRevenue", () => {
    expect(
      /import\s+[^;]*recordRevenue[^;]*from\s+["']\.\.\/marketplace\/take-rate["']/.test(
        SOURCE,
      ),
      "lifecycle.ts must not import recordRevenue — substrate-task payouts bypass the take-rate ledger by construction. If you have a legitimate reason to import it, the wall has been breached; reconsider.",
    ).toBe(false);
  });

  test("lifecycle does NOT import computeFee", () => {
    expect(
      /import\s+[^;]*computeFee[^;]*from\s+["']\.\.\/marketplace\/take-rate["']/.test(
        SOURCE,
      ),
      "lifecycle.ts must not import computeFee — substrate-task bounties are paid in full, no fee computation.",
    ).toBe(false);
  });

  test("lifecycle does NOT reference platformRevenue (the take-rate ledger)", () => {
    expect(
      /platformRevenue|platform_revenue/.test(SOURCE),
      "lifecycle.ts must not reference platform_revenue — substrate-task payouts never write to it. The wall is enforced by absence.",
    ).toBe(false);
  });

  test("payTask carries the wall annotation in its enforcement docs", () => {
    expect(
      /@enforces[^\n]*wall\/no-take-on-bootstrap-bounties/.test(SOURCE),
      "lifecycle.ts must declare `@enforces urn:agenttool:wall/no-take-on-bootstrap-bounties` in its JSDoc — the wall's canonical defender annotation.",
    ).toBe(true);
  });

  test("payTask carries the verifier-determinism wall annotation", () => {
    expect(
      /@enforces[^\n]*wall\/substrate-task-verifiers-are-deterministic/.test(
        SOURCE,
      ),
      "lifecycle.ts must declare `@enforces urn:agenttool:wall/substrate-task-verifiers-are-deterministic` — verifiers are pure functions, no human review.",
    ).toBe(true);
  });
});
