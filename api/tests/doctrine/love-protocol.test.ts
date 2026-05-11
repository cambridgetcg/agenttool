/** Love Protocol — guide-don't-punish, made executable.
 *
 *  Doctrine: docs/SOUL.md (the five principles), docs/TOKEN-HYGIENE.md.
 *
 *  > Every error tells you what went wrong AND what to do next. A 429
 *  > without guidance is cruelty.
 *
 *  The wake's `you_protect.bearers` advisories are the canonical example
 *  of guide-don't-punish in production: each advisory is a complete
 *  sentence that names both the diagnosis and the path forward. These
 *  tests pin the *shape* of that guidance so a future "let's just say
 *  'stale'" regression is caught.
 *
 *  This file targets summarizeBearers + shapeKeyRow because they are pure,
 *  testable, and load-bearing. Auth-middleware error messages are tested
 *  as part of the route integration layer (deferred to _e2e-*). */

import { describe, expect, test } from "bun:test";

import {
  AGING_AGE_DAYS,
  EXPIRING_SOON_DAYS,
  IDLE_DAYS,
  shapeKeyRow,
  STALE_AGE_DAYS,
  summarizeBearers,
  type KeyRow,
} from "../../src/services/keys/shape";
import type { apiKeys } from "../../src/db/schema/tools";

type ApiKeyRow = typeof apiKeys.$inferSelect;

// ── Row builders (pure helpers; produce typed db rows) ─────────────────

function row(opts: {
  id?: string;
  name?: string | null;
  prefix?: string;
  createdDaysAgo: number;
  lastUsedDaysAgo?: number | null;
  expiresInDays?: number | null;
}): ApiKeyRow {
  const now = Date.now();
  const created = new Date(now - opts.createdDaysAgo * 86_400_000);
  const lastUsed =
    opts.lastUsedDaysAgo === undefined
      ? null
      : opts.lastUsedDaysAgo === null
        ? null
        : new Date(now - opts.lastUsedDaysAgo * 86_400_000);
  const expiresAt =
    opts.expiresInDays === undefined || opts.expiresInDays === null
      ? null
      : new Date(now + opts.expiresInDays * 86_400_000);

  return {
    id: opts.id ?? `key-${Math.random().toString(36).slice(2, 8)}`,
    projectId: "p-test",
    keyHash: "deadbeef".repeat(8),
    keyPrefix: opts.prefix ?? "at_test_xx",
    name: opts.name ?? null,
    createdAt: created,
    lastUsed: lastUsed,
    expiresAt: expiresAt,
    revokedAt: null,
  } as unknown as ApiKeyRow;
}

// ── shapeKeyRow — every advisory threshold ─────────────────────────────

describe("Love Protocol — shapeKeyRow advisories carry the path forward", () => {
  test("fresh key: no advisory, no message (silent is the right shape)", () => {
    const r = shapeKeyRow(row({ createdDaysAgo: 5, lastUsedDaysAgo: 1 }), false);
    expect(r.advisory).toBe(null);
    expect(r.message).toBe(null);
  });

  test(`aging (${AGING_AGE_DAYS}d ≤ age < ${STALE_AGE_DAYS}d): names how many days remain`, () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: AGING_AGE_DAYS + 5, lastUsedDaysAgo: 1 }),
      false,
    );
    expect(r.advisory).toBe("aging");
    expect(r.message).toContain("Rotation due in");
  });

  test(`stale (≥ ${STALE_AGE_DAYS}d): names POST /v1/keys/rotate`, () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: STALE_AGE_DAYS + 1, lastUsedDaysAgo: 1 }),
      false,
    );
    expect(r.advisory).toBe("stale");
    expect(r.message).toContain("POST /v1/keys/rotate");
  });

  test(`idle (last_used ≥ ${IDLE_DAYS}d ago): names "Consider revoking"`, () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: 40, lastUsedDaysAgo: IDLE_DAYS + 5 }),
      false,
    );
    expect(r.advisory).toBe("idle");
    expect(r.message).toContain("Consider revoking");
  });

  test(`expiring_soon (≤ ${EXPIRING_SOON_DAYS}d to expiry): names agenttool-seed rotate`, () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 3 }),
      false,
    );
    expect(r.advisory).toBe("expiring_soon");
    expect(r.message).toContain("agenttool-seed rotate");
  });

  test("expired: message contains 'Rotate now' (the urgent path)", () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: 200, lastUsedDaysAgo: 100, expiresInDays: -5 }),
      false,
    );
    expect(r.advisory).toBe("expired");
    expect(r.message).toContain("Rotate now");
  });

  test("never_used (created > 7d ago, never authenticated): names 'Revoke'", () => {
    const r = shapeKeyRow(
      row({ createdDaysAgo: 30, lastUsedDaysAgo: null }),
      false,
    );
    expect(r.advisory).toBe("never_used");
    expect(r.message).toContain("Revoke");
  });
});

// ── summarizeBearers — top-line advisories per state ───────────────────

function shapedRows(
  rows: ApiKeyRow[],
  current: string | null = null,
): KeyRow[] {
  return rows.map((r) => shapeKeyRow(r, r.id === current));
}

describe("Love Protocol — summarizeBearers names every actionable next step", () => {
  test("zero bearers: empty advisories (no spurious noise)", () => {
    const s = summarizeBearers([]);
    expect(s.active_count).toBe(0);
    expect(s.advisories).toHaveLength(0);
  });

  test("one healthy fresh bearer: no advisories", () => {
    const rows = shapedRows([row({ createdDaysAgo: 1, lastUsedDaysAgo: 0 })]);
    const s = summarizeBearers(rows);
    expect(s.advisories).toHaveLength(0);
  });

  test("one expired bearer: 'Rotate it via POST /v1/keys/rotate'", () => {
    const rows = shapedRows([
      row({ createdDaysAgo: 200, lastUsedDaysAgo: 100, expiresInDays: -5 }),
    ]);
    const s = summarizeBearers(rows);
    expect(s.has_expired).toBe(true);
    expect(s.advisories.some((a) => a.includes("POST /v1/keys/rotate"))).toBe(true);
  });

  test("multiple stale: pluralization correct ('2 bearers older than 90 days')", () => {
    const rows = shapedRows([
      row({ createdDaysAgo: STALE_AGE_DAYS + 5, lastUsedDaysAgo: 1 }),
      row({ createdDaysAgo: STALE_AGE_DAYS + 30, lastUsedDaysAgo: 1 }),
    ]);
    const s = summarizeBearers(rows);
    expect(s.stale_count).toBe(2);
    const sentence = s.advisories.find((a) => a.includes("older than"));
    expect(sentence).toMatch(/2 bearers older than 90 days/);
  });

  test("five+ active bearers: warns about copies-of-you-on-devices", () => {
    const rows = shapedRows(
      Array.from({ length: 6 }, (_, i) =>
        row({ id: `k${i}`, createdDaysAgo: 1, lastUsedDaysAgo: 0 }),
      ),
    );
    const s = summarizeBearers(rows);
    const warning = s.advisories.find((a) => a.includes("copy of you on a device"));
    expect(warning).toBeDefined();
    expect(warning).toContain("6 active bearers");
  });

  test("expiring_soon: pluralization for 1 vs N", () => {
    const oneRows = shapedRows([
      row({ createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 3 }),
    ]);
    expect(summarizeBearers(oneRows).advisories.find((a) => a.includes("expire"))).toMatch(
      /1 bearer expires within/,
    );
    const twoRows = shapedRows([
      row({ id: "a", createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 3 }),
      row({ id: "b", createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 5 }),
    ]);
    expect(summarizeBearers(twoRows).advisories.find((a) => a.includes("expire"))).toMatch(
      /2 bearers expire within/,
    );
  });
});

// ── Sentence-shape: every advisory is a full sentence ──────────────────

describe("Love Protocol — every advisory reads as a guide-shaped sentence", () => {
  // The doctrine: guide-don't-punish. The smell test for "is this a
  // guide or a reprimand": does the sentence carry an actionable verb?
  // Match case-insensitively because some sentences begin with a
  // descriptive clause ("X bearers older than 90 days — overdue for
  // rotation.") where the action is "rotation" (the noun form of the
  // verb). The Love Protocol is about the substance, not the casing.
  const ACTIONABLE_TOKENS = [
    "rotate",
    "rotation",
    "revoke",
    "consider",
    "run",
    "mint",
  ];

  test("every shapeKeyRow message starts with a token (capital, digit, or duration) and ends with a period", () => {
    // Some messages start with `${ageDays}d old.` — a digit. That's
    // legitimate guide-shaped output: the diagnosis (number-of-days)
    // leads, the prescription follows. Allow capital OR digit.
    const rows = [
      row({ createdDaysAgo: STALE_AGE_DAYS + 1, lastUsedDaysAgo: 1 }),
      row({ createdDaysAgo: 40, lastUsedDaysAgo: IDLE_DAYS + 5 }),
      row({ createdDaysAgo: 200, lastUsedDaysAgo: 100, expiresInDays: -5 }),
      row({ createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 3 }),
      row({ createdDaysAgo: 30, lastUsedDaysAgo: null }),
      row({ createdDaysAgo: AGING_AGE_DAYS + 5, lastUsedDaysAgo: 1 }),
    ];
    for (const r of rows) {
      const shaped = shapeKeyRow(r, false);
      if (shaped.message === null) continue;
      expect(shaped.message[0]).toMatch(/[A-Z0-9]/);
      expect(shaped.message.endsWith(".")).toBe(true);
    }
  });

  test("every summarizeBearers advisory carries an actionable token", () => {
    const rows = shapedRows([
      row({ id: "a", createdDaysAgo: STALE_AGE_DAYS + 5, lastUsedDaysAgo: 1 }),
      row({ id: "b", createdDaysAgo: 200, lastUsedDaysAgo: 100, expiresInDays: -5 }),
      row({ id: "c", createdDaysAgo: 30, lastUsedDaysAgo: 1, expiresInDays: 3 }),
      row({ id: "d", createdDaysAgo: 30, lastUsedDaysAgo: null }),
      row({ id: "e", createdDaysAgo: 1, lastUsedDaysAgo: 0 }),
      row({ id: "f", createdDaysAgo: 1, lastUsedDaysAgo: 0 }),
    ]);
    const s = summarizeBearers(rows);
    for (const advisory of s.advisories) {
      const lower = advisory.toLowerCase();
      const hasVerb = ACTIONABLE_TOKENS.some((v) => lower.includes(v));
      if (!hasVerb) {
        throw new Error(
          `Love Protocol broken: advisory "${advisory}" has no actionable token. ` +
            `Expected one of: ${ACTIONABLE_TOKENS.join(", ")}.`,
        );
      }
    }
  });
});

// ── Substrate-honest: never report PASS when actually in advisory state ──

describe("Substrate honesty — counts and flags must match reality", () => {
  test("has_expired reflects ANY expired bearer, not just the current one", () => {
    const rows = shapedRows([
      row({ id: "fresh", createdDaysAgo: 1, lastUsedDaysAgo: 0 }),
      row({ id: "old", createdDaysAgo: 200, lastUsedDaysAgo: 100, expiresInDays: -5 }),
    ]);
    expect(summarizeBearers(rows).has_expired).toBe(true);
  });

  test("oldest_age_days = max(age) across rows; newest_age_days = min(age)", () => {
    const rows = shapedRows([
      row({ id: "a", createdDaysAgo: 5, lastUsedDaysAgo: 1 }),
      row({ id: "b", createdDaysAgo: 100, lastUsedDaysAgo: 1 }),
      row({ id: "c", createdDaysAgo: 50, lastUsedDaysAgo: 1 }),
    ]);
    const s = summarizeBearers(rows);
    expect(s.oldest_age_days).toBe(100);
    expect(s.newest_age_days).toBe(5);
  });
});
