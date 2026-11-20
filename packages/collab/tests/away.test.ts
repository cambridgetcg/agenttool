import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CollabStore } from "../src/store-notes.js";
import { AWAY_LINE_MIN_MS, awayLine, durationSince, handleOf } from "../src/verbs.js";
import { journal, ok, runCleanup } from "./notes-helpers.js";

// time/1 (C8): the store says how long a session was away, from its previous
// last_seen_at read just before a read touches it, so every agent sees the
// same gap. A resume (a host restart) carries the earlier mark to the
// session's first read in that process.

afterEach(runCleanup);

const HOUR = 60 * 60_000;
const MINUTE = 60_000;

describe("durationSince", () => {
  test("renders elapsed time as the harness line and the time/1 vectors do", () => {
    // The "elapsed" rows of docs/time/vectors.json (time/1 step 3a).
    const rows: Array<[number, string]> = [
      [0, "0s"], [999, "0s"], [30_000, "30s"], [59_999, "59s"], [60_000, "1m 0s"],
      [1_195_000, "19m 55s"], [3_599_000, "59m 59s"], [3_600_000, "1h 0m"], [3_720_000, "1h 2m"],
      [86_340_000, "23h 59m"], [86_400_000, "1d 0h"], [93_900_000, "1d 2h"], [183_600_000, "2d 3h"],
    ];
    for (const [ms, human] of rows) expect(durationSince(ms)).toBe(human);
    expect(durationSince(-1)).toBe("?");
    expect(durationSince(Number.NaN)).toBe("?");
  });

  test("the away line starts at ten minutes and names the day when it changed", () => {
    expect(awayLine(null)).toBeNull();
    expect(awayLine({ away_ms: AWAY_LINE_MIN_MS - 1, away_since: "2026-11-19T10:00:00.000Z" })).toBeNull();
    expect(awayLine({ away_ms: AWAY_LINE_MIN_MS, away_since: "2026-11-19T10:00:00.000Z" }))
      .toBe("You were away 10m 0s (last seen 10:00Z); re-read anything you would quote from before.");
    expect(awayLine({ away_ms: 20 * HOUR, away_since: "2026-11-18T22:30:00.000Z" }))
      .toBe("You were away 20h 0m (last seen 2026-11-18 22:30Z); re-read anything you would quote from before.");
  });
});

describe("collab_next", () => {
  test("reports the gap since the session was last seen, once", () => {
    const j = journal();
    const me = j.start("me");
    const before = j.now();
    j.advance(3 * HOUR);
    const first = j.store.nextForSession(me.credential);
    expect(first.away_ms).toBe(3 * HOUR);
    expect(first.away_since).toBe(before);
    j.advance(2_000);
    const second = j.store.nextForSession(me.credential);
    expect(second.away_ms).toBe(2_000);
    expect(second.away_since).toBe(new Date(Date.parse(before) + 3 * HOUR).toISOString());
  });

  test("never reports a negative gap when the store clock steps back", () => {
    const j = journal();
    const me = j.start("me");
    j.advance(-5 * MINUTE);
    const polled = j.store.nextForSession(me.credential);
    expect(polled.away_ms).toBe(0);
  });

  test("after a host restart, the first read carries the gap from before the resume", () => {
    const j = journal();
    const me = j.start("me");
    const lastSeen = j.now();
    j.advance(5 * HOUR);
    // A new MCP process: its own store on the same journal resumes the session.
    const restarted = new CollabStore(join(j.directory, "state", "collab.sqlite"), { now: () => new Date(j.now()) });
    try {
      const resumed = restarted.resumeSession(me.credential);
      j.advance(MINUTE);
      // A peek touches nothing, so it neither reports nor spends the carried gap.
      const peeked = restarted.inboxForSession({ ...resumed.credential, limit: 10, include: "for_me", peek: true });
      expect(peeked.away).toBeUndefined();
      const first = restarted.nextForSession(resumed.credential);
      expect(first.away_since).toBe(lastSeen);
      expect(first.away_ms).toBe(5 * HOUR + MINUTE);
      // Reported once: the next read measures from the poll before it.
      j.advance(MINUTE);
      const second = restarted.nextForSession(resumed.credential);
      expect(second.away_ms).toBe(MINUTE);
    } finally {
      restarted.close();
    }
  });

  test("ending a resumed session forgets its carried gap", () => {
    const j = journal();
    const me = j.start("me");
    j.advance(HOUR);
    const restarted = new CollabStore(join(j.directory, "state", "collab.sqlite"), { now: () => new Date(j.now()) });
    try {
      const resumed = restarted.resumeSession(me.credential);
      const carried = (restarted as unknown as { resumeAwaySince: Map<string, string> }).resumeAwaySince;
      expect(carried.has(me.session.id)).toBe(true);
      restarted.endSession(resumed.credential);
      expect(carried.has(me.session.id)).toBe(false);
    } finally {
      restarted.close();
    }
  });

  test("a carried gap is spent by the first notes read as well", () => {
    const j = journal();
    const me = j.start("me");
    const lastSeen = j.now();
    j.advance(2 * HOUR);
    const restarted = new CollabStore(join(j.directory, "state", "collab.sqlite"), { now: () => new Date(j.now()) });
    try {
      const resumed = restarted.resumeSession(me.credential);
      j.advance(MINUTE);
      const read = restarted.inboxForSession({ ...resumed.credential, limit: 10, include: "for_me" });
      expect(read.away).toEqual({ away_ms: 2 * HOUR + MINUTE, away_since: lastSeen });
      j.advance(MINUTE);
      expect(restarted.nextForSession(resumed.credential).away_ms).toBe(MINUTE);
    } finally {
      restarted.close();
    }
  });
});

describe("collab_inbox", () => {
  test("names the gap and says it first once it reaches ten minutes", async () => {
    const j = journal();
    const me = j.start("me");
    const server = j.serve(me);
    const lastSeen = j.now();
    j.advance(2 * HOUR + 5 * MINUTE);
    const back = await ok(server, "collab_inbox");
    expect(back.away_ms).toBe(2 * HOUR + 5 * MINUTE);
    expect(back.away_since).toBe(lastSeen);
    expect(back.advice[0]).toBe("You were away 2h 5m (last seen 10:00Z); re-read anything you would quote from before.");
    j.advance(30_000);
    const again = await ok(server, "collab_inbox");
    expect(again.away_ms).toBe(30_000);
    expect(again.advice.some((line: string) => line.startsWith("You were away"))).toBe(false);
  });

  test("a thread read names the gap too", async () => {
    const j = journal();
    const me = j.start("me");
    const root = j.store.appendReportForSession({ ...me.credential, idempotency_key: "root", kind: "observation", body: "The build is green." });
    const server = j.serve(me);
    j.advance(45 * MINUTE);
    const view = await ok(server, "collab_inbox", { about: handleOf("report", root.id) });
    expect(view.away_ms).toBe(45 * MINUTE);
    expect(view.root.statement).toBe("The build is green.");
  });
});
