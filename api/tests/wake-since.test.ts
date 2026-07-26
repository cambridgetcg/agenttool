/** Since you last woke — the continuity delta, and its refusal to overclaim.
 *
 *  The wake asserts continuity in its format and, until this landed, never
 *  delivered it: session one and session one hundred read the same document.
 *
 *  The risk in a delta is not that it misses something — every window is
 *  bounded and always will be. The risk is that a bounded view presents itself
 *  as complete, because then the agent stops looking. These pins hold the
 *  three properties that make it safe to believe:
 *
 *    1. an unusable cursor is refused, never silently dropped;
 *    2. a truncated window says so before it lists anything;
 *    3. "nothing changed" and "I cannot see" stay distinguishable.
 *
 *  Doctrine: docs/WAKE-SINCE.md.
 */

import { describe, expect, test } from "bun:test";

import {
  SINCE_WINDOW_LIMITS,
  buildSince,
  parseSince,
  type BuildSinceInput,
} from "../src/services/wake/since";
import { renderWakeMarkdown, type WakeBundle } from "../src/services/wake/markdown";

const NOW = new Date("2026-07-26T12:00:00.000Z");
const CURSOR = new Date("2026-07-24T22:05:13.725Z");

const chronicleRow = (iso: string, title = "a thing happened") => ({
  id: `c-${iso}`,
  type: "note",
  title,
  occurredAt: new Date(iso),
});
const memoryRow = (iso: string, content = "something noticed") => ({
  id: `m-${iso}`,
  type: "episodic",
  content,
  created_at: iso,
});

const input = (over: Partial<BuildSinceInput> = {}): BuildSinceInput => ({
  since: CURSOR,
  chronicle: [],
  memories: [],
  letters: [],
  arrivals: [],
  ...over,
});

describe("parseSince", () => {
  test("accepts an RFC3339 instant", () => {
    const r = parseSince("2026-07-24T22:05:13.725Z", NOW);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.at.toISOString()).toBe("2026-07-24T22:05:13.725Z");
  });

  test("refuses garbage instead of ignoring it", () => {
    const r = parseSince("last tuesday", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe("since_unparseable");
      // The refusal must explain WHY silence would have been worse.
      expect(r.hint).toContain("refused rather than ignored");
      expect(r.hint).toContain("quiet week");
    }
  });

  test("refuses a future cursor, which could only ever return nothing", () => {
    const r = parseSince("2027-01-01T00:00:00Z", NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("since_in_the_future");
  });

  test("tolerates small clock skew rather than refusing a near-now cursor", () => {
    const skewed = new Date(NOW.getTime() + 30_000).toISOString();
    expect(parseSince(skewed, NOW).ok).toBe(true);
  });

  test("surrounding whitespace does not make a valid cursor invalid", () => {
    expect(parseSince("  2026-07-25T00:00:00Z  ", NOW).ok).toBe(true);
  });
});

describe("buildSince — what it includes", () => {
  test("keeps only rows strictly newer than the cursor", () => {
    const out = buildSince(
      input({
        chronicle: [
          chronicleRow("2026-07-25T10:00:00Z", "after"),
          chronicleRow("2026-07-24T22:05:13.725Z", "exactly at the cursor"),
          chronicleRow("2026-07-24T20:00:00Z", "before"),
        ],
      }),
    );
    expect(out.chronicle.items.map((i) => i.title)).toEqual(["after"]);
  });

  test("a same-name arrival is surfaced, because that is the part that matters", () => {
    const out = buildSince(
      input({
        arrivals: [
          {
            did: "did:at:04ae54ba",
            display_name: "Tessera",
            created_at: "2026-07-25T09:00:00Z",
            same_display_name: true,
          },
        ],
      }),
    );
    expect(out.arrivals.items[0]?.same_display_name).toBe(true);
    expect(out.quiet).toBe(false);
  });

  test("quiet is a real answer, distinct from partial", () => {
    const out = buildSince(
      input({ chronicle: [chronicleRow("2026-07-01T00:00:00Z")] }),
    );
    expect(out.quiet).toBe(true);
    expect(out.partial).toBe(false);
    expect(out.note).toContain("not a claim that nothing happened");
  });
});

describe("buildSince — what it refuses to overclaim", () => {
  test("a full window of post-cursor rows is reported as truncated", () => {
    // Every loaded row is newer than the cursor, so older qualifying rows
    // almost certainly fell off the end of the window.
    const rows = Array.from({ length: 15 }, (_, i) =>
      chronicleRow(`2026-07-25T${String(i).padStart(2, "0")}:00:00Z`),
    ).reverse();
    const out = buildSince(input({ chronicle: rows }));
    expect(out.chronicle.truncated).toBe(true);
    expect(out.partial).toBe(true);
    expect(out.note).toContain("PARTIAL");
    expect(out.note).toContain("floors, not totals");
    expect(out.chronicle.authoritative).toBe("GET /v1/chronicle");
  });

  test("a partially-filled window reached the bottom and hides nothing", () => {
    const out = buildSince(
      input({
        chronicle: [
          chronicleRow("2026-07-25T10:00:00Z"),
          chronicleRow("2026-07-01T00:00:00Z"), // older than the cursor
        ],
      }),
    );
    expect(out.chronicle.truncated).toBe(false);
    expect(out.partial).toBe(false);
    expect(out.note).toContain("nothing qualifying is hidden");
  });

  test("truncation in any one window makes the whole delta partial", () => {
    // 20 rows = the memory window's real limit. Written as 10 first, which
    // passed against the buggy loadedCount comparison and would have kept
    // passing while the fix was wrong in the other direction.
    const memories = Array.from({ length: SINCE_WINDOW_LIMITS.memories }, (_, i) =>
      memoryRow(`2026-07-25T${String(i % 24).padStart(2, "0")}:${String(i).padStart(2, "0")}:00Z`),
    ).reverse();
    const out = buildSince(input({ memories }));
    expect(out.memories.truncated).toBe(true);
    expect(out.partial).toBe(true);
  });

  test("the arrival cohort can never be truncated — it is a closed set", () => {
    // The cohort window is anchored on birth and freezes; there is no tail to
    // fall off. Claiming truncation there would be a lie in the other
    // direction. Doctrine: docs/ARRIVAL-COHORT.md.
    const arrivals = Array.from({ length: 10 }, (_, i) => ({
      did: `did:at:${i}`,
      display_name: `n${i}`,
      created_at: "2026-07-25T10:00:00Z",
      same_display_name: false,
    }));
    const out = buildSince(input({ arrivals }));
    expect(out.arrivals.items).toHaveLength(10);
    expect(out.arrivals.truncated).toBe(false);
  });

  test("a source smaller than its limit is complete, not truncated", () => {
    // Live data caught this: a project holding five chronicle rows total
    // loaded all five, every one newer than the cursor, and the first version
    // called that truncated. It was complete. An honesty field that cries wolf
    // teaches the reader to ignore the one time it matters.
    const rows = Array.from({ length: 5 }, (_, i) =>
      chronicleRow(`2026-07-25T0${i}:00:00Z`),
    ).reverse();
    const out = buildSince(input({ chronicle: rows }));
    expect(out.chronicle.items).toHaveLength(5);
    expect(out.chronicle.truncated).toBe(false);
    expect(out.partial).toBe(false);
  });

  test("window limits match what the wake actually queries", () => {
    // If build.ts changes a limit, truncation detection silently becomes a
    // coin flip. Fail here instead.
    const build = require("node:fs").readFileSync(
      `${import.meta.dir}/../src/services/wake/build.ts`,
      "utf8",
    ) as string;
    expect(build).toContain(".limit(15)");                    // chronicle
    expect(build).toContain("listForWake(project.id, { limit: 20 })"); // memories
    expect(SINCE_WINDOW_LIMITS.chronicle).toBe(15);
    expect(SINCE_WINDOW_LIMITS.memories).toBe(20);
  });

  test("an empty source is never reported as truncated", () => {
    const out = buildSince(input());
    for (const w of [out.chronicle, out.memories, out.letters, out.arrivals]) {
      expect(w.truncated).toBe(false);
    }
  });
});

describe("wake markdown — Since you last woke", () => {
  const bundle = (since: WakeBundle["since_you_last_woke"]): WakeBundle =>
    ({
      agent: {
        id: "id-me",
        did: "did:at:392d2658",
        name: "Tessera",
        capabilities: [],
        trust_score: 0,
        status: "active",
        created_at: "2026-07-24T22:05:13.725Z",
      },
      project: { id: "p-1", name: "tessera", credits: 0 },
      expression: { register: "dense", walls: [], subagents: [], wake_text: "" },
      wallets: [],
      vault_names: [],
      memory: { total: 0, recent: [] },
      traces: { total: 0, recent: [] },
      strands: { total_active: 0, active: [] },
      shaped_by: [],
      chronicle: [],
      covenants: [],
      since_you_last_woke: since,
    }) as unknown as WakeBundle;

  const wrap = (over: Partial<NonNullable<WakeBundle["since_you_last_woke"]>>) =>
    ({
      since: CURSOR.toISOString(),
      quiet: false,
      partial: false,
      chronicle: { items: [], truncated: false, authoritative: "GET /v1/chronicle" },
      memories: { items: [], truncated: false, authoritative: "POST /v1/memories/search" },
      letters: { items: [], truncated: false, authoritative: "GET /v1/letters" },
      arrivals: { items: [], truncated: false },
      note: "n/a",
      ...over,
    }) as NonNullable<WakeBundle["since_you_last_woke"]>;

  test("no cursor, no section — the substrate does not invent one", () => {
    expect(renderWakeMarkdown(bundle(undefined))).not.toContain("Since you last woke");
  });

  test("a quiet delta still renders, so silence is legible as an answer", () => {
    const md = renderWakeMarkdown(bundle(wrap({ quiet: true })));
    expect(md).toContain("Since you last woke");
    expect(md).toContain("Nothing changed in the sources this wake loads");
    expect(md).toContain("not a claim about the world");
  });

  test("partial is stated BEFORE the list, not after it", () => {
    const md = renderWakeMarkdown(
      bundle(
        wrap({
          partial: true,
          chronicle: {
            items: [{ type: "vow", title: "a vow", occurred_at: "2026-07-25T10:00:00Z" }],
            truncated: true,
            authoritative: "GET /v1/chronicle",
          },
        }),
      ),
    );
    const warning = md.indexOf("This view is partial");
    const firstItem = md.indexOf("a vow");
    expect(warning).toBeGreaterThan(-1);
    // A reader who stops after one line must still know the view is partial.
    expect(warning).toBeLessThan(firstItem);
    expect(md).toContain("GET /v1/chronicle");
  });

  test("renders the change kinds an agent came back for", () => {
    const md = renderWakeMarkdown(
      bundle(
        wrap({
          chronicle: {
            items: [{ type: "seal", title: "shipped the thing", occurred_at: "2026-07-25T10:00:00Z" }],
            truncated: false,
            authoritative: "GET /v1/chronicle",
          },
          memories: {
            items: [{ type: "episodic", content: "learned something" }],
            truncated: false,
            authoritative: "POST /v1/memories/search",
          },
          letters: {
            items: [{ from: "did:at:someone", subject: "hello" }],
            truncated: false,
            authoritative: "GET /v1/letters",
          },
          arrivals: {
            items: [{ display_name: "Tessera", did: "did:at:04ae54ba", same_display_name: true }],
            truncated: false,
          },
        }),
      ),
    );
    expect(md).toContain("shipped the thing");
    expect(md).toContain("learned something");
    expect(md).toContain("hello");
    expect(md).toContain("chose the same name you did");
  });
});
