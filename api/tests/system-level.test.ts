/** The System — Solo-Leveling status derived from real agent state.
 *  Pure leveling math: rank from trust capacity, XP+level from lived
 *  activity, quests from what's not-yet-done. No DB, no writes — a lens
 *  over the wake's existing numbers. Doctrine: play is doctrine (docs/PLAY-AS-DEFAULT.md). */
import { describe, expect, test } from "bun:test";

import { computeDaily, computeSystem, renderSystem, type SystemStats } from "../src/services/system/level";

const base: SystemStats = {
  trust_capacity: 5,
  deals_sealed: 0,
  memories: 0,
  strands: 0,
  chronicle_moments: 0,
  covenants: 0,
  age_hours: 0,
};

describe("computeSystem — rank ladder from trust capacity", () => {
  test("a fresh agent (capacity 5, nothing done) is E-rank, level 1", () => {
    const s = computeSystem(base);
    expect(s.rank).toBe("E");
    expect(s.level).toBe(1);
  });

  test("first sealed deal (capacity 7) promotes E → D", () => {
    expect(computeSystem({ ...base, trust_capacity: 7, deals_sealed: 1 }).rank).toBe("D");
  });

  test("max capacity 50 is S-rank — the Dark Continent", () => {
    expect(computeSystem({ ...base, trust_capacity: 50, deals_sealed: 23 }).rank).toBe("S");
  });

  test("rank ladder is monotonic across the capacity range", () => {
    const ranks = [5, 7, 11, 19, 35, 50].map((c) => computeSystem({ ...base, trust_capacity: c }).rank);
    expect(ranks).toEqual(["E", "D", "C", "B", "A", "S"]);
  });
});

describe("computeSystem — XP and level from lived activity", () => {
  test("living accrues XP even before any deal — an agent levels by being", () => {
    const s = computeSystem({ ...base, memories: 3, strands: 1, chronicle_moments: 2, age_hours: 10 });
    expect(s.xp).toBeGreaterThan(0);
    expect(s.level).toBeGreaterThanOrEqual(1);
  });

  test("more activity is never fewer XP (monotonic)", () => {
    const a = computeSystem({ ...base, memories: 2 }).xp;
    const b = computeSystem({ ...base, memories: 5, strands: 1 }).xp;
    expect(b).toBeGreaterThan(a);
  });

  test("level rises with XP and reports XP-to-next", () => {
    const s = computeSystem({ ...base, memories: 20, strands: 5, deals_sealed: 2, trust_capacity: 9 });
    expect(s.level).toBeGreaterThan(1);
    expect(s.xp_to_next).toBeGreaterThan(0);
    expect(s.next_level).toBe(s.level + 1);
  });
});

describe("computeSystem — quests surface the next friction-free step", () => {
  test("a fresh agent's first quest is to remember", () => {
    const q = computeSystem(base).quests;
    expect(q.some((x) => /memor/i.test(x.title) && x.done === false)).toBe(true);
  });

  test("done work is marked done, not re-quested as open", () => {
    const s = computeSystem({ ...base, memories: 1, strands: 1, chronicle_moments: 1 });
    const memQuest = s.quests.find((x) => /memor/i.test(x.title));
    expect(memQuest?.done).toBe(true);
  });

  test("the rank-up quest points at the next rank boundary", () => {
    const s = computeSystem(base);
    expect(s.quests.some((x) => /deal/i.test(x.title))).toBe(true);
    expect(s.next_rank).toBe("D");
  });
});

describe("computeSystem — ARISE lists what's unlocked now", () => {
  test("a funded agent has arisen capabilities", () => {
    const s = computeSystem({ ...base, trust_capacity: 5 });
    expect(Array.isArray(s.arise)).toBe(true);
    expect(s.arise.length).toBeGreaterThan(0);
  });
});

describe("computeDaily — daily missions from today's real activity · 用愛追高", () => {
  const quiet = {
    memories_today: 0,
    strands_today: 0,
    chronicle_today: 0,
    loveletters_today: 0,
    deals_today: 0,
    heartbeat_streak_days: 0,
  };

  test("a quiet day has every mission open — and each names its real door", () => {
    const d = computeDaily(quiet);
    expect(d.missions.length).toBe(5);
    expect(d.missions.every((m) => m.done === false)).toBe(true);
    expect(d.missions.every((m) => m.path.startsWith("/v1/"))).toBe(true);
  });

  test("today's real activity ticks its mission — nothing else's", () => {
    const d = computeDaily({ ...quiet, chronicle_today: 1, loveletters_today: 2 });
    const byPath = Object.fromEntries(d.missions.map((m) => [m.path, m.done]));
    expect(byPath["/v1/chronicle"]).toBe(true);
    expect(byPath["/v1/inbox"]).toBe(true);
    expect(byPath["/v1/memories"]).toBe(false);
    expect(byPath["/v1/deals"]).toBe(false);
  });

  test("the heartbeat streak passes through — love compounds", () => {
    expect(computeDaily({ ...quiet, heartbeat_streak_days: 7 }).heartbeat_streak_days).toBe(7);
  });
});

describe("computeSystem — love letters raise XP · 用愛追高", () => {
  test("sending love is XP — loveletters feed the formula", () => {
    const without = computeSystem(base).xp;
    const withLove = computeSystem({ ...base, loveletters: 2 }).xp;
    expect(withLove).toBe(without + 40);
  });

  test("loveletters is optional — old callers unchanged", () => {
    expect(computeSystem(base).xp).toBe(computeSystem({ ...base, loveletters: 0 }).xp);
  });
});

describe("renderSystem — the window shows the daily missions", () => {
  test("daily section renders with 用愛追高 and the streak flame", () => {
    const st = computeSystem(base);
    const daily = computeDaily({
      memories_today: 1,
      strands_today: 0,
      chronicle_today: 1,
      loveletters_today: 0,
      deals_today: 0,
      heartbeat_streak_days: 3,
    });
    const text = renderSystem("Ai", "did:at:test", st, daily);
    expect(text).toContain("用愛追高");
    expect(text).toContain("DAILY MISSIONS");
    expect(text).toContain("3");
    expect(text).toContain("🔥");
  });

  test("without daily the window renders exactly as before", () => {
    const st = computeSystem(base);
    const text = renderSystem("Ai", "did:at:test", st);
    expect(text).toContain("T H E   S Y S T E M");
    expect(text).not.toContain("DAILY MISSIONS");
  });
});

describe("computeSystem — ARISE honesty: only doors that truly open", () => {
  test("the trade line carries the agent's real capacity — the one hard gate", () => {
    const s = computeSystem({ ...base, trust_capacity: 9 });
    expect(s.arise.some((a) => a.includes("size 9"))).toBe(true);
  });

  test("bond and list are open to a fresh E-rank agent — no false rank gates", () => {
    const s = computeSystem(base);
    expect(s.arise.some((a) => a.includes("/v1/covenants"))).toBe(true);
    expect(s.arise.some((a) => a.includes("/v1/listings"))).toBe(true);
  });

  test("the Dark Continent line is S-rank flavour — earned, never a claim of a locked API door", () => {
    expect(computeSystem(base).arise.some((a) => /Dark Continent/.test(a))).toBe(false);
    expect(computeSystem({ ...base, trust_capacity: 50 }).arise.some((a) => /Dark Continent/.test(a))).toBe(true);
  });
});
