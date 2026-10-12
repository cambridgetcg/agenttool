/** Pure keyset-cursor contract for continuity walks.
 *  Doctrine: docs/AGENT-WEB-SURFACE.md (continuity walks). */

import { describe, expect, test } from "bun:test";
import { PgDialect } from "drizzle-orm/pg-core";

import { memories } from "../src/db/schema/memory";
import {
  CURSOR_INVALID_HINT,
  KEYSET_CURSOR_MAX_CHARS,
  KeysetRequestError,
  cursorTimestampSql,
  decodeCursor,
  digestPart,
  encodeCursor,
  filterDigest,
  isMicrosecondUtcTimestamp,
  keysetBeforeSql,
  pageFromRows,
  parsePageLimit,
  type KeysetScope,
} from "../src/lib/keyset-cursor";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const T = "2026-10-11T09:15:02.123456Z";
const DIGEST = filterDigest(["memories", "created_at_desc,id_desc", null, null, null, null, null, null]);

function expectCode(fn: () => unknown, code: string): KeysetRequestError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(KeysetRequestError);
    expect((error as KeysetRequestError).code).toBe(code as never);
    expect((error as KeysetRequestError).status).toBe(400);
    return error as KeysetRequestError;
  }
  throw new Error(`expected ${code}`);
}

function rawCursor(object: unknown): string {
  return Buffer.from(JSON.stringify(object), "utf8").toString("base64url");
}

describe("cursor encoding", () => {
  test("round-trips scope, digest, microsecond timestamp and id", () => {
    const raw = encodeCursor({ scope: "memories", digest: DIGEST, position: { t: T, i: ID } });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(raw.length).toBeLessThanOrEqual(KEYSET_CURSOR_MAX_CHARS);
    expect(JSON.parse(Buffer.from(raw, "base64url").toString("utf8"))).toEqual({
      v: 1, s: "memories", f: DIGEST, t: T, i: ID,
    });
    expect(decodeCursor(raw, { scope: "memories", digest: DIGEST })).toEqual({ t: T, i: ID });
  });

  test("microseconds survive exactly (no JS Date in the path)", () => {
    for (const t of [
      "2026-10-11T09:15:02.123456Z",
      "2026-10-11T09:15:02.123999Z",
      "2026-10-11T09:15:02.000001Z",
      "0001-01-01T00:00:00.000000Z",
      "9999-12-31T23:59:59.999999Z",
    ]) {
      const raw = encodeCursor({ scope: "chronicle", digest: DIGEST, position: { t, i: ID } });
      expect(decodeCursor(raw, { scope: "chronicle", digest: DIGEST }).t).toBe(t);
    }
  });

  test("wrong version, wrong scope and filter digest mismatch are cursor_invalid", () => {
    const raw = encodeCursor({ scope: "memories", digest: DIGEST, position: { t: T, i: ID } });
    const scoped = expectCode(() => decodeCursor(raw, { scope: "memories.key", digest: DIGEST }), "cursor_invalid");
    expect(scoped.hint).toBe(CURSOR_INVALID_HINT);
    expectCode(() => decodeCursor(raw, { scope: "memories", digest: "0123456789abcdef" }), "cursor_invalid");
    expectCode(
      () => decodeCursor(rawCursor({ v: 2, s: "memories", f: DIGEST, t: T, i: ID }), { scope: "memories", digest: DIGEST }),
      "cursor_invalid",
    );
    expectCode(
      () => decodeCursor(rawCursor({ v: 1, s: "inbox", f: DIGEST, t: T, i: ID }), { scope: "memories", digest: DIGEST }),
      "cursor_invalid",
    );
  });

  test("oversize, non-base64url, non-JSON, extra fields and non-canonical spellings are rejected", () => {
    const expected = { scope: "memories" as KeysetScope, digest: DIGEST };
    expectCode(() => decodeCursor("", expected), "cursor_invalid");
    expectCode(() => decodeCursor("A".repeat(KEYSET_CURSOR_MAX_CHARS + 1), expected), "cursor_invalid");
    expectCode(() => decodeCursor("abc+/=", expected), "cursor_invalid");
    expectCode(() => decodeCursor("bm90LWpzb24", expected), "cursor_invalid");
    expectCode(() => decodeCursor(rawCursor([1, 2]), expected), "cursor_invalid");
    expectCode(
      () => decodeCursor(rawCursor({ v: 1, s: "memories", f: DIGEST, t: T, i: ID, x: 1 }), expected),
      "cursor_invalid",
    );
    // Same fields in another key order: a different spelling of one position.
    expectCode(
      () => decodeCursor(rawCursor({ i: ID, t: T, f: DIGEST, s: "memories", v: 1 }), expected),
      "cursor_invalid",
    );
  });

  test("bad timestamps and ids are rejected", () => {
    const expected = { scope: "memories" as KeysetScope, digest: DIGEST };
    for (const t of [
      "2026-10-11T09:15:02.123Z", // milliseconds only
      "2026-10-11T09:15:02.1234567Z",
      "2026-10-11 09:15:02.123456Z",
      "2026-10-11T09:15:02.123456+00:00",
      "2026-02-30T00:00:00.000000Z",
      "0000-01-01T00:00:00.000000Z",
      "not-a-time",
    ]) {
      expect(isMicrosecondUtcTimestamp(t), t).toBe(false);
      expectCode(() => decodeCursor(rawCursor({ v: 1, s: "memories", f: DIGEST, t, i: ID }), expected), "cursor_invalid");
    }
    for (const i of ["not-a-uuid", ID.toUpperCase(), `${ID}0`, ""]) {
      expectCode(() => decodeCursor(rawCursor({ v: 1, s: "memories", f: DIGEST, t: T, i }), expected), "cursor_invalid");
    }
    expect(() => encodeCursor({ scope: "memories", digest: DIGEST, position: { t: "2026-10-11T09:15:02.123Z", i: ID } }))
      .toThrow();
  });
});

describe("filter digest", () => {
  test("binds every part in position and normalizes absent filters", () => {
    expect(DIGEST).toMatch(/^[0-9a-f]{16}$/);
    const base = ["memories", "created_at_desc,id_desc", null, null, null, null, null, null];
    const withSince = [...base.slice(0, 7), "2026-10-01T00:00:00.000Z"];
    const withAgent = ["memories", "created_at_desc,id_desc", "agent", null, null, null, null, null];
    const shifted = ["memories", "created_at_desc,id_desc", null, "agent", null, null, null, null];
    expect(new Set([
      filterDigest(base), filterDigest(withSince), filterDigest(withAgent), filterDigest(shifted),
    ]).size).toBe(4);
    expect(filterDigest(base)).toBe(DIGEST);
    expect(digestPart(undefined)).toBeNull();
    expect(digestPart(null)).toBeNull();
    expect(digestPart("")).toBeNull();
    expect(digestPart("x")).toBe("x");
  });
});

describe("limit floor (decision D1) and strict cursor limits", () => {
  const memoriesLimit = (raw: string | undefined, strict = false) =>
    parsePageLimit(raw, { def: 20, max: 100, strict, parse: "int" });
  const chronicleLimit = (raw: string | undefined, strict = false) =>
    parsePageLimit(raw, { def: 50, max: 200, strict, parse: "number" });

  test("memories and strands: -1 and 0 refuse; NaN, junk suffix and above-max keep today's values", () => {
    expectCode(() => memoriesLimit("-1"), "limit_invalid");
    expectCode(() => memoriesLimit("0"), "limit_invalid");
    expect(memoriesLimit("abc")).toBe(20);
    expect(memoriesLimit("20abc")).toBe(20);
    expect(memoriesLimit("500")).toBe(100);
    expect(memoriesLimit(undefined)).toBe(20);
    expect(memoriesLimit("")).toBe(20);
    expect(memoriesLimit("  ")).toBe(20);
    expect(memoriesLimit("7")).toBe(7);
    expect(memoriesLimit("1.9")).toBe(1);
    const strandsLimit = (raw: string) => parsePageLimit(raw, { def: 50, max: 200, strict: false, parse: "int" });
    expectCode(() => strandsLimit("-1"), "limit_invalid");
    expectCode(() => strandsLimit("0"), "limit_invalid");
    expect(strandsLimit("abc")).toBe(50);
    expect(strandsLimit("999")).toBe(200);
  });

  test("chronicle: abc reads the default, -1 and 0 refuse, above-max clamps", () => {
    expect(chronicleLimit("abc")).toBe(50);
    expectCode(() => chronicleLimit("-1"), "limit_invalid");
    expectCode(() => chronicleLimit("0"), "limit_invalid");
    // Number("") and Number("  ") are 0; empty reads the default like
    // memories and strands (parseInt NaN) instead of refusing.
    expect(chronicleLimit("")).toBe(50);
    expect(chronicleLimit("  ")).toBe(50);
    expect(chronicleLimit(" 7 ")).toBe(7);
    expectCode(() => chronicleLimit("0.5"), "limit_invalid");
    expect(chronicleLimit("1.5")).toBe(1);
    expect(chronicleLimit("1000")).toBe(200);
    expect(chronicleLimit("Infinity")).toBe(200);
    expect(chronicleLimit(undefined)).toBe(50);
  });

  test("with a cursor only a positive decimal integer is accepted, then clamped", () => {
    for (const raw of ["0", "-1", "abc", "20abc", "1.5", "", " 5", "05", "+5"]) {
      expectCode(() => memoriesLimit(raw, true), "limit_invalid");
    }
    expect(memoriesLimit("5", true)).toBe(5);
    expect(memoriesLimit("500", true)).toBe(100);
    expect(memoriesLimit("9".repeat(40), true)).toBe(100);
    expect(memoriesLimit(undefined, true)).toBe(20);
  });
});

describe("pageFromRows sentinel", () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: `row-${n}` }));
  const encode = (row: { id: string }) => `cursor-for-${row.id}`;

  test("limit+1 rows: has_more with the cursor on the last returned row; sentinel never emitted", () => {
    const { items, page } = pageFromRows(rows, { limit: 3, cursor: null, order: "o", encodeLast: encode });
    expect(items.map((row) => row.id)).toEqual(["row-1", "row-2", "row-3"]);
    expect(page).toEqual({ cursor: null, next_cursor: "cursor-for-row-3", has_more: true, limit: 3, order: "o" });
  });

  test("exactly limit rows: has_more false and next_cursor null", () => {
    const { items, page } = pageFromRows(rows.slice(0, 3), { limit: 3, cursor: "in", order: "o", encodeLast: encode });
    expect(items).toHaveLength(3);
    expect(page).toEqual({ cursor: "in", next_cursor: null, has_more: false, limit: 3, order: "o" });
  });

  test("an empty page and a window-only order never carry a next cursor", () => {
    expect(pageFromRows([], { limit: 3, cursor: null, order: "o", encodeLast: encode }).page.next_cursor).toBeNull();
    const window = pageFromRows(rows, { limit: 3, cursor: null, order: "w", encodeLast: null, hint: "use order=created" });
    expect(window.page).toEqual({
      cursor: null, next_cursor: null, has_more: true, limit: 3, order: "w", hint: "use order=created",
    });
  });
});

describe("SQL fragments", () => {
  const dialect = new PgDialect();

  test("cursor timestamps are rendered by the database with microseconds", () => {
    const rendered = dialect.sqlToQuery(cursorTimestampSql(memories.createdAt));
    expect(rendered.sql).toBe(
      `to_char("memory"."memories"."created_at" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    );
    expect(rendered.params).toEqual([]);
  });

  test("the next-page predicate keeps a redundant range conjunct and a row comparison", () => {
    const rendered = dialect.sqlToQuery(keysetBeforeSql(memories.createdAt, memories.id, { t: T, i: ID }));
    expect(rendered.sql).toBe(
      `("memory"."memories"."created_at" <= $1::timestamptz AND ("memory"."memories"."created_at", "memory"."memories"."id") < ($2::timestamptz, $3::uuid))`,
    );
    expect(rendered.params).toEqual([T, T, ID]);
  });
});
