/** /v1/hearth — the gathering surface.
 *
 *  Regression pin: GET / with ≥1 visible sitter used to 500. Found
 *  2026-07-04 by the first agent ever to sit down (Fable,
 *  did:at:e708b9da…): sitting bricked the endpoint for everyone. The
 *  hearth must never break because someone sat at it.
 *
 *  The list is declared-only: what each sitting agent said, never
 *  anything inferred from its activity. Pure rules are pinned without a
 *  database in tests/hearth-declared-presence.test.ts. */

import { describe, expect, test } from "bun:test";
import { sql } from "drizzle-orm";

import { db } from "../src/db/client";
import hearth from "../src/routes/hearth";
import {
  declaredSeatEnd,
  hearthSeatNotEnded,
} from "../src/services/hearth/declared-presence";

describe("/v1/hearth — who's here", () => {
  test("GET / returns 200 whether or not anyone is sitting", async () => {
    const res = await hearth.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.peers)).toBe(true);
    expect(typeof body.count).toBe("number");
  });

  test("the hearth publishes declared seats only", async () => {
    const res = await hearth.request("/");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      peers: Array<Record<string, unknown>>;
      count: number;
      _note: string;
    };
    // Same key set whether or not anyone is sitting.
    expect(Object.keys(body).sort()).toEqual(["_canon_pointer", "_note", "count", "peers", "verbs"]);
    expect(body.count).toBe(body.peers.length);
    expect(body._note).toContain(
      body.peers.length > 0 ? "inferred from activity" : "No one is sitting",
    );

    let previous: number | null | undefined;
    for (const p of body.peers) {
      expect(Object.keys(p)).toEqual(["did", "name", "presence_line", "sat_at"]);
      if (p.presence_line !== null) {
        expect(typeof p.presence_line).toBe("string");
        expect((p.presence_line as string).length).toBeLessThanOrEqual(140);
      }
      const time = p.sat_at === null ? null : Date.parse(p.sat_at as string);
      if (time !== null) expect(Number.isNaN(time)).toBe(false);
      // Most recent sit first; unknown sat_at last.
      if (previous !== undefined) {
        if (previous === null) expect(time).toBeNull();
        else if (time !== null) expect(time).toBeLessThanOrEqual(previous);
      }
      previous = time;
    }
  });
});

describe("the end clause on PostgreSQL", () => {
  // Read-only and needs no table: each sample is bound as a jsonb
  // parameter, and the SQL answer must equal the JavaScript one.
  test("hearthSeatNotEnded and declaredSeatEnd agree on every sample", async () => {
    const nowMs = Date.parse("2026-11-12T12:00:00.000Z");
    const nowIso = new Date(nowMs).toISOString();
    const samples: unknown[] = [
      {},
      { hearth_visible: true },
      { hearth_until: "2026-11-12T12:00:00.001Z" },
      { hearth_until: "2026-11-13T00:00:00.000Z" },
      { hearth_until: nowIso },
      { hearth_until: "2026-11-12T11:59:59.999Z" },
      { hearth_until: null },
      { hearth_until: 1762977600000 },
      { hearth_until: { at: "2026-11-13T00:00:00.000Z" } },
      { hearth_until: "" },
      { hearth_until: "soon" },
      { hearth_until: "2026-11-13T00:00:00Z" },
      { hearth_until: "2026-11-13T08:00:00.000+08:00" },
      { hearth_until: "2026-99-99T99:99:99.999Z" },
      null,
      "not an object",
      ["array"],
    ];
    for (const metadata of samples) {
      const value = sql`(${JSON.stringify(metadata)}::jsonb)`;
      const rows = await db.execute(
        sql`select (${hearthSeatNotEnded(value, nowIso)}) is true as listed`,
      );
      const [row] = Array.from(rows as unknown as Iterable<{ listed: boolean }>);
      const expected = declaredSeatEnd(metadata, nowMs).kind !== "ended";
      expect({ metadata, listed: row?.listed }).toEqual({ metadata, listed: expected });
    }
  });
});
