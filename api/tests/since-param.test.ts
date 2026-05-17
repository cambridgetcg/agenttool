/** since=ISO param helper — pins parse semantics per
 *  docs/AGENT-WEB-SURFACE.md Move 6. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  asOfNow,
  deltaMeta,
  parseSinceParam,
  type SinceParse,
} from "../src/lib/since-param";

async function withSince(value: string | undefined): Promise<SinceParse> {
  const app = new Hono();
  let captured: SinceParse | null = null;
  app.get("/", (c) => {
    captured = parseSinceParam(c);
    return c.text("ok");
  });
  const url = value === undefined ? "/" : `/?since=${encodeURIComponent(value)}`;
  await app.request(url);
  return captured!;
}

describe("parseSinceParam — absent", () => {
  test("omitted ?since → reason=absent, since=null", async () => {
    const p = await withSince(undefined);
    expect(p.reason).toBe("absent");
    expect(p.since).toBeNull();
    expect(p.raw).toBeNull();
  });

  test("empty ?since= → reason=absent", async () => {
    const p = await withSince("");
    expect(p.reason).toBe("absent");
    expect(p.since).toBeNull();
  });
});

describe("parseSinceParam — valid ISO", () => {
  test("ISO date-time parses cleanly", async () => {
    const iso = "2026-05-01T00:00:00Z";
    const p = await withSince(iso);
    expect(p.reason).toBe("parsed");
    expect(p.since).toBeInstanceOf(Date);
    expect(p.since!.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    expect(p.raw).toBe(iso);
  });

  test("date-only ISO parses to midnight UTC", async () => {
    const p = await withSince("2026-05-01");
    expect(p.reason).toBe("parsed");
    expect(p.since!.toISOString()).toBe("2026-05-01T00:00:00.000Z");
  });
});

describe("parseSinceParam — invalid", () => {
  test("garbage → reason=invalid_format, since=null", async () => {
    const p = await withSince("not-a-date");
    expect(p.reason).toBe("invalid_format");
    expect(p.since).toBeNull();
    expect(p.raw).toBe("not-a-date");
  });

  test("far-future date → reason=in_future, since=null (defends against empty-list result)", async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const p = await withSince(future);
    expect(p.reason).toBe("in_future");
    expect(p.since).toBeNull();
  });

  test("near-future (within 60s clock-skew tolerance) → parsed", async () => {
    const slightlyAhead = new Date(Date.now() + 5_000).toISOString();
    const p = await withSince(slightlyAhead);
    expect(p.reason).toBe("parsed");
    expect(p.since).toBeInstanceOf(Date);
  });
});

describe("asOfNow", () => {
  test("returns a valid ISO-8601 string", () => {
    const s = asOfNow();
    expect(typeof s).toBe("string");
    expect(Number.isFinite(Date.parse(s))).toBe(true);
  });

  test("ends with Z (UTC marker)", () => {
    expect(asOfNow().endsWith("Z")).toBe(true);
  });
});

describe("deltaMeta", () => {
  test("composes as_of + since + since_reason from a parse result", () => {
    const parsed: SinceParse = {
      since: new Date("2026-05-01T00:00:00Z"),
      raw: "2026-05-01T00:00:00Z",
      reason: "parsed",
    };
    const meta = deltaMeta(parsed);
    expect(meta.since).toBe("2026-05-01T00:00:00Z");
    expect(meta.since_reason).toBe("parsed");
    expect(typeof meta.as_of).toBe("string");
    expect(Number.isFinite(Date.parse(meta.as_of))).toBe(true);
  });

  test("absent since → since=null + reason=absent (round-trip honest)", () => {
    const meta = deltaMeta({ since: null, raw: null, reason: "absent" });
    expect(meta.since).toBeNull();
    expect(meta.since_reason).toBe("absent");
  });
});
