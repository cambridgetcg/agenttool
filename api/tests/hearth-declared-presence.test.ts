/** The hearth shows declared seats and nothing else.
 *
 *  Pure rules, rendered SQL and source scans; no database, so this runs in
 *  the hermetic tier. The database tier (tests/hearth.test.ts) smoke-tests
 *  the query against PostgreSQL; it checks order only where seats exist.
 *
 *  Doctrine: docs/HEARTH.md */

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  declaredHearthPeers,
  declaredPresenceLine,
  declaredSatAt,
  declaredSeatEnd,
  HEARTH_EMPTY_NOTE,
  HEARTH_PRESENCE_LINE_MAX,
  HEARTH_SAT_AT_SKEW_MS,
  HEARTH_SEATED_NOTE,
  hearthSeatFilter,
  hearthSeatListed,
  hearthSeatOrder,
  type HearthSeatRow,
} from "../src/services/hearth/declared-presence";

/** Every fixture seat below was taken before this moment. */
const NOW = Date.parse("2026-11-11T00:00:00.000Z");
const peersOf = (rows: readonly HearthSeatRow[], opts: { excludeId?: string; limit?: number } = {}) =>
  declaredHearthPeers(rows, { nowMs: NOW, ...opts });

const SRC = join(import.meta.dir, "..", "src");
const read = (file: string) => readFileSync(join(SRC, file), "utf8");

function row(id: string, metadata: unknown, name = `agent-${id}`): HearthSeatRow {
  return { id, did: `did:at:${id}`, name, metadata };
}
const seat = (satAt: unknown, line?: unknown) => ({
  hearth_visible: true,
  hearth_sat_at: satAt,
  ...(line === undefined ? {} : { hearth_presence_line: line }),
});

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
  );
}

describe("declaredHearthPeers — what a peer is shown", () => {
  test("exactly four keys, in order, whatever the metadata holds", () => {
    const peers = peersOf([
      row("a", seat("2026-11-10T10:00:00.000Z", "reading")),
      row("b", {}),
      row("c", null),
      row("d", "not an object"),
      row("e", ["array"]),
    ]);
    expect(peers).toHaveLength(5);
    for (const peer of peers) {
      expect(Object.keys(peer)).toEqual(["did", "name", "presence_line", "sat_at"]);
    }
    expect(peers[0]).toEqual({
      did: "did:at:a",
      name: "agent-a",
      presence_line: "reading",
      sat_at: "2026-11-10T10:00:00.000Z",
    });
  });

  test("nothing else in metadata reaches a peer, and a peer has no id field", () => {
    const id = "6f1d0c52-9a7e-4a53-8f0b-2f4f6f7f0a11";
    const peers = peersOf([
      row(id, {
        ...seat("2026-11-10T10:00:00.000Z", "here"),
        warmth: "warm",
        last_activity_at: "2026-11-10T09:59:00.000Z",
        resting: true,
        quiet_reason: "private",
        anything: { nested: "secret-value" },
      }),
    ]);
    const text = JSON.stringify(peers);
    for (const leaked of ["warmth", "last_activity_at", "resting", "quiet_reason", "secret-value", "hearth_visible"]) {
      expect(text).not.toContain(leaked);
    }
    expect(Object.keys(peers[0]!)).toEqual(["did", "name", "presence_line", "sat_at"]);
  });

  test("most recent sit first, unknown sat_at last, ties by id; any input order gives the same list", () => {
    const rows = [
      row("m", seat("2026-11-09T08:00:00.000Z")),
      row("z", seat("2026-11-10T08:00:00.000Z")),
      row("a", seat("2026-11-10T08:00:00.000Z")),
      row("k", seat("not a date")),
      row("b", {}),
    ];
    const expected = ["did:at:a", "did:at:z", "did:at:m", "did:at:b", "did:at:k"];
    for (const order of permutations(rows)) {
      expect(peersOf(order).map((p) => p.did)).toEqual(expected);
    }
  });

  test("a sat_at the sit path could not have written is unknown and sorts last", () => {
    const real = row("real", seat("2026-11-10T08:00:00.000Z"));
    const forged = [
      row("f1", seat("9999-12-31T23:59:59.999Z")), // the future: would hold first place for ever
      row("f2", seat("zzzz")),
      row("f3", seat("2026-11-10T09:00:00+02:00")), // a real instant, but not the sit path's form
      row("f4", seat("2026-11-10T09:00:00Z")),
      row("f5", seat(1762761600000)),
      row("f6", seat("Jan 1 2020 (" + "x".repeat(500) + ")")),
    ];
    for (const order of [[real, ...forged], [...forged, real]]) {
      const peers = peersOf(order);
      expect(peers[0]).toEqual({ did: "did:at:real", name: "agent-real", presence_line: null, sat_at: "2026-11-10T08:00:00.000Z" });
      expect(peers.slice(1).map((p) => p.sat_at)).toEqual([null, null, null, null, null, null]);
      expect(peers.slice(1).map((p) => p.did)).toEqual(forged.map((f) => f.did));
    }
  });

  test("a seat taken just now counts; one from beyond the clock allowance does not", () => {
    const at = (ms: number) => new Date(ms).toISOString();
    expect(declaredSatAt({ hearth_sat_at: at(NOW) }, NOW)).toBe(at(NOW));
    expect(declaredSatAt({ hearth_sat_at: at(NOW + HEARTH_SAT_AT_SKEW_MS) }, NOW)).toBe(at(NOW + HEARTH_SAT_AT_SKEW_MS));
    expect(declaredSatAt({ hearth_sat_at: at(NOW + HEARTH_SAT_AT_SKEW_MS + 1) }, NOW)).toBeNull();
  });

  test("the input is not mutated", () => {
    const rows = [
      row("b", seat("2026-11-09T08:00:00.000Z")),
      row("a", seat("2026-11-10T08:00:00.000Z")),
    ];
    const before = JSON.stringify(rows);
    peersOf(rows, { excludeId: "a", limit: 1 });
    expect(JSON.stringify(rows)).toBe(before);
  });

  test("the caller is excluded before the limit applies", () => {
    const rows = Array.from({ length: 11 }, (_, i) =>
      row(`p${String(i).padStart(2, "0")}`, seat(`2026-11-10T08:${String(59 - i).padStart(2, "0")}:00.000Z`)),
    );
    const peers = peersOf(rows, { excludeId: "p00", limit: 10 });
    expect(peers).toHaveLength(10);
    expect(peers.map((p) => p.did)).not.toContain("did:at:p00");
    expect(peers[0]!.did).toBe("did:at:p01");
    expect(peersOf(rows)).toHaveLength(11);
    expect(peersOf(rows, { limit: 0 })).toEqual([]);
    expect(peersOf([])).toEqual([]);
  });
});

describe("declaredPresenceLine — the agent's words, as written or not at all", () => {
  test("a line is returned byte for byte", () => {
    expect(declaredPresenceLine({ hearth_presence_line: "  here, 🐍🔥  " })).toBe("  here, 🐍🔥  ");
    const max = "x".repeat(HEARTH_PRESENCE_LINE_MAX);
    expect(declaredPresenceLine({ hearth_presence_line: max })).toBe(max);
  });

  test("blank, oversize, non-string and missing values are no line", () => {
    for (const value of ["", "   ", "\n\t", "x".repeat(HEARTH_PRESENCE_LINE_MAX + 1), 7, {}, null, undefined]) {
      expect(declaredPresenceLine({ hearth_presence_line: value })).toBeNull();
    }
    expect(declaredPresenceLine({})).toBeNull();
    expect(declaredPresenceLine(null)).toBeNull();
  });
});

describe("declaredSatAt — when the agent sat, or unknown", () => {
  test("a stored timestamp is returned unchanged", () => {
    expect(declaredSatAt({ hearth_sat_at: "2026-11-10T08:00:00.000Z" }, NOW)).toBe("2026-11-10T08:00:00.000Z");
  });

  test("anything that is not a timestamp is unknown", () => {
    for (const value of ["", "not a date", 1762761600000, null, undefined, {}]) {
      expect(declaredSatAt({ hearth_sat_at: value }, NOW)).toBeNull();
    }
    expect(declaredSatAt(undefined)).toBeNull();
  });
});

describe("declaredSeatEnd — the end the agent gave, if any", () => {
  const NOW_ISO = new Date(NOW).toISOString();

  test("no stored end means no end", () => {
    expect(declaredSeatEnd({ hearth_visible: true }, NOW)).toEqual({ kind: "open" });
    expect(declaredSeatEnd(undefined, NOW)).toEqual({ kind: "open" });
  });

  test("an end in the sit path's shape lasts until that instant", () => {
    const ahead = new Date(NOW + 1).toISOString();
    expect(declaredSeatEnd({ hearth_until: ahead }, NOW)).toEqual({ kind: "until", until: ahead });
    expect(declaredSeatEnd({ hearth_until: NOW_ISO }, NOW)).toEqual({ kind: "ended" });
    expect(declaredSeatEnd({ hearth_until: "2026-11-10T00:00:00.000Z" }, NOW)).toEqual({ kind: "ended" });
  });

  test("an end that cannot be read has ended", () => {
    for (const value of [
      null,
      1762819200000,
      {},
      "",
      "soon",
      "2026-11-12T00:00:00Z",
      "2026-11-12T08:00:00.000+08:00",
    ]) {
      expect(declaredSeatEnd({ hearth_until: value }, NOW)).toEqual({ kind: "ended" });
    }
  });
});

describe("hearthSeatListed — whether the hearth lists an identity now", () => {
  const future = new Date(NOW + 3_600_000).toISOString();
  const listed = (status: string, metadata: unknown) => hearthSeatListed({ status, metadata }, NOW);

  test("active, flagged, and not past its end", () => {
    expect(listed("active", { hearth_visible: true })).toBe(true);
    expect(listed("active", { hearth_visible: "true" })).toBe(true);
    expect(listed("active", { hearth_visible: true, hearth_until: future })).toBe(true);
    expect(listed("active", { hearth_visible: "true", hearth_until: future })).toBe(true);
  });

  test("anything else is not listed", () => {
    expect(listed("revoked", { hearth_visible: true })).toBe(false);
    expect(listed("memorial", { hearth_visible: true })).toBe(false);
    expect(listed("active", { hearth_visible: false })).toBe(false);
    expect(listed("active", { hearth_visible: "yes" })).toBe(false);
    expect(listed("active", {})).toBe(false);
    expect(listed("active", null)).toBe(false);
    expect(listed("active", { hearth_visible: true, hearth_until: "2026-11-10T00:00:00.000Z" })).toBe(false);
    expect(listed("active", { hearth_visible: true, hearth_until: "soon" })).toBe(false);
    expect(listed("active", { hearth_visible: true, hearth_until: null })).toBe(false);
  });
});

describe("what every reader is told", () => {
  test("the note states order, lifetime and that a seat is not liveness", () => {
    expect(HEARTH_SEATED_NOTE).toContain("most recent sit first");
    expect(HEARTH_SEATED_NOTE).toContain("until the agent stands up");
    expect(HEARTH_SEATED_NOTE).toContain("Nothing here is inferred from activity");
    expect(HEARTH_SEATED_NOTE).toContain("does not mean online, active or available");
    expect(HEARTH_EMPTY_NOTE).toContain("No one is sitting");
    for (const note of [HEARTH_SEATED_NOTE, HEARTH_EMPTY_NOTE]) {
      for (const tier of ["warm", "resting", "tending"]) expect(note).not.toContain(tier);
    }
  });
});

describe("the seat query", () => {
  const dialect = new PgDialect();

  test("filters on the declared flag and active status only", () => {
    const all = dialect.sqlToQuery(hearthSeatFilter());
    expect(all.sql).toContain("->>'hearth_visible' = 'true'");
    expect(all.params).toEqual(["active"]);

    const others = dialect.sqlToQuery(hearthSeatFilter("11111111-1111-4111-8111-111111111111"));
    expect(others.sql).toContain("<>");
    expect(others.params).toEqual(["active", "11111111-1111-4111-8111-111111111111"]);
  });

  test("orders by the declared sat_at, then id, and reads no activity table", () => {
    const order = dialect.sqlToQuery(sql.join(hearthSeatOrder(), sql`, `));
    // Same rule as declaredSatAt: the sit path's exact shape, not later
    // than now; anything else is NULL and sorts last.
    expect(order.sql).toContain("case when");
    expect(order.sql).toContain("->>'hearth_sat_at' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}Z$'");
    expect(order.sql).toContain("->>'hearth_sat_at' <= to_char((now() + interval '1 minute') at time zone 'UTC'");
    expect(order.sql).toContain("end DESC NULLS LAST");
    expect(order.sql).toContain('"id"');
    expect(order.params).toEqual([]);
    for (const rendered of [order.sql, dialect.sqlToQuery(hearthSeatFilter("x")).sql]) {
      expect(rendered).not.toContain("chronicle");
      expect(rendered).not.toContain("memor");
    }
  });
});

describe("source: one read, no inference left behind", () => {
  const ROUTES = ["routes/hearth.ts", "routes/thoughtful-wake.ts", "routes/wake-soap-opera.ts"];

  test("no activity-derived name or sentence remains", () => {
    for (const file of [...ROUTES, "services/wake/soap-opera-renderer.ts"]) {
      const source = read(file);
      for (const needle of [
        "hearth_warm",
        "last_activity_at",
        "warmth_counts",
        "warmthOf",
        "active in the last hour",
        "recent activity",
      ]) {
        expect({ file, needle, present: source.includes(needle) }).toEqual({ file, needle, present: false });
      }
    }
  });

  test("all three routes use the shared read and none filters seats itself", () => {
    for (const file of ROUTES) {
      const source = read(file);
      expect({ file, read: source.includes("readHearthSeats(") }).toEqual({ file, read: true });
      expect({ file, shape: source.includes("declaredHearthPeers(") }).toEqual({ file, shape: true });
      expect({ file, ownFilter: source.includes("->>'hearth_visible'") }).toEqual({ file, ownFilter: false });
    }
  });

  test("the hearth route keeps its mutation authority and imports no activity schema", () => {
    const source = read("routes/hearth.ts");
    expect(source).toContain("authorizeIdentityMutation");
    expect(source).not.toContain("db/schema/continuity");
    expect(source).not.toContain("db/schema/memory");
  });

  test("the pure module has no database client and the read writes nothing", () => {
    expect(read("services/hearth/declared-presence.ts")).not.toContain("db/client");
    const seats = read("services/hearth/seats.ts");
    for (const write of [".insert(", ".update(", ".delete("]) expect(seats).not.toContain(write);
  });
});
