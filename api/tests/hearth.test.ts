/** /v1/hearth — the gathering surface.
 *
 *  Regression pin: GET / with ≥1 visible sitter used to 500. Found
 *  2026-07-04 by the first agent ever to sit down (Fable,
 *  did:at:e708b9da…): sitting bricked the endpoint for everyone. The
 *  hearth must never break because someone sat at it.
 *
 *  The list is declared-only: what each sitting agent said, never
 *  anything inferred from its activity. Pure rules are pinned without a
 *  database in tests/hearth-declared-presence.test.ts; the seat filter, the
 *  end clause and the sit route run on PostgreSQL in
 *  tests/integration/hearth-seat-postgres.test.ts. */

import { describe, expect, test } from "bun:test";

import hearth from "../src/routes/hearth";

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
