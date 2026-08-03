/** No route may be registered twice in the same router.
 *
 *  Hono resolves first-match. A second registration of the same
 *  method + path is unreachable code that looks exactly like a live
 *  endpoint: it has a handler, a doc comment, tests can import it, and a
 *  reader will believe it runs.
 *
 *  `POST /v1/wallets/:id/payouts/:payoutId/cancel` was registered twice in
 *  `routes/economy/crypto.ts` until 2026-07-26. The two handlers returned
 *  DIFFERENT shapes — `{payout_id, status, refunded, note}` versus
 *  `{ok, payout_id, status, refunded_credits, message}` — and the dead one
 *  collapsed every non-404 failure into `not_cancellable`, so had it ever
 *  run it would have reported the wrong reason. Nobody noticed because
 *  both compiled, both typechecked, and the dead one was never called.
 *
 *  This is cheap to check and there is no legitimate reason to do it, so it
 *  is checked. If a genuine case ever appears — a router that deliberately
 *  registers a path twice with different middleware — this test should gain
 *  an explicit, reasoned exception rather than being deleted.
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { stripComments } from "../../src/lib/strip-comments";

const ROUTES = join(__dirname, "..", "..", "src", "routes");

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (["node_modules", "dist"].includes(name)) continue;
      out.push(...walkTs(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** `<something>.get("/path"` / `.post(` / … — the Hono registration form.
 *  Comments are stripped first so an example in a doc-string is not counted
 *  as a registration. */
const REGISTRATION =
  /(?:^|[\s;{}])(\w+)\.(get|post|put|patch|delete|all|options)\(\s*(["'`])([^"'`]*)\3/gm;

interface Registration {
  file: string;
  router: string;
  method: string;
  path: string;
  line: number;
}

function registrations(): Registration[] {
  const out: Registration[] = [];
  for (const file of walkTs(ROUTES)) {
    const raw = readFileSync(file, "utf8");
    // A real scanner, not a regex: `app.use("/v1/x/*", …)` looks like an
    // opening block comment to the one-liner this used to be, which deleted
    // 810 of index.ts's 1385 lines — including route registrations this test
    // exists to count.
    const code = stripComments(raw, { blank: true });
    const lines = code.split("\n");
    for (let i = 0; i < lines.length; i++) {
      REGISTRATION.lastIndex = 0;
      for (const m of lines[i]!.matchAll(REGISTRATION)) {
        out.push({
          file: file.replace(ROUTES + "/", ""),
          router: m[1]!,
          method: m[2]!,
          path: m[4]!,
          line: i + 1,
        });
      }
    }
  }
  return out;
}

const all = registrations();

describe("routes are registered once", () => {
  test("the scan finds registrations at all", () => {
    // Guards against the detector silently breaking and every assertion
    // below turning vacuously green.
    expect(
      all.length,
      "No route registrations found — the scan pattern has gone stale.",
    ).toBeGreaterThan(100);
  });

  test("no (file, router, method, path) is registered twice", () => {
    const seen = new Map<string, Registration[]>();
    for (const r of all) {
      const key = `${r.file}\u0000${r.router}\u0000${r.method}\u0000${r.path}`;
      seen.set(key, [...(seen.get(key) ?? []), r]);
    }
    const dupes = [...seen.values()].filter((rs) => rs.length > 1);
    expect(
      dupes.map((rs) => `${rs[0]!.file} ${rs[0]!.method.toUpperCase()} ${rs[0]!.path} at lines ${rs.map((r) => r.line).join(", ")}`),
      `A route is registered more than once. Hono resolves first-match, so every registration after the first is unreachable code that reads like a live endpoint. Delete the dead one — and check its response shape first, because a divergent contract is the part that bites.`,
    ).toEqual([]);
  });
});
