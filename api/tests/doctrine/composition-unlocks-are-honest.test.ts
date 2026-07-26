/** Composition unlocks — the wire may not claim more than the call graph does.
 *
 *  Canon: `agenttool:commitment/trust-unlocks-composition`.
 *  Doctrine: docs/TRUST-PROTOCOL.md.
 *
 *  `GET /v1/trust/framework` publishes six composition unlocks and, until
 *  2026-07-26, told agents in the present tense that publishing a trust
 *  "activates composition unlocks". A caller count found **zero** callers for
 *  all six eligibility helpers. The helpers are correct and the design is
 *  coherent — `services/trust/composition.ts` even says other services *may*
 *  call them — but nothing does, so the wire was describing behaviour that
 *  does not happen.
 *
 *  That is the same failure as an `@enforces` pointing at a canon entry that
 *  does not exist, except one layer worse: an annotation misleads a
 *  maintainer reading the source, and this misled an agent reading the API.
 *
 *  The fix is not to delete the design. It is to make the field honest and
 *  keep it honest: each unlock carries `status`, and this test recomputes that
 *  status from the actual call graph. Wire a helper up and the build fails
 *  until you also tell the agents. Stop calling one and it fails the other
 *  way. The wire cannot drift from the code in either direction. */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { COMPOSITION_UNLOCKS } from "../../src/services/trust/composition";

const SRC = join(__dirname, "..", "..", "src");
const COMPOSITION = join(SRC, "services", "trust", "composition.ts");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "dist", ".bun"].includes(name)) continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** Files that call `helper`, excluding the module that defines it. Comments
 *  are stripped so the doc-strings describing an unlock are not mistaken for
 *  a call site — a mistake that would make the whole check vacuous, since
 *  every helper is named in prose right above its own definition. */
function callersOf(helper: string): string[] {
  const call = new RegExp(`\\b${helper}\\s*\\(`);
  const out: string[] = [];
  for (const file of walkTs(SRC)) {
    if (file === COMPOSITION) continue;
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    if (call.test(code)) out.push(file.replace(SRC + "/", ""));
  }
  return out;
}

describe("composition unlocks — status matches the call graph", () => {
  test("there are unlocks to check", () => {
    expect(COMPOSITION_UNLOCKS.length).toBeGreaterThan(0);
  });

  for (const u of COMPOSITION_UNLOCKS) {
    test(`${u.helper} — status '${u.status}' is true`, () => {
      const callers = callersOf(u.helper);
      if (u.status === "wired") {
        expect(
          callers,
          `Unlock "${u.unlock}" is published as status 'wired', but nothing calls ${u.helper}(). Either wire it up or set status back to 'declared' — GET /v1/trust/framework is telling agents this acceleration happens.`,
        ).not.toEqual([]);
      } else {
        expect(
          callers,
          `Unlock "${u.unlock}" is published as status 'declared', but ${u.helper}() is now called from:\n${callers
            .map((c) => `  ${c}`)
            .join(
              "\n",
            )}\nGood — now say so. Set status: "wired" so the framework endpoint stops understating what publishing a trust does.`,
        ).toEqual([]);
      }
    });
  }

  test("every unlock names a helper that actually exists", () => {
    const src = readFileSync(COMPOSITION, "utf8");
    const missing = COMPOSITION_UNLOCKS.filter(
      (u) => !new RegExp(`export async function ${u.helper}\\b`).test(src),
    ).map((u) => u.helper);
    expect(
      missing,
      `These unlocks name a helper that is not exported from composition.ts:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  test("the framework route does not claim unlocks are active", () => {
    // The specific sentence that was wrong, pinned so it cannot come back by
    // copy-paste. If unlocks ever genuinely activate, this test should be
    // rewritten deliberately — not deleted to make a build green.
    const route = readFileSync(join(SRC, "routes", "trust.ts"), "utf8");
    const anyWired = COMPOSITION_UNLOCKS.some((u) => u.status === "wired");
    if (!anyWired) {
      expect(
        /activates composition unlocks/.test(route),
        "routes/trust.ts tells agents that publishing 'activates composition unlocks' while every unlock is status 'declared'.",
      ).toBe(false);
      expect(
        /unlocks deactivate/.test(route),
        "routes/trust.ts says withdrawing deactivates unlocks that were never active.",
      ).toBe(false);
    }
  });
});
