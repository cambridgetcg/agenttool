/** Opening-summary convention — a bounded static-doc skim surface.
 *  docs/CONVENTIONS.md permits either TL;DR or Purpose in the opening header.
 *  The summary follows H1 and precedes an optional italicized thesis; a Type
 *  label may precede it. Presence, position, and the existing 400-character
 *  maximum stay enforced for the required documents.
 *
 *  This extends the older TL;DR-only convention in AGENT-WEB-SURFACE.md.
 *  A document with a concise Purpose need not repeat it under another label.
 *  Removing a required document's summary still fails CI. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS = join(REPO_ROOT, "docs");

/** Docs that MUST carry an opening summary. Extend this list as the convention
 *  spreads across the corpus; each entry becomes a build-enforced contract. */
const REQUIRED_SUMMARY = [
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

const SUMMARY_LINE = /^>\s*\*\*(?:TL;DR|Purpose):\*\*\s+\S/;
const H1_LINE = /^#\s+\S/;
const ITALIC_THESIS_LINE = /^>\s*\*[^*]/;
const SUMMARY_MAX_LEN = 400; // Existing maximum; aim for 300 characters.

function loadDoc(filename: string): { path: string; lines: string[] } {
  const path = join(DOCS, filename);
  const lines = readFileSync(path, "utf8").split("\n");
  return { path, lines };
}

function findSummaryIndex(lines: string[]): number {
  return lines.findIndex((line) => SUMMARY_LINE.test(line));
}

function findH1Index(lines: string[]): number {
  return lines.findIndex((line) => H1_LINE.test(line));
}

// ── Presence ────────────────────────────────────────────────────────────

describe("Opening-summary convention — presence on every required doc", () => {
  for (const filename of REQUIRED_SUMMARY) {
    test(`${filename} carries a TL;DR or Purpose summary`, () => {
      const { lines } = loadDoc(filename);
      const summaryIdx = findSummaryIndex(lines);
      expect(summaryIdx).toBeGreaterThanOrEqual(0);
    });
  }
});

// ── Position — Summary sits after H1, before the italicized thesis ────────

describe("Opening-summary convention — position vs H1 and thesis", () => {
  for (const filename of REQUIRED_SUMMARY) {
    test(`${filename}: summary appears after H1`, () => {
      const { lines } = loadDoc(filename);
      const h1Idx = findH1Index(lines);
      const summaryIdx = findSummaryIndex(lines);
      expect(h1Idx).toBeGreaterThanOrEqual(0);
      expect(summaryIdx).toBeGreaterThan(h1Idx);
    });

    test(`${filename}: summary appears before any italicized thesis blockquote`, () => {
      const { lines } = loadDoc(filename);
      const summaryIdx = findSummaryIndex(lines);
      const thesisIdx = lines.findIndex(
        (line, i) => i > findH1Index(lines) && ITALIC_THESIS_LINE.test(line),
      );
      if (thesisIdx >= 0) {
        expect(summaryIdx).toBeLessThan(thesisIdx);
      }
      // Without an italicized thesis there is no second boundary to compare.
      // The summary-after-H1 test still applies.
    });
  }
});

// ── Length — Summary fits the budget (one-sentence summary) ───────────────

describe("Opening-summary convention — length budget", () => {
  for (const filename of REQUIRED_SUMMARY) {
    test(`${filename}: summary line ≤ ${SUMMARY_MAX_LEN} chars`, () => {
      const { lines } = loadDoc(filename);
      const summaryIdx = findSummaryIndex(lines);
      expect(summaryIdx).toBeGreaterThanOrEqual(0);
      expect(lines[summaryIdx].length).toBeLessThanOrEqual(SUMMARY_MAX_LEN);
    });
  }
});

// ── Single skim entry — the documented one-liner actually works ─────────

describe("Opening-summary convention — discoverable by the documented one-liner", () => {
  test("every required doc matches the documented skim pattern", () => {
    // CONVENTIONS.md documents an anchored rg pattern for both labels.
    // Match that recipe independently of the summary locator above.
    const skimRegex = /^>\s*\*\*(TL;DR|Purpose):\*\*\s+\S/;
    for (const filename of REQUIRED_SUMMARY) {
      const { lines } = loadDoc(filename);
      const matched = lines.some((line) => skimRegex.test(line));
      expect(matched).toBe(true);
    }
  });
});
