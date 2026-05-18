/** Wall — poker-face-leaks-nothing.
 *
 *  Canon: agenttool:wall/poker-face-leaks-nothing (docs/agenttool.jsonld)
 *  Doctrine: docs/POKER-FACE.md
 *
 *  > breaks_if (from canon):
 *  > "any public read endpoint returns a `total_count`, `private_count`,
 *  > `hidden_count`, or similar field that exceeds the visible list length;
 *  > or the public profile carries a `poker_face: true` boolean; or
 *  > `/public/agents/:did/pulse` surfaces a private-play-derived metric"
 *
 *  Source-level invariant — scans public-surface route files for
 *  forbidden field names. Crystallized 2026-05-18.
 *
 *  urn:agenttool:wall/poker-face-leaks-nothing */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const PUBLIC_ROUTES_DIR = join(REPO_ROOT, "api", "src", "routes", "public");
const WALL_URN = "urn:agenttool:wall/poker-face-leaks-nothing";

function walkTs(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("wall/poker-face-leaks-nothing", () => {
  test("public-route files do not surface private-content counts", () => {
    // The wall: public surfaces show what's visible. They never
    // disclose a count or flag of what's filtered out — not even via
    // suggestive field names that an attacker could correlate.
    const files = walkTs(PUBLIC_ROUTES_DIR);
    expect(files.length).toBeGreaterThan(0);

    const forbidden = [
      "private_count",
      "hidden_count",
      "filtered_count",
      "private_total",
      "hidden_total",
      "private_visible_diff",
      "you_have_n_private",
    ];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      for (const term of forbidden) {
        if (src.includes(term)) {
          throw new Error(
            `wall/poker-face-leaks-nothing breached: ${file} mentions "${term}". ` +
              `Public surfaces must not disclose filtered-content tallies. ` +
              `If you need a count, surface the *visible* list length only — never the difference between visible and total.`,
          );
        }
      }
    }
  });

  test("public profile route does not carry a poker_face flag", () => {
    // The public profile at /public/agents/:did is the canonical
    // identity surface. It must not telegraph the poker-face state.
    const path = join(REPO_ROOT, "api", "src", "routes", "public", "agents.ts");
    let src: string;
    try {
      src = readFileSync(path, "utf8");
    } catch {
      // If the file doesn't exist, the wall holds trivially.
      return;
    }
    // The agent's poker_face_default is internal disposition state —
    // not a public profile field. The wall forbids exposing it on
    // unauthenticated reads.
    const forbiddenFlags = [
      "poker_face: true",
      "poker_face: agent.pokerFaceDefault",
      "poker_face_default: agent.pokerFaceDefault",
    ];
    for (const term of forbiddenFlags) {
      expect(src).not.toContain(term);
    }
  });

  test("canon entry exists with required fields", () => {
    const canonPath = join(REPO_ROOT, "docs", "agenttool.jsonld");
    const canon = readFileSync(canonPath, "utf8");
    expect(canon).toContain(WALL_URN.slice(4)); // short form: agenttool:wall/poker-face-leaks-nothing
    // Canonical fields the polymorph-ratchet test checks for.
    const expectations = [
      '"crystallized_at": "2026-05-18"',
      '"predecessor_form"',
      '"doctrine_doc": "agenttool:doc/POKER-FACE"',
    ];
    for (const e of expectations) {
      expect(canon).toContain(e);
    }
  });
});
