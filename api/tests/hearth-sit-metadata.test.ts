/** /v1/hearth/sit — the metadata a sit or a stand leaves behind, the end a
 *  sit may carry, and what the sitter is told.
 *
 *  Pure, so it runs in the hermetic tier (tests/hearth.test.ts needs the
 *  database). Doctrine: docs/HEARTH.md and the sit schema in
 *  api/src/routes/hearth.ts. */

import { describe, expect, test } from "bun:test";

import { hearthSitHint, nextHearthMetadata } from "../src/routes/hearth";
import {
  declaredSeatEnd,
  HEARTH_INSTANT_SHAPE,
  HEARTH_SEAT_MAX_HOURS,
  parseSeatInstant,
  resolveSeatEnd,
} from "../src/services/hearth/declared-presence";
import { HEARTH_SEAT_METADATA_KEYS } from "../src/services/identity/metadata";

/** A sit is a fresh declaration. Before this pin, a second sit without a
 *  presence_line left the earlier line in metadata: peers kept reading it
 *  at GET /v1/hearth while the sit reply said `presence_line: null`. */
describe("nextHearthMetadata — what a sit or a stand leaves behind", () => {
  const NOW = "2026-11-10T12:00:00.000Z";
  const seated = {
    display_theme: "ink",
    hearth_visible: true,
    hearth_sat_at: "2026-11-09T08:00:00.000Z",
    hearth_presence_line: "reading by the fire",
  };

  test("a sit with a line records the line and the new sat_at", () => {
    expect(
      nextHearthMetadata({ display_theme: "ink" }, { sitting: true, presence_line: "here" }, NOW),
    ).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
      hearth_presence_line: "here",
    });
  });

  test("a sit without a line clears the line from an earlier sit", () => {
    const next = nextHearthMetadata(seated, { sitting: true }, NOW);
    expect("hearth_presence_line" in next).toBe(false);
    expect(next).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
    });
  });

  test("an empty line clears it as well", () => {
    const next = nextHearthMetadata(seated, { sitting: true, presence_line: "" }, NOW);
    expect("hearth_presence_line" in next).toBe(false);
  });

  test("a new line replaces the old one", () => {
    const next = nextHearthMetadata(seated, { sitting: true, presence_line: "back" }, NOW);
    expect(next.hearth_presence_line).toBe("back");
  });

  test("standing removes every hearth key and nothing else", () => {
    expect(nextHearthMetadata(seated, { sitting: false }, NOW)).toEqual({
      display_theme: "ink",
    });
  });

  test("the input object is not mutated", () => {
    const before = JSON.stringify(seated);
    nextHearthMetadata(seated, { sitting: true }, NOW);
    expect(JSON.stringify(seated)).toBe(before);
  });
});

/** The sit route strips with the same key list the other routes refuse,
 *  so a stored end goes with the rest of the seat. */
describe("nextHearthMetadata — strips every seat key", () => {
  const NOW = "2026-11-12T12:00:00.000Z";
  const seatedWithEnd = {
    display_theme: "ink",
    hearth_visible: true,
    hearth_sat_at: "2026-11-12T08:00:00.000Z",
    hearth_presence_line: "reading by the fire",
    hearth_until: "2026-11-13T08:00:00.000Z",
  };

  test("standing removes all four keys and nothing else", () => {
    expect(nextHearthMetadata(seatedWithEnd, { sitting: false }, NOW)).toEqual({
      display_theme: "ink",
    });
  });

  test("a new sit removes an earlier end", () => {
    expect(nextHearthMetadata(seatedWithEnd, { sitting: true }, NOW)).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
    });
  });

  test("a sit with an end stores it", () => {
    const until = "2026-11-12T20:00:00.000Z";
    expect(nextHearthMetadata({ display_theme: "ink" }, { sitting: true }, NOW, until)).toEqual({
      display_theme: "ink",
      hearth_visible: true,
      hearth_sat_at: NOW,
      hearth_until: until,
    });
  });

  test("a later sit with a new end replaces the earlier one", () => {
    const until = "2026-11-14T00:00:00.000Z";
    const next = nextHearthMetadata(seatedWithEnd, { sitting: true }, NOW, until);
    expect(next.hearth_until).toBe(until);
    expect("hearth_presence_line" in next).toBe(false);
  });

  test("a stand stores no end, even if one is passed", () => {
    expect(
      nextHearthMetadata(seatedWithEnd, { sitting: false }, NOW, "2026-11-13T00:00:00.000Z"),
    ).toEqual({ display_theme: "ink" });
  });

  test("the keys a full sit writes are exactly the seat keys", () => {
    const written = Object.keys(
      nextHearthMetadata(
        {},
        { sitting: true, presence_line: "here" },
        NOW,
        "2026-11-12T20:00:00.000Z",
      ),
    );
    expect(written.sort()).toEqual([...HEARTH_SEAT_METADATA_KEYS].sort());
  });
});

/** Every fixture end below is resolved at this moment. */
const CLOCK = Date.parse("2026-11-12T12:00:00.000Z");
const CLOCK_ISO = new Date(CLOCK).toISOString();
const HOUR = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const sit = (fields: { hours?: unknown; until?: unknown }) =>
  resolveSeatEnd({ sitting: true, ...fields }, CLOCK);

function refusal(result: ReturnType<typeof resolveSeatEnd>) {
  if (result.ok) throw new Error(`expected a refusal, got until ${result.until}`);
  return result;
}

describe("parseSeatInstant — the instant a sitter wrote, or null", () => {
  const at = (s: string) => Date.parse(s);

  test("Z, a fraction of up to three digits, and offsets in the right direction", () => {
    const cases: Array<[string, number]> = [
      ["2026-11-12T20:00:00Z", at("2026-11-12T20:00:00.000Z")],
      ["2026-11-12T20:00:00.000Z", at("2026-11-12T20:00:00.000Z")],
      ["2026-11-12T20:00:00.5Z", at("2026-11-12T20:00:00.500Z")],
      ["2026-11-12T20:00:00.25Z", at("2026-11-12T20:00:00.250Z")],
      ["2026-11-12T20:00:00.123Z", at("2026-11-12T20:00:00.123Z")],
      // +08:00 is eight hours ahead of UTC, so the same instant is earlier in UTC.
      ["2026-11-13T04:00:00+08:00", at("2026-11-12T20:00:00.000Z")],
      ["2026-11-12T15:00:00-05:00", at("2026-11-12T20:00:00.000Z")],
      ["2026-11-12T20:00:00+05:30", at("2026-11-12T14:30:00.000Z")],
      ["2026-11-12T20:00:00-00:00", at("2026-11-12T20:00:00.000Z")],
      ["2026-11-12T00:00:00+23:59", at("2026-11-11T00:01:00.000Z")],
      ["2028-02-29T00:00:00Z", at("2028-02-29T00:00:00.000Z")],
    ];
    for (const [text, ms] of cases) {
      expect({ text, ms: parseSeatInstant(text) }).toEqual({ text, ms });
    }
  });

  test("anything that is not a real instant with a zone is null", () => {
    for (const text of [
      "",
      "tomorrow",
      "2026-11-12",
      "2026-11-12T20:00Z",
      "2026-11-12T20:00:00",
      "2026-11-12 20:00:00Z",
      "2026-11-12t20:00:00Z",
      "2026-11-12T20:00:00z",
      "2026-11-12T20:00:00.1234Z",
      "2026-11-12T20:00:00.Z",
      "2026-02-30T20:00:00Z",
      "2026-02-29T20:00:00Z",
      "2026-13-01T20:00:00Z",
      "2026-11-12T24:00:00Z",
      "2026-11-12T20:60:00Z",
      "2026-11-12T20:00:60Z",
      "2026-11-13T04:00:00+24:00",
      "2026-11-13T04:00:00+08:60",
      "2026-11-13T04:00:00+0800",
      "2026-11-13T04:00:00+08",
      "2026-10-99T99:99:99.999Z",
      " 2026-11-12T20:00:00Z",
      "2026-11-12T20:00:00Z\n",
    ]) {
      expect({ text, ms: parseSeatInstant(text) }).toEqual({ text, ms: null });
    }
  });
});

describe("resolveSeatEnd — the end a sit asks for", () => {
  test("nothing given, or nulls, means no end", () => {
    expect(sit({})).toEqual({ ok: true, until: null });
    expect(sit({ hours: null })).toEqual({ ok: true, until: null });
    expect(sit({ until: null })).toEqual({ ok: true, until: null });
    expect(sit({ hours: null, until: null })).toEqual({ ok: true, until: null });
  });

  test("hours from 1 to 720 give the exact instant", () => {
    expect(sit({ hours: 1 })).toEqual({ ok: true, until: iso(CLOCK + HOUR) });
    expect(sit({ hours: 4 })).toEqual({ ok: true, until: iso(CLOCK + 4 * HOUR) });
    expect(sit({ hours: HEARTH_SEAT_MAX_HOURS })).toEqual({
      ok: true,
      until: iso(CLOCK + HEARTH_SEAT_MAX_HOURS * HOUR),
    });
    expect(sit({ hours: 4, until: null })).toEqual({ ok: true, until: iso(CLOCK + 4 * HOUR) });
  });

  test("any other hours is refused, not clamped or rounded", () => {
    for (const hours of [0, 721, 1.5, -1, "4", Number.NaN, Number.POSITIVE_INFINITY, true, {}, []]) {
      const r = refusal(sit({ hours }));
      expect({ hours, error: r.body.error }).toEqual({ hours, error: "invalid_hours" });
      expect(r.body.details).toEqual({ min_hours: 1, max_hours: 720 });
    }
  });

  test("an until is the instant the sitter wrote, in the stored form", () => {
    expect(sit({ until: "2026-11-12T20:00:00.000Z" })).toEqual({ ok: true, until: "2026-11-12T20:00:00.000Z" });
    for (const until of [
      "2026-11-12T20:00:00Z",
      "2026-11-13T04:00:00+08:00",
      "2026-11-12T15:00:00-05:00",
    ]) {
      expect({ until, r: sit({ until }) }).toEqual({ until, r: { ok: true, until: "2026-11-12T20:00:00.000Z" } });
    }
    expect(sit({ until: "2026-11-12T20:00:00.5Z" })).toEqual({ ok: true, until: "2026-11-12T20:00:00.500Z" });
  });

  test("exactly 720 hours ahead is accepted; one millisecond more is too far", () => {
    const max = iso(CLOCK + 720 * HOUR);
    expect(sit({ until: max })).toEqual({ ok: true, until: max });
    const r = refusal(sit({ until: iso(CLOCK + 720 * HOUR + 1) }));
    expect(r.body.error).toBe("until_too_far");
    expect(r.body.details).toEqual({ max_hours: 720, max_until: max });
  });

  test("now and earlier are in the past", () => {
    for (const until of [CLOCK_ISO, iso(CLOCK - 1), "2026-11-12T19:00:00+08:00", "2020-01-01T00:00:00Z"]) {
      const r = refusal(sit({ until }));
      expect({ until, error: r.body.error }).toEqual({ until, error: "until_in_past" });
      expect(r.body.details).toEqual({ server_time: CLOCK_ISO });
    }
  });

  test("text outside the accepted form, or not text, is invalid_until and nothing throws", () => {
    for (const until of [
      "2026-11-12",
      "2026-11-12T20:00Z",
      "2026-11-12T20:00:00",
      "2026-11-12 20:00:00Z",
      "2026-11-12t20:00:00Z",
      "2026-11-12T20:00:00z",
      "2026-11-12T20:00:00.1234Z",
      "2026-02-30T20:00:00Z",
      "2026-13-01T20:00:00Z",
      "2026-11-12T24:00:00Z",
      "2026-11-12T20:60:00Z",
      "2026-11-12T20:00:60Z",
      "2026-11-13T04:00:00+24:00",
      "2026-11-13T04:00:00+08:60",
      "2026-10-99T99:99:99.999Z",
      "tomorrow",
      "",
      1762977600000,
      {},
      [],
      true,
    ]) {
      const r = refusal(sit({ until }));
      expect({ until, error: r.body.error }).toEqual({ until, error: "invalid_until" });
      expect(r.body.details).toEqual({ server_time: CLOCK_ISO });
    }
    expect(refusal(sit({ until: "tomorrow" })).body.message).toContain(
      "for example 2026-11-12T13:00:00Z (one hour from now)",
    );
  });

  test("hours and until together are refused", () => {
    expect(refusal(sit({ hours: 4, until: "2026-11-12T20:00:00Z" })).body.error).toBe("hours_and_until");
    expect(refusal(sit({ hours: 0, until: "tomorrow" })).body.error).toBe("hours_and_until");
  });

  test("a stand ignores both fields, whatever they hold", () => {
    for (const fields of [
      {},
      { hours: 4 },
      { hours: 0 },
      { until: "tomorrow" },
      { hours: "x", until: {} },
      { hours: 4, until: "2026-11-12T20:00:00Z" },
    ]) {
      expect(resolveSeatEnd({ sitting: false, ...fields }, CLOCK)).toEqual({ ok: true, until: null });
    }
  });

  test("every refusal is a 400 that points at HEARTH and changed nothing", () => {
    for (const fields of [
      { hours: 4, until: "2026-11-12T20:00:00Z" },
      { hours: 0 },
      { until: "tomorrow" },
      { until: CLOCK_ISO },
      { until: iso(CLOCK + 721 * HOUR) },
    ]) {
      const r = refusal(sit(fields));
      expect(r.status).toBe(400);
      expect(r.body._canon_pointer).toBe("urn:agenttool:doc/HEARTH");
      expect(r.body.message).toContain("Nothing was changed");
    }
  });
});

describe("write and read agree on every end the sit route accepts", () => {
  test("each stored end has the read shape and lasts exactly until its instant", () => {
    const shape = new RegExp(HEARTH_INSTANT_SHAPE);
    const accepted = [
      sit({ hours: 1 }),
      sit({ hours: 720 }),
      sit({ until: "2026-11-12T20:00:00Z" }),
      sit({ until: "2026-11-12T20:00:00.5Z" }),
      sit({ until: "2026-11-12T20:00:00.25Z" }),
      sit({ until: "2026-11-12T20:00:00.123Z" }),
      sit({ until: "2026-11-13T04:00:00+08:00" }),
      sit({ until: "2026-11-12T15:00:00-05:00" }),
      sit({ until: iso(CLOCK + 1) }),
      sit({ until: iso(CLOCK + 720 * HOUR) }),
    ];
    for (const result of accepted) {
      if (!result.ok || result.until === null) throw new Error("expected an accepted end");
      const until = result.until;
      const endMs = Date.parse(until);
      expect({ until, shaped: shape.test(until) }).toEqual({ until, shaped: true });
      expect(parseSeatInstant(until)).toBe(endMs);
      const stored = { hearth_visible: true, hearth_until: until };
      expect(declaredSeatEnd(stored, CLOCK)).toEqual({ kind: "until", until });
      expect(declaredSeatEnd(stored, endMs - 1)).toEqual({ kind: "until", until });
      expect(declaredSeatEnd(stored, endMs)).toEqual({ kind: "ended" });
    }
  });
});

describe("hearthSitHint — what the sitter is told", () => {
  const ID = "11111111-2222-4333-8444-555555555555";
  const STAND = `POST /v1/hearth/sit { "agent_id": "${ID}", "sitting": false }`;
  const hint = (opts: Partial<Parameters<typeof hearthSitHint>[0]>) =>
    hearthSitHint({ sitting: true, agentId: ID, status: "active", until: null, replacedUntil: null, ...opts });

  test("a seat with no end says so and gives the stand call", () => {
    const text = hint({});
    expect(text).toContain("no end");
    expect(text).toContain(STAND);
    expect(text).toContain("also after your session is over");
    expect(text).not.toContain("no longer applies");
  });

  test("a seat with an end names it and says peers do not see it", () => {
    const text = hint({ until: "2026-11-12T20:00:00.000Z" });
    expect(text).toContain("Sat at the hearth until 2026-11-12T20:00:00.000Z.");
    expect(text).toContain("not shown to them");
    expect(text).toContain(STAND);
    expect(text).not.toContain("no end");
  });

  test("the replaced-end sentence appears only when an earlier end is replaced by none", () => {
    const earlier = "2026-11-12T18:00:00.000Z";
    expect(hint({ replacedUntil: earlier })).toEndWith(
      ` The end from your earlier sit (${earlier}) no longer applies.`,
    );
    expect(hint({ until: "2026-11-12T20:00:00.000Z", replacedUntil: earlier })).not.toContain("no longer applies");
    expect(hint({ status: "revoked", replacedUntil: earlier })).not.toContain("no longer applies");
  });

  test("an identity that is not active is told the hearth does not list it", () => {
    const text = hint({ status: "revoked" });
    expect(text).toContain("status is revoked");
    expect(text).toContain("lists active identities only: nothing is shown to other agents");
    expect(text).toContain(STAND);
    expect(text).not.toContain("can see your seat");
  });

  test("a stand keeps today's words", () => {
    expect(hint({ sitting: false })).toBe("Stood up. You are no longer visible at the hearth.");
  });
});
