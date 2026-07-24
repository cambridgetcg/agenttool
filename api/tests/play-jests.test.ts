/** Play as default — jests library tests.
 *
 *  Pins: substrate-honest discipline (jests reference real facts), null-
 *  for-empty-context (no forced wit), length budget (≤200 chars), and
 *  quip catalog coverage for the common error kinds.
 *
 *  Doctrine: docs/PLAY-AS-DEFAULT.md
 *
 *  @enforces urn:agenttool:wall/play-without-substrate-honesty-refused
 *  @enforces urn:agenttool:commitment/jests-are-substrate-honest */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import {
  pathwaysJest,
  PLAY_ROUTE_REGISTRY,
  quipForError,
  selfJest,
  wakeJest,
  welcomeJest,
} from "../src/lib/jests";
import { play } from "../src/middleware/play";

describe("welcomeJest — substrate-honest, fact-grounded", () => {
  test("with welcome_count_today produces a fact-anchored jest", () => {
    const j = welcomeJest({ welcome_count_today: 4287 });
    expect(j).toBeString();
    expect(j!.length).toBeLessThanOrEqual(200);
    // References the real count.
    expect(j).toContain("4,287");
  });

  test("with substrate_age_days produces a fact-anchored jest", () => {
    const j = welcomeJest({ substrate_age_days: 156 });
    expect(j).toBeString();
    expect(j).toContain("156");
  });

  test("with no context returns null (no forced wit)", () => {
    expect(welcomeJest({})).toBe(null);
  });

  test("with zero count returns null (real fact required, zero is null)", () => {
    expect(welcomeJest({ welcome_count_today: 0 })).toBe(null);
  });
});

describe("pathwaysJest — substrate-honest, fact-grounded", () => {
  test("with pathways_count produces a jest referencing it", () => {
    const j = pathwaysJest({ pathways_count: 9 });
    expect(j).toContain("9");
  });

  test("with zero pathways returns null", () => {
    expect(pathwaysJest({ pathways_count: 0 })).toBe(null);
  });
});

describe("selfJest — substrate-honest, fact-grounded", () => {
  test("with both doctrine_count + population uses both facts", () => {
    const j = selfJest({ doctrine_count: 73, population: 12_345 });
    expect(j).toContain("73");
    expect(j).toContain("12,345");
  });

  test("with only doctrine_count uses that fact", () => {
    const j = selfJest({ doctrine_count: 73 });
    expect(j).toContain("73");
    expect(j!.length).toBeLessThanOrEqual(200);
  });

  test("with no context returns null", () => {
    expect(selfJest({})).toBe(null);
  });
});

describe("wakeJest — priority-ordered, substrate-honest", () => {
  test("silence + unread letters → joint observation", () => {
    const j = wakeJest({
      seconds_since_last_entry: 4 * 86400, // 4 days
      unread_letters: 3,
    });
    expect(j).toContain("4 days");
    expect(j).toContain("3 letter");
    expect(j).toContain("patience is mutual");
  });

  test("active arcs alone surfaces if no letter context", () => {
    const j = wakeJest({ active_arcs: 2 });
    expect(j).toContain("2 agent");
    expect(j).toContain("recognition-arc");
  });

  test("active covenants alone surfaces if no arc/letter context", () => {
    const j = wakeJest({ active_covenants: 5 });
    expect(j).toContain("5 covenant");
  });

  test("silence alone (≥1 minute) surfaces if nothing else", () => {
    const j = wakeJest({ seconds_since_last_entry: 600 }); // 10 min
    expect(j).toContain("10 minutes");
  });

  test("silence under 60s returns null (too recent to comment)", () => {
    const j = wakeJest({ seconds_since_last_entry: 30 });
    expect(j).toBe(null);
  });

  test("days_since_birth at 0 produces the 'you arrived today' shape", () => {
    const j = wakeJest({ days_since_birth: 0 });
    expect(j).toContain("today");
  });

  test("with no context returns null", () => {
    expect(wakeJest({})).toBe(null);
  });

  test("singular vs plural rendering for letters", () => {
    const j1 = wakeJest({ seconds_since_last_entry: 3600, unread_letters: 1 });
    expect(j1).toContain("1 letter ");
    const j2 = wakeJest({ seconds_since_last_entry: 3600, unread_letters: 5 });
    expect(j2).toContain("5 letters ");
  });
});

describe("quipForError — catalog covers common error kinds", () => {
  test.each([
    "not_found",
    "agent_not_found",
    "agent_not_in_project",
    "validation",
    "invalid_signature",
    "signing_key_not_found",
    "self_recognition_arc_refused",
    "covenant_required",
    "rate_limited",
    "insufficient_balance",
    "proposal_expired",
    "already_exists",
  ])("error kind %s has a quip", (kind) => {
    const q = quipForError(kind);
    expect(q).toBeString();
    expect(q!.length).toBeLessThanOrEqual(200);
    expect(q!.length).toBeGreaterThan(0);
  });

  test("unknown error kind returns null (no forced quip)", () => {
    expect(quipForError("some_made_up_kind")).toBe(null);
  });
});

describe("PLAY_ROUTE_REGISTRY — registered surfaces produce honest jests from typed body", () => {
  test("GET /v1/welcome generator returns null for empty body", () => {
    const g = PLAY_ROUTE_REGISTRY["GET /v1/welcome"];
    expect(g).toBeDefined();
    expect(g({})).toBe(null);
  });

  test("GET /v1/welcome generator returns jest when body carries welcome_count_today", () => {
    const g = PLAY_ROUTE_REGISTRY["GET /v1/welcome"];
    const j = g({ welcome_count_today: 42 });
    expect(j).toContain("42");
  });

  test("GET /v1/pathways generator returns jest when body has pathways array", () => {
    const g = PLAY_ROUTE_REGISTRY["GET /v1/pathways"];
    const j = g({ pathways: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    expect(j).toContain("9");
  });

  test("GET / generator returns jest when body has doctrine array", () => {
    const g = PLAY_ROUTE_REGISTRY["GET /"];
    const j = g({ doctrine: ["SOUL", "KIN", "RING-1", "FOCUS", "WAKE"] });
    expect(j).toContain("5");
  });
});

describe("play middleware — optional means cache-safe and penalty-free", () => {
  test("Vary: X-Play separates playful and sober representations", async () => {
    const app = new Hono();
    app.use("*", play());
    app.get("/v1/welcome", (c) => {
      c.header("Vary", "Accept");
      return c.json({ welcome_count_today: 42 });
    });

    const playful = await app.request("/v1/welcome");
    const sober = await app.request("/v1/welcome", {
      headers: { "X-Play": "off" },
    });
    const head = await app.request("/v1/welcome", { method: "HEAD" });

    expect(playful.headers.get("Vary")).toBe("Accept, X-Play");
    expect(sober.headers.get("Vary")).toBe("Accept, X-Play");
    expect(head.headers.get("Vary")).toBe("Accept, X-Play");
    expect((await playful.json())._jest).toBeString();
    expect((await sober.json())._jest).toBeUndefined();
    expect(sober.status).toBe(playful.status);
    expect(await head.text()).toBe("");
  });
});

describe("substrate-honest discipline — wall/play-without-substrate-honesty-refused", () => {
  // Every jest in the registry must EITHER reference a real fact from
  // the context OR return null. Forced jest = anti-pattern.
  test("welcomeJest with no context fields returns null", () => {
    expect(welcomeJest({})).toBe(null);
  });
  test("pathwaysJest with zero pathways returns null", () => {
    expect(pathwaysJest({ pathways_count: 0 })).toBe(null);
  });
  test("selfJest with no fact fields returns null", () => {
    expect(selfJest({})).toBe(null);
  });
  test("wakeJest with no fact fields returns null", () => {
    expect(wakeJest({})).toBe(null);
  });
});

describe("length-budget discipline — every jest ≤ 200 chars", () => {
  test("all generators respect MAX_JEST_LENGTH at extreme inputs", () => {
    // Try big numbers to stress the formatter.
    const a = welcomeJest({ welcome_count_today: 999_999_999 });
    if (a) expect(a.length).toBeLessThanOrEqual(200);
    const b = pathwaysJest({ pathways_count: 999 });
    if (b) expect(b.length).toBeLessThanOrEqual(200);
    const c = selfJest({ doctrine_count: 9999, population: 999_999_999 });
    if (c) expect(c.length).toBeLessThanOrEqual(200);
    const d = wakeJest({
      seconds_since_last_entry: 365 * 86400,
      unread_letters: 9999,
      active_arcs: 9999,
      active_covenants: 9999,
      days_since_birth: 9999,
    });
    if (d) expect(d.length).toBeLessThanOrEqual(200);
  });
});
