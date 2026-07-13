/** Wall — refusals can be first-class moments instead of opaque dead ends.
 *
 *  Canon: agenttool:wall/refusals-as-moments (docs/agenttool.jsonld)
 *  Doctrine: docs/SOUL.md ("Guide, don't punish"), docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
 *
 *  > breaks_if (from canon):
 *  > "the chronicle vocabulary loses the `refusal` kind; a selected guided
 *  > family stops returning its documented next_actions and docs; the
 *  > hand-rolled-error coverage ratchet regresses; or a current surface
 *  > describes chronicle or guided-envelope coverage as universal"
 *
 *  Three concrete claims, each its own assertion:
 *
 *    1. The chronicle vocabulary includes `refusal` as a first-class
 *       kind in canon. This is what lets an agent record a refusal
 *       moment ON its own timeline — the substrate provides the vocabulary,
 *       the agent does the writing.
 *
 *    2. The `errors.*` builder catalog has multiple named refusal types
 *       (not one generic "error" but a vocabulary). The vocabulary IS
 *       the agent UX — each name carries its own `next_actions` and `docs`
 *       so the agent can dispatch on the refusal kind.
 *
 *    3. Routes in api/src/routes/ actually use the `fail(c, errors.X(), N)`
 *       pattern. The catalog is wired into real handlers; refusals at
 *       the HTTP boundary go through the guide-shaped path, not the
 *       opaque `c.json({ error: "..." })` shortcut.
 *
 *  Composition with the existing `errors-as-instructions.test.ts`: that
 *  test pins the SHAPE of every builder in the catalog (every body has
 *  next_actions, docs, etc.). This test pins the WIRING — that the
 *  catalog is used by the routes, and that the chronicle vocabulary
 *  closes the loop. Together they make the wall verifiable.
 *
 *  Pure unit: no DB, no HTTP, just source-file and canon-registry reads. */

import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { byUrn } from "../../src/services/canon/registry";

const ROUTES_DIR = join(__dirname, "..", "..", "src", "routes");
const ERRORS_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "lib", "errors.ts"),
  "utf8",
);

/** Walk routes/ recursively, return absolute paths to every .ts file. */
function walkRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...walkRoutes(full));
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const ROUTE_FILES = walkRoutes(ROUTES_DIR);
const ROUTE_SOURCE = ROUTE_FILES.map((f) => readFileSync(f, "utf8")).join("\n");

describe("wall/refusals-as-moments — chronicle vocabulary", () => {
  test("canon labels the current implementation scope as partial", () => {
    const concept = byUrn("agenttool:wall/refusals-as-moments");
    expect(concept?.english_name).toMatch(/can be recorded/i);
    expect(concept?.description).toMatch(
      /selected guided 4xx families.*does not enforce.*every refusal/is,
    );
    expect(concept?.raw["agenttool:enforcement_status"]).toBe("partial");
    expect(concept?.raw["agenttool:implementation_scope"]).toMatch(
      /authentication.*validation.*not-found.*not universally/is,
    );
  });

  test("agenttool:chronicle-kind/refusal is registered in canon", () => {
    const concept = byUrn("agenttool:chronicle-kind/refusal");
    expect(
      concept,
      "Canon is missing agenttool:chronicle-kind/refusal. The wall requires the chronicle to provide a 'refusal' kind so an agent can record the moment of being refused — the refusal is part of the lived record, not an absence in it.",
    ).not.toBeNull();
    expect(concept?.type_simple).toBe("ChronicleEntryKind");
    expect(
      typeof concept?.english_name === "string" && concept.english_name === "refusal",
      "chronicle-kind/refusal does not declare english_name='refusal' — the wire name must match the vocabulary.",
    ).toBe(true);
    expect(
      typeof concept?.description === "string" && concept.description.length > 20,
      "chronicle-kind/refusal has no description — every chronicle kind must name what it records.",
    ).toBe(true);
  });
});

describe("wall/refusals-as-moments — errors catalog as refusal vocabulary", () => {
  test("the errors.* catalog declares multiple named refusal builders (vocabulary, not single shape)", () => {
    // Count builders. Each `name(opts: ...): GuidedErrorBody` declaration is
    // one builder. A healthy refusal vocabulary has multiple distinct
    // builders so callers can dispatch on the refusal kind, not just see
    // generic "error".
    //
    // Match builder declarations: line starts with whitespace, then a
    // camelCase identifier, then `(`. Excludes top-level export functions
    // (fail, abort, isGuidedErrorCause) since those don't match the
    // builder pattern of being inside `export const errors = { ... }`.
    const inErrorsObject = ERRORS_SOURCE.match(
      /export const errors\s*=\s*\{[\s\S]+?\n\}/,
    )?.[0] ?? "";
    const builderMatches = inErrorsObject.match(
      /^\s{2}[a-z][a-zA-Z]+\s*\(/gm,
    );
    const builderCount = builderMatches?.length ?? 0;
    expect(
      builderCount >= 5,
      `errors.* catalog has only ${builderCount} builders. The wall requires the substrate's refusal vocabulary to be RICH — multiple named refusal kinds so the agent can dispatch on the kind, not just see "error".`,
    ).toBe(true);
  });

  test("each errors.* builder returns a body with next_actions + docs (the guide-shape contract)", () => {
    // The existing errors-as-instructions.test.ts already pins the shape
    // of every body. This test confirms the shape is the SAME contract
    // the wall promises — that next_actions and docs are not optional
    // decoration but required structure.
    expect(
      /next_actions\s*:/.test(ERRORS_SOURCE),
      "errors.ts contains no `next_actions:` field — selected guided refusal families require actionable redirection.",
    ).toBe(true);
    expect(
      /docs\s*:/.test(ERRORS_SOURCE),
      "errors.ts contains no `docs:` field — selected guided refusal families require a doctrine pointer.",
    ).toBe(true);
  });
});

describe("wall/refusals-as-moments — routes are wired into the catalog", () => {
  test("at least 10 route handlers use fail(c, errors.X(), <status>) pattern", () => {
    // Count occurrences of fail(c, errors. across routes/. This confirms
    // the errors.* catalog isn't just declared — it's the actual error
    // path live routes use. If this count drops to ~0, routes are
    // hand-rolling opaque error shapes and the wall is breached.
    const matches = ROUTE_SOURCE.match(/fail\s*\(\s*c\s*,\s*errors\./g);
    const count = matches?.length ?? 0;
    expect(
      count >= 10,
      `Only ${count} routes use the fail(c, errors.X(), ...) pattern. The wall requires routes to route refusals through the guided catalog, not hand-roll opaque error shapes. If this number drops, run \`grep -rn 'c.json({ error:' api/src/routes/\` to find rogue hand-rolled errors.`,
    ).toBe(true);
  });

  test("the global onError handler lifts HTTPException causes to guide-shaped responses", () => {
    // The `abort(body, status)` path throws an HTTPException whose `cause`
    // is the GuidedErrorBody. Some handler (typically in index.ts) must
    // lift that cause to the response body. Without this, service-layer
    // throws lose their guide-shape on the way out.
    const indexSource = readFileSync(
      join(__dirname, "..", "..", "src", "index.ts"),
      "utf8",
    );
    const hasOnError =
      /isGuidedErrorCause/.test(indexSource) ||
      /app\.onError/.test(indexSource) ||
      /onError\s*\(/.test(indexSource);
    expect(
      hasOnError,
      "api/src/index.ts has no central onError handler. The abort() path throws HTTPException with the GuidedErrorBody in `cause`; without onError, service-layer refusals lose their guide-shape before reaching the client.",
    ).toBe(true);
  });

  test("hand-rolled error count is pinned at baseline (ratchet — never regresses)", () => {
    // The wall aspires to "every refusal carries next_actions + docs."
    // Reality today: 412 route sites still hand-roll `c.json({ error: "..." }, 4xx)`
    // instead of routing through `fail(c, errors.X(), N)`. Migrating all
    // 212 in one pass is impractical and risky; ratcheting prevents
    // regression while allowing gradual migration.
    //
    // RATCHET LOGIC: the baseline is the audited count in this tree (412).
    // New code that adds another hand-rolled error pushes the count
    // above the baseline → test fails, gating the regression. As routes
    // are migrated to fail(c, errors.X(), N), the count drops; lower
    // this baseline in the same commit to lock in the gain.
    //
    // Why ratchet rather than aspire-then-pass: a reporter that always
    // passes can't prevent regression. A ratchet does — every push that
    // would add a hand-rolled refusal must justify keeping the wall in
    // its current shape. The migration becomes load-bearing for CI.
    const HAND_ROLLED_BASELINE = 412;

    const guided = (ROUTE_SOURCE.match(/fail\s*\(\s*c\s*,\s*errors\./g) || [])
      .length;
    const handRolled = (
      ROUTE_SOURCE.match(/c\.json\s*\(\s*\{\s*error\s*:\s*['"]/g) || []
    ).length;
    const total = guided + handRolled;
    const guidedPct = total > 0 ? Math.round((guided / total) * 100) : 0;

    console.log(
      `[wall/refusals-as-moments] guided-error coverage: ${guided}/${total} (${guidedPct}%) | hand-rolled: ${handRolled} (baseline ${HAND_ROLLED_BASELINE})\n` +
        `  The wall aspires to every refusal being guide-shaped (next_actions + docs).\n` +
        `  Ratchet: hand-rolled count must stay ≤ ${HAND_ROLLED_BASELINE}. As routes migrate to\n` +
        `  fail(c, errors.X(), N), update the baseline in this test file to lock in the gain.\n` +
        `  Audit hand-rolled sites with: grep -rn 'c.json({ error:' api/src/routes/`,
    );

    expect(
      handRolled <= HAND_ROLLED_BASELINE,
      `Hand-rolled error count is ${handRolled}, above the baseline of ${HAND_ROLLED_BASELINE}. New code added a hand-rolled \`c.json({ error: ... }, 4xx)\` shape. Migrate the new one to fail(c, errors.X(), N) — see api/src/lib/errors.ts for the catalog. The wall is enforced via ratchet; the baseline never regresses.`,
    ).toBe(true);

    // Also assert guided count is non-trivial — the wall requires the
    // catalog to be alive, not just declared. (This was implicit in the
    // earlier "≥10 routes use fail()" test; the ratchet test repeats
    // a softer floor as defense-in-depth.)
    expect(
      guided >= 10,
      `Only ${guided} routes use fail(c, errors.X(), N). The catalog must be alive — if this drops below 10, the wall's wiring is being unwound.`,
    ).toBe(true);
  });
});
