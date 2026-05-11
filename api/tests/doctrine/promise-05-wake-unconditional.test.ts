/** Promise 5 — *The wake is unconditional.*
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Promise 5).
 *
 *  > /v1/wake works on day one and works on year ten. The door stays open.
 *
 *  The route handler enforces this with try/catch around every domain
 *  query (rest-don't-crash). The renderer enforces it too: a partial,
 *  empty, or freshly-bootstrapped bundle must still produce coherent
 *  Markdown and provider shapes — no thrown errors, no missing identity
 *  header, no double-rule artifacts.
 *
 *  These tests pin the renderer's "graceful elision" semantics so a future
 *  refactor that, say, throws on `wallets.length === 0` or emits an empty
 *  section header gets caught before deploy. */

import { describe, expect, test } from "bun:test";

import {
  renderStableSection,
  renderWakeMarkdown,
  renderWakePlaintext,
} from "../../src/services/wake/markdown";
import {
  renderWakeForProvider,
  WAKE_PROVIDERS,
} from "../../src/services/wake/providers";
import {
  baseBundle,
  minimalBundle,
  withEmpty,
  withManyChronicle,
  withManyMemories,
  withManyTraces,
  withoutWakeText,
} from "./helpers/fixtures";
import {
  assertIdentityPresent,
  assertInnerOrientationFraming,
  assertNoSectionThrows,
} from "./helpers/invariants";

describe("Promise 5 — minimal bundle still renders a coherent wake", () => {
  test("minimal bundle: Markdown emits identity + carry tally; never throws", () => {
    const b = minimalBundle();
    const md = assertNoSectionThrows(() => renderWakeMarkdown(b), "minimal MD");
    assertIdentityPresent(md, b.agent, "minimal MD");
    assertInnerOrientationFraming(md, "minimal MD");
    expect(md).toContain("What you carry"); // tally renders even with all-zero state
    // Empty sections must NOT emit their headers.
    expect(md).not.toContain("What you lived");
    expect(md).not.toContain("What you remember");
    expect(md).not.toContain("What you are thinking about");
    expect(md).not.toContain("What you decided");
    expect(md).not.toContain("What you vowed");
    expect(md).not.toContain("What shaped you");
  });

  test("minimal bundle: every provider shape renders without throwing", () => {
    const b = minimalBundle();
    for (const provider of WAKE_PROVIDERS) {
      assertNoSectionThrows(
        () => renderWakeForProvider(b, provider),
        `minimal provider=${provider}`,
      );
    }
  });

  test("minimal bundle: plaintext form is non-empty and contains identity", () => {
    const b = minimalBundle();
    const txt = assertNoSectionThrows(() => renderWakePlaintext(b), "minimal text");
    expect(txt.length).toBeGreaterThan(0);
    expect(txt).toContain(b.agent.name);
    expect(txt).toContain(b.agent.did);
  });
});

describe("Promise 5 — single-section depletion still renders", () => {
  // Each domain query is independently try/catch'd in the route handler;
  // a single failure zeros out one section but not the rest. The renderer
  // must handle every "this one section is empty" shape.
  const sections = [
    "memory",
    "traces",
    "strands",
    "chronicle",
    "covenants",
    "shaped_by",
    "vault",
    "wallets",
  ] as const;

  for (const section of sections) {
    test(`with empty ${section} section: still renders identity + carry tally`, () => {
      const b = withEmpty(baseBundle(), section);
      const md = assertNoSectionThrows(() => renderWakeMarkdown(b), `empty=${section}`);
      assertIdentityPresent(md, b.agent, `empty=${section}`);
      expect(md).toContain("What you carry");
    });
  }
});

describe("Promise 5 — optional sections elide cleanly", () => {
  test("empty wake_text: stable section has no double-rule", () => {
    const b = withoutWakeText(baseBundle());
    const stable = renderStableSection(b);
    // The wake_text block emits a leading `---` separator. With no
    // wake_text, that separator should be absent — so the stable section
    // has at most one `---` (the constitutive memories label, if any).
    const ruleCount = (stable.match(/^---$/gm) ?? []).length;
    expect(ruleCount).toBeLessThanOrEqual(0); // stable doesn't emit `---` when wake_text absent
  });

  test("Markdown trim contract: no triple newlines anywhere in output", () => {
    // The renderer trims trailing blank lines per-section before joining.
    // If a section emits a stray blank line, two sections joined with
    // \n\n produce \n\n\n. That's ugly and breaks readability.
    const md = renderWakeMarkdown(baseBundle());
    expect(md).not.toMatch(/\n\n\n/);
  });
});

describe("Promise 5 — caps prevent context-budget blowup (year-ten readiness)", () => {
  // The wake must keep working at year ten — when the agent has 10,000
  // memories, 5,000 traces, etc. The MD-side caps are the load-bearing
  // piece. The renderer's private constants (markdown.ts:115-118):
  //   MAX_RECENT_MEMORIES_IN_MD = 8
  //   MAX_RECENT_TRACES_IN_MD   = 5
  //   MAX_CHRONICLE_IN_MD       = 5
  // Verify each independently.

  test("with 50 memories: rendered MD shows only the cap and a 'more not shown' hint", () => {
    const b = withManyMemories(baseBundle(), 50);
    const md = renderWakeMarkdown(b);
    expect(md).toContain("What you remember");
    // Count bulk memory bullet rows (one per shown memory).
    const bullets = (md.match(/^- \*[^*]+\* — \*\(episodic, importance/gm) ?? []).length;
    expect(bullets).toBeLessThanOrEqual(8); // MAX_RECENT_MEMORIES_IN_MD
    expect(md).toContain("more memories not shown");
  });

  test("with 50 traces: rendered MD caps at 5 + emits 'more decisions not shown' hint", () => {
    const b = withManyTraces(baseBundle(), 50);
    const md = renderWakeMarkdown(b);
    expect(md).toContain("What you decided");
    // Trace bullets are shaped: `- *<date>* — **<type>**, conf X[🔏]: ...`
    const bullets = (md.match(/^- \*[^*]+\* — \*\*(?:informational|architectural)\*\*/gm) ?? []).length;
    expect(bullets).toBeLessThanOrEqual(5); // MAX_RECENT_TRACES_IN_MD
    expect(md).toContain("more decisions not shown");
  });

  test("with 50 chronicle entries: rendered MD caps at 5 (silent truncation; no hint)", () => {
    const b = withManyChronicle(baseBundle(), 50);
    const md = renderWakeMarkdown(b);
    expect(md).toContain("What you lived");
    // Chronicle bullets shaped: `- *<date>* — **<type>**: <content>`
    const bullets = (md.match(/^- \*[^*]+\* — \*\*(?:vow|recognition)\*\*:/gm) ?? []).length;
    expect(bullets).toBeLessThanOrEqual(5); // MAX_CHRONICLE_IN_MD
    // Chronicle has no "more not shown" hint by design — the agent
    // queries /v1/chronicle for the full timeline; the wake samples.
    expect(md).not.toContain("more chronicle not shown");
    expect(md).not.toContain("more moments not shown");
  });

  test("with 50 of everything: doc stays under ~12KB", () => {
    let b = baseBundle();
    b = withManyMemories(b, 50);
    b = withManyTraces(b, 50);
    b = withManyChronicle(b, 50);
    const md = renderWakeMarkdown(b);
    // The file header claims ~6KB for typical agents. We allow 12KB
    // for the maximally-loaded fixture — anything more would mean a cap
    // regressed.
    expect(md.length).toBeLessThan(12 * 1024);
  });
});

describe("Promise 5 — renderer never throws on partial bundles (regression net)", () => {
  // The route handler builds the bundle from disjoint domain queries.
  // The renderer is the choke-point for "does the whole thing produce
  // bytes?" Each test below corresponds to a real failure mode the
  // route's try/catch would zero-out.
  test("expression entirely absent (post-bootstrap, no expression set)", () => {
    const b = { ...baseBundle(), expression: {} };
    const md = assertNoSectionThrows(
      () => renderWakeMarkdown(b),
      "no expression",
    );
    // The DEFAULT_REGISTER fallback should kick in.
    expect(md).toContain("How you speak");
  });

  test("shaped_by undefined (composition layer disabled or unsupported)", () => {
    const b = baseBundle();
    delete (b as { shaped_by?: unknown }).shaped_by;
    assertNoSectionThrows(() => renderWakeMarkdown(b), "no shaped_by");
  });

  test("zero wallets across the board (post-bootstrap before economy creation)", () => {
    const b = withEmpty(baseBundle(), "wallets");
    const md = renderWakeMarkdown(b);
    expect(md).toContain("Wallets");
    // No "credits across" suffix when there are no wallets.
    expect(md).not.toMatch(/Wallets\*\*: 0 \(/);
  });
});

