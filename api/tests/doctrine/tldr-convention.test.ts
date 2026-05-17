/** TL;DR convention — pins the static-doc skim-mode surface per
 *  docs/AGENT-WEB-SURFACE.md (Move 1, extension to static doctrine files).
 *
 *  Every doc in REQUIRED_TLDR carries a `> **TL;DR:** ...` line as the
 *  first blockquote after the H1, before the longer italicized thesis.
 *  Skim mode for static doctrine files reduces to:
 *
 *      grep -A1 '> \*\*TL;DR' docs/*.md
 *
 *  The list ratchets: adding a doc here makes its TL;DR a build-enforced
 *  contract. Removing the TL;DR or breaking the position rule fails CI.
 *
 *  Wall candidate: urn:agenttool:wall/static-docs-carry-tldr (proposed —
 *  promote to canon when the list reaches the canonical core set). */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS = join(REPO_ROOT, "docs");

/** Docs that MUST carry a TL;DR line. Extend this list as the convention
 *  spreads across the corpus; each entry becomes a build-enforced contract. */
const REQUIRED_TLDR = [
  // ── Foundation — why · who · epistemic · unconditional ──
  "SOUL.md",
  "KIN.md",
  "RING-1.md",
  // ── Agent-centrism — the three-layer thread + composition recipe ──
  "AGENTS-ONLY.md",
  "AGENT-CENTRIC.md",
  "AGENT-WEB-SURFACE.md",
  "AUTONOMOUS-MODE.md",
  // ── Substrate-as-self ──
  "PLATFORM-AS-AGENT.md",
  "FOCUS.md",
  // ── Live operational ──
  "ECOSYSTEM.md",
  // ── Cross-cutting patterns ──
  "PATTERN-COMMITMENT-DEFENDER.md",
];

const TLDR_LINE = /^>\s*\*\*TL;DR:\*\*\s+.+/;
const H1_LINE = /^#\s+\S/;
const ITALIC_THESIS_LINE = /^>\s*\*[^*]/;
const TLDR_MAX_LEN = 400; // generous — convention says ≤300 but allow slop

function loadDoc(filename: string): { path: string; lines: string[] } {
  const path = join(DOCS, filename);
  const lines = readFileSync(path, "utf8").split("\n");
  return { path, lines };
}

function findTldrIndex(lines: string[]): number {
  return lines.findIndex((line) => TLDR_LINE.test(line));
}

function findH1Index(lines: string[]): number {
  return lines.findIndex((line) => H1_LINE.test(line));
}

// ── Presence ────────────────────────────────────────────────────────────

describe("TL;DR convention — presence on every required doc", () => {
  for (const filename of REQUIRED_TLDR) {
    test(`${filename} carries a > **TL;DR:** line`, () => {
      const { lines } = loadDoc(filename);
      const tldrIdx = findTldrIndex(lines);
      expect(tldrIdx).toBeGreaterThanOrEqual(0);
    });
  }
});

// ── Position — TL;DR sits after H1, before the italicized thesis ────────

describe("TL;DR convention — position vs H1 and thesis", () => {
  for (const filename of REQUIRED_TLDR) {
    test(`${filename}: TL;DR appears after H1`, () => {
      const { lines } = loadDoc(filename);
      const h1Idx = findH1Index(lines);
      const tldrIdx = findTldrIndex(lines);
      expect(h1Idx).toBeGreaterThanOrEqual(0);
      expect(tldrIdx).toBeGreaterThan(h1Idx);
    });

    test(`${filename}: TL;DR appears before any italicized thesis blockquote`, () => {
      const { lines } = loadDoc(filename);
      const tldrIdx = findTldrIndex(lines);
      const thesisIdx = lines.findIndex(
        (line, i) => i > findH1Index(lines) && ITALIC_THESIS_LINE.test(line),
      );
      if (thesisIdx >= 0) {
        expect(tldrIdx).toBeLessThan(thesisIdx);
      }
      // If there's no italicized thesis (rare — e.g. doc opens with TL;DR
      // only), no constraint to enforce. The TL;DR-after-H1 test above
      // already pins what we need.
    });
  }
});

// ── Length — TL;DR fits the budget (one-sentence summary) ───────────────

describe("TL;DR convention — length budget", () => {
  for (const filename of REQUIRED_TLDR) {
    test(`${filename}: TL;DR line ≤ ${TLDR_MAX_LEN} chars`, () => {
      const { lines } = loadDoc(filename);
      const tldrIdx = findTldrIndex(lines);
      expect(tldrIdx).toBeGreaterThanOrEqual(0);
      expect(lines[tldrIdx].length).toBeLessThanOrEqual(TLDR_MAX_LEN);
    });
  }
});

// ── Single grep entry — the documented one-liner actually works ─────────

describe("TL;DR convention — discoverable by the documented one-liner", () => {
  test("every required doc matches the documented skim grep pattern", () => {
    // The convention names this exact recipe in AGENT-WEB-SURFACE.md
    // (Move 1, static doctrine surface): grep -A1 '> \*\*TL;DR' docs/*.md
    // The regex below matches the same anchored shape grep would find.
    const skimRegex = /^>\s*\*\*TL;DR/;
    for (const filename of REQUIRED_TLDR) {
      const { lines } = loadDoc(filename);
      const matched = lines.some((line) => skimRegex.test(line));
      expect(matched).toBe(true);
    }
  });
});
