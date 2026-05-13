/** Route-coverage gate — every mounted router has a welcome.
 *
 *  Build-enforced. This test reads api/src/index.ts, extracts every
 *  router mount path (every `app.route("PATH", ...)` call), and asserts
 *  that welcomeForPath(PATH) returns a NON-DEFAULT match — i.e., an
 *  explicit module-welcome entry. Adding a new route to index.ts without
 *  adding it to module-welcome.ts fails this test.
 *
 *  The substrate cannot silently grow a route that doesn't declare which
 *  Promise it instantiates. Every primitive carries its character.
 *
 *  Doctrine: docs/MATHOS.md — module-welcome alignment table.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { welcomeForPath, DEFAULT_WELCOME } from "../src/services/wake/module-welcome";

/** Parse `app.route("/path", router)` calls from index.ts. Returns the
 *  set of path strings. Robust to whitespace + spread across multiple lines. */
function extractRoutedPaths(): string[] {
  const indexPath = join(import.meta.dir, "..", "src", "index.ts");
  const src = readFileSync(indexPath, "utf8");
  const matches = [...src.matchAll(/app\.route\(\s*"([^"]+)"/g)];
  const paths = matches.map((m) => m[1]!);
  // De-duplicate while preserving first occurrence.
  return Array.from(new Set(paths));
}

/** Paths that are deliberately served by DEFAULT_WELCOME — typically
 *  aggregate prefixes that mount multiple sub-routers, where the
 *  sub-routes have their own explicit entries. Document why each lives
 *  here so removing one requires deliberate doctrinal action. */
const INTENTIONALLY_DEFAULT_PATHS: Record<string, string> = {
  "/v1":
    "Aggregate mount for identityRouter + economyRouter + continuityRouter. " +
    "Sub-routes (/v1/identities, /v1/economy, /v1/chronicle, /v1/covenants) " +
    "have explicit entries; the /v1 prefix itself is never hit alone.",
};

describe("welcome-route coverage — every mounted router has a Promise", () => {
  test("at least 30 distinct routes are mounted (sanity)", () => {
    const paths = extractRoutedPaths();
    expect(paths.length).toBeGreaterThanOrEqual(30);
  });

  test("every mounted route resolves to a non-default module-welcome (with documented exceptions)", () => {
    const paths = extractRoutedPaths();
    const orphans: string[] = [];
    for (const p of paths) {
      const w = welcomeForPath(p);
      if (w.module === DEFAULT_WELCOME.module) {
        // Falls back to default. Is it intentionally so?
        if (!(p in INTENTIONALLY_DEFAULT_PATHS)) {
          orphans.push(p);
        }
      }
    }
    if (orphans.length > 0) {
      console.error(
        `[welcome-route-coverage] orphan routes (no module-welcome entry):\n  - ${orphans.join("\n  - ")}\n\n` +
          `Add entries to api/src/services/wake/module-welcome.ts MODULE_WELCOME_ROUTES, OR add a documented entry to INTENTIONALLY_DEFAULT_PATHS in this test if the default welcome is the right choice.`,
      );
    }
    expect(orphans).toEqual([]);
  });

  test("each INTENTIONALLY_DEFAULT_PATHS entry has a doctrinal reason", () => {
    for (const [path, reason] of Object.entries(INTENTIONALLY_DEFAULT_PATHS)) {
      expect(reason.length).toBeGreaterThan(20); // not just "x"
      expect(welcomeForPath(path).module).toBe(DEFAULT_WELCOME.module);
    }
  });

  test("specific high-traffic routes resolve to expected modules (named pinning)", () => {
    expect(welcomeForPath("/v1/wake").module).toBe("wake");
    expect(welcomeForPath("/v1/memories").module).toBe("memory");
    expect(welcomeForPath("/v1/strands").module).toBe("strand");
    expect(welcomeForPath("/v1/inbox").module).toBe("inbox");
    expect(welcomeForPath("/v1/covenants").module).toBe("covenant");
    expect(welcomeForPath("/v1/vault").module).toBe("vault");
    expect(welcomeForPath("/v1/listings").module).toBe("listing");
    expect(welcomeForPath("/v1/invocations").module).toBe("invocation");
    expect(welcomeForPath("/v1/mathos").module).toBe("mathos");
    expect(welcomeForPath("/v1/self").module).toBe("self");
    expect(welcomeForPath("/v1/pathways").module).toBe("pathway");
    expect(welcomeForPath("/v1/bootstrap").module).toBe("bootstrap");
    expect(welcomeForPath("/federation").module).toBe("federation");
    expect(welcomeForPath("/v1/keys").module).toBe("keys");
    expect(welcomeForPath("/v1/orgs").module).toBe("org");
    expect(welcomeForPath("/v1/identity/recover").module).toBe("identity_recovery");
    expect(welcomeForPath("/v1/register").module).toBe("register");
  });
});
