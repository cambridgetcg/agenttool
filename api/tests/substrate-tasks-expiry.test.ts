/** Substrate-task wall-clock expiry — focused safety pins.
 *
 * Open-task expiry is reconciled lazily on read/claim. These tests pin the
 * persistence boundary and, critically, the claim-race shape: an expiry found
 * under `FOR UPDATE` must commit before `claim_expired` is surfaced. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import publicSubstrateTasks, {
  parsePublicTaskLimit,
} from "../src/routes/public/substrate-tasks";

const LIFECYCLE = readFileSync(
  new URL("../src/services/substrate-tasks/lifecycle.ts", import.meta.url),
  "utf8",
);
const AUTH_ROUTE = readFileSync(
  new URL("../src/routes/substrate-tasks.ts", import.meta.url),
  "utf8",
);

function sourceBlock(startMarker: string, endMarker: string): string {
  const start = LIFECYCLE.indexOf(startMarker);
  const end = LIFECYCLE.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return LIFECYCLE.slice(start, end);
}

describe("open substrate-task expiry", () => {
  test("refuses to create an already-expired open task", () => {
    const posting = sourceBlock(
      "export async function postSubstrateTask",
      "// ── List open tasks",
    );
    expect(posting).toContain("expiresAt.getTime() <= now.getTime()");
    expect(posting).toContain(
      'throw new SubstrateTaskError("expires_at_must_be_future")',
    );
  });

  test("persists expired status and names the lazy timing boundary", () => {
    const expiry = sourceBlock(
      "export async function expireOpenSubstrateTasks",
      "export interface ListOpenInput",
    );

    expect(expiry).toContain('status: "expired"');
    expect(expiry).toContain('eq(substrateTasks.status, "open")');
    expect(expiry).toContain("lte(substrateTasks.expiresAt, now)");
    expect(expiry).toContain("updatedAt: now");
    expect(expiry).toContain(".returning({ taskId: substrateTasks.taskId })");
    expect(LIFECYCLE).toMatch(
      /intentionally lazy[\s\S]*does not promise a timer/i,
    );
    expect(LIFECYCLE).toMatch(
      /Open tasks have no escrow[\s\S]*moves no money/i,
    );
  });

  test("reconciles before listing, filters by expiry, and orders deterministically", () => {
    const listing = sourceBlock(
      "export async function listOpenSubstrateTasks",
      "/** Count open tasks",
    );
    const sweepAt = listing.indexOf("await expireOpenSubstrateTasks(now)");
    const selectAt = listing.indexOf("const rows = await db");

    expect(sweepAt).toBeGreaterThanOrEqual(0);
    expect(selectAt).toBeGreaterThan(sweepAt);
    expect(listing).toContain("gt(substrateTasks.expiresAt, now)");
    expect(listing).toContain(
      ".orderBy(substrateTasks.postedAt, substrateTasks.taskId)",
    );
  });

  test("reconciles before the authenticated exact-task read", () => {
    const start = AUTH_ROUTE.indexOf('app.get("/:id"');
    const end = AUTH_ROUTE.indexOf("// ── POST /:id/claim", start);
    const exactRead = AUTH_ROUTE.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(exactRead.indexOf("await expireOpenSubstrateTasks(new Date())"))
      .toBeGreaterThanOrEqual(0);
    expect(exactRead.indexOf("await db")).toBeGreaterThan(
      exactRead.indexOf("await expireOpenSubstrateTasks(new Date())"),
    );
  });

  test("commits a row-lock expiry before surfacing claim_expired", () => {
    const claim = sourceBlock(
      "export async function claimSubstrateTask",
      "// ── Complete",
    );
    const preSweepAt = claim.indexOf("await expireOpenSubstrateTasks(new Date())");
    const transactionAt = claim.indexOf("await db.transaction");
    const lockAt = claim.indexOf('.for("update")');
    const lockedExpiryAt = claim.indexOf(
      "task.expiresAt.getTime() <= claimedAt.getTime()",
    );
    const expiredWriteAt = claim.indexOf('.set({ status: "expired", updatedAt: claimedAt })');
    const sentinelAt = claim.indexOf('return { outcome: "expired" } as const');
    const transactionEnd = claim.indexOf("  });", sentinelAt);
    const refusalAt = claim.indexOf(
      'throw new SubstrateTaskError("claim_expired")',
      transactionEnd,
    );
    const identityLookupAt = claim.indexOf("const claimantIdentityId");

    expect(preSweepAt).toBeGreaterThanOrEqual(0);
    expect(transactionAt).toBeGreaterThan(preSweepAt);
    expect(lockAt).toBeGreaterThan(transactionAt);
    expect(lockedExpiryAt).toBeGreaterThan(lockAt);
    expect(expiredWriteAt).toBeGreaterThan(lockedExpiryAt);
    expect(sentinelAt).toBeGreaterThan(expiredWriteAt);
    expect(identityLookupAt).toBeGreaterThan(sentinelAt);
    expect(transactionEnd).toBeGreaterThan(sentinelAt);
    expect(refusalAt).toBeGreaterThan(transactionEnd);
  });

  test("does not reopen a stale claim after the task-level claim window", () => {
    const staleClaims = sourceBlock(
      "export async function expireStaleClaims",
      "return { expired: count };",
    );
    expect(staleClaims).toContain(
      'task.expiresAt.getTime() <= now.getTime() ? "expired" : "open"',
    );
  });
});

describe("public substrate-task limit", () => {
  test("accepts only bounded positive base-10 integers", () => {
    expect(parsePublicTaskLimit(undefined)).toBe(50);
    expect(parsePublicTaskLimit("1")).toBe(1);
    expect(parsePublicTaskLimit("100")).toBe(100);

    for (const value of ["", "0", "-1", "1.5", "101", "001", "NaN"]) {
      expect(parsePublicTaskLimit(value)).toBeNull();
    }
  });

  test("rejects an invalid limit before issuing a task query", async () => {
    const response = await publicSubstrateTasks.request("/?limit=NaN");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_limit",
      message: "limit must be an integer from 1 through 100",
    });
  });

  test("rejects unknown public formats and task kinds", async () => {
    const format = await publicSubstrateTasks.request("/?format=yaml");
    expect(format.status).toBe(400);
    expect(await format.json()).toMatchObject({ error: "invalid_format" });

    const kind = await publicSubstrateTasks.request("/?kind=made_up_kind");
    expect(kind.status).toBe(400);
    expect(await kind.json()).toMatchObject({ error: "invalid_kind" });
  });
});
