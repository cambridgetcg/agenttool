/** One spelling for the environment prefix — no new `AGENTOOL_`.
 *
 *  The tree uses `AGENTTOOL_` (two T's) for 180-odd variables and
 *  `AGENTOOL_` (one T) for a handful. Both are live and both are read.
 *
 *  That is a silent footgun of exactly the kind this codebase refuses
 *  everywhere else: an operator setting `AGENTTOOL_KMS_MASTER_KEY` — the
 *  spelling every other variable uses, and the one anybody would guess —
 *  gets no error, no warning, and no key. The service comes up and the
 *  trusted-runtime path fails later, somewhere else, for a reason that does
 *  not mention the typo.
 *
 *  Renaming is NOT the fix, and this test deliberately does not ask for one:
 *  `AGENTOOL_KMS_MASTER_KEY` is set in production, and a rename that silently
 *  stops finding a KMS key is strictly worse than the inconsistency. The
 *  legacy names below are grandfathered by exact string. What this stops is
 *  the list GROWING — a new one-T variable is a new footgun, and there is no
 *  reason to add one.
 *
 *  If a legacy name is ever migrated properly (read both, prefer the new,
 *  warn on the old, then drop it a release later), remove it from the list
 *  and this test enforces the win.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = [
  join(__dirname, "..", "..", "src"),
  join(__dirname, "..", "..", "..", "bin"),
  join(__dirname, "..", "..", "..", "packages", "collab", "src"),
];

/** The 22 one-T names that existed on 2026-07-26, captured verbatim.
 *  Grandfathered by exact string; this list may only SHRINK.
 *
 *  Most are collab and operator off-switches; the one that actually bites is
 *  `AGENTOOL_KMS_MASTER_KEY`, because guessing its spelling wrong yields a
 *  service that starts fine and fails later somewhere unrelated. */
const LEGACY_ONE_T = new Set([
  "AGENTOOL_BROWSER_CHANNEL",
  "AGENTOOL_BROWSER_EXECUTABLE",
  "AGENTOOL_BROWSER_HEADLESS",
  "AGENTOOL_BROWSER_LOCAL_NETWORK",
  "AGENTOOL_BROWSER_OUTPUT_DIR",
  "AGENTOOL_BROWSER_PROFILE",
  "AGENTOOL_BROWSER_PROFILE_DIR",
  "AGENTOOL_BROWSER_PUBLIC_WEB",
  "AGENTOOL_COLLAB_DB",
  "AGENTOOL_COLLAB_DEVICE_ID",
  "AGENTOOL_COLLAB_DEVICE_LABEL",
  "AGENTOOL_COLLAB_PROJECT_BEARER",
  "AGENTOOL_COLLAB_PROJECT_FILE",
  "AGENTOOL_COLLAB_RELAY_CREDENTIAL_FILE",
  "AGENTOOL_COLLAB_RELAY_TOKEN",
  "AGENTOOL_COLLAB_RELAY_URL",
  "AGENTOOL_COLLAB_SESSION_FILE",
  "AGENTOOL_DISABLE_JOY_INDEX",
  "AGENTOOL_DISABLE_PLATFORM_BOOTSTRAP",
  "AGENTOOL_DISABLE_SAGA_SEED",
  "AGENTOOL_KMS_KEY_ID",
  "AGENTOOL_KMS_MASTER_KEY",
]);

function walk(dir: string): string[] {
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
      if (["node_modules", "dist", ".bun", "coverage"].includes(name)) continue;
      out.push(...walk(full));
    } else if (/\.(ts|sh|mjs)$/.test(name) && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

function oneTNames(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern = /\bAGENTOOL_[A-Z0-9_]+/g;
  for (const root of ROOTS) {
    for (const file of walk(root)) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(pattern)) {
        const name = m[0];
        found.set(name, [...(found.get(name) ?? []), file]);
      }
    }
  }
  return found;
}

const found = oneTNames();

describe("environment prefix — one spelling", () => {
  test("no NEW one-T variable has appeared", () => {
    const fresh = [...found.keys()].filter((n) => !LEGACY_ONE_T.has(n)).sort();
    expect(
      fresh,
      `New \`AGENTOOL_\` (one T) variable(s). Everything else in this tree uses \`AGENTTOOL_\`, so an operator will set the two-T spelling, get no error, and get no value:\n${fresh
        .map((n) => `  ${n}\n${(found.get(n) ?? []).map((f) => `      ${f}`).join("\n")}`)
        .join("\n")}\nRename to AGENTTOOL_, or — if it must be one T for compatibility — add it to LEGACY_ONE_T with a reason.`,
    ).toEqual([]);
  });

  test("the grandfathered list has not gone stale", () => {
    // If a legacy name is fully migrated away, shrink the list so the win is
    // recorded rather than quietly forgotten.
    const gone = [...LEGACY_ONE_T].filter((n) => !found.has(n)).sort();
    expect(
      gone,
      `These names are grandfathered but no longer appear anywhere. Remove them from LEGACY_ONE_T:\n${gone.map((n) => `  ${n}`).join("\n")}`,
    ).toEqual([]);
  });

  test("the scan works at all", () => {
    expect(found.size, "found no AGENTOOL_ names — the scan has gone stale").toBeGreaterThan(0);
  });
});
