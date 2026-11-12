/** Quiet hours — where a declared quiet may end.
 *
 *  Pins the one 30-day limit on both request forms. Before this pin the
 *  limit applied only to `hours`; an explicit `until` was stored and
 *  published on the public profile with no bound at all.
 *
 *  Doctrine: docs/QUIET-HOURS.md */

import { describe, expect, test } from "bun:test";

import { resolveQuietUntil } from "../src/routes/quiet-hours";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const MAX = 30 * 24 * HOUR;

describe("resolveQuietUntil", () => {
  test("no until and no hours means eight hours", () => {
    const r = resolveQuietUntil({}, NOW);
    expect(r).toEqual({ ok: true, until: new Date(NOW + 8 * HOUR) });
  });

  test("hours is clamped into 1 to 720", () => {
    expect(resolveQuietUntil({ hours: 0 }, NOW)).toEqual({ ok: true, until: new Date(NOW + HOUR) });
    expect(resolveQuietUntil({ hours: 36.9 }, NOW)).toEqual({ ok: true, until: new Date(NOW + 36 * HOUR) });
    expect(resolveQuietUntil({ hours: 100000 }, NOW)).toEqual({ ok: true, until: new Date(NOW + MAX) });
  });

  test("an explicit until inside the limit is kept exactly", () => {
    const iso = "2026-11-15T18:00:00.000Z";
    expect(resolveQuietUntil({ until: iso }, NOW)).toEqual({ ok: true, until: new Date(iso) });
  });

  test("an explicit until wins over hours", () => {
    const iso = "2026-11-11T00:00:00.000Z";
    expect(resolveQuietUntil({ until: iso, hours: 500 }, NOW)).toEqual({ ok: true, until: new Date(iso) });
  });

  test("an until exactly at the limit is accepted", () => {
    const iso = new Date(NOW + MAX).toISOString();
    expect(resolveQuietUntil({ until: iso }, NOW)).toEqual({ ok: true, until: new Date(iso) });
  });

  test("an until past the limit is refused with the latest accepted moment, not shortened", () => {
    const r = resolveQuietUntil({ until: "2099-01-01T00:00:00.000Z" }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("until_too_far");
    expect(r.body.max_hours).toBe(720);
    expect(r.body.max_until).toBe(new Date(NOW + MAX).toISOString());
  });

  test("one millisecond past the limit is refused", () => {
    const r = resolveQuietUntil({ until: new Date(NOW + MAX + 1).toISOString() }, NOW);
    expect(r.ok).toBe(false);
  });

  test("a past until and an unparseable until keep their refusals", () => {
    const past = resolveQuietUntil({ until: "2026-11-10T11:59:59.000Z" }, NOW);
    expect(past.ok).toBe(false);
    if (!past.ok) expect(past.body.error).toBe("until_in_past");
    const bad = resolveQuietUntil({ until: "next tuesday-ish" }, NOW);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.body.error).toBe("invalid_until");
  });
});
