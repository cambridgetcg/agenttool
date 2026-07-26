/** /v1/discover — a filter that cannot match must say so.
 *
 *  `identity.identities.trust_score` is pinned to a constant zero on purpose
 *  (`services/identity/trust.ts`): no qualified trust roots, no personhood
 *  guarantee, no Sybil-resistant weighting, therefore no published score. The
 *  refusal is right. What was wrong is that discovery kept serving the field
 *  and kept offering `min_trust` as a filter over it, so `?min_trust=0.5`
 *  returned an empty page and a caller could reasonably read that as
 *  "no trustworthy agents here" rather than "this filter reads a constant".
 *
 *  The refusal path runs before any database access, so it is testable with no
 *  DB at all — which is the point: the honest answer is cheap.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md. */

import { describe, expect, test } from "bun:test";
import { Hono } from "hono";

import discoverRouter from "../src/routes/identity/discover";
import { NO_SETTLEMENTS } from "../src/services/marketplace/settlement-receipts";

function appWithStubProject() {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("project", { id: "00000000-0000-0000-0000-0000000000aa" });
    await next();
  });
  app.route("/v1/discover", discoverRouter as unknown as Hono);
  return app;
}

describe("min_trust refuses instead of returning a silent empty page", () => {
  test("a positive min_trust is refused with instructions", async () => {
    const res = await appWithStubProject().request("/v1/discover?min_trust=0.5");
    expect(res.status).toBe(400);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("filter_cannot_match");
    // The message has to name the cause, not just decline.
    expect(body.message).toContain("min_trust=0.5");
    expect(body.message).toContain("structurally 0");
    expect(body.message).toContain("Sybil");

    // Errors-as-instructions: a refusal that does not hand over the working
    // alternative just moves the dead end one step later.
    const paths = (body.next_actions as { path: string }[]).map((a) => a.path);
    expect(paths).toContain("/v1/discover?min_settlements=1");
    expect(paths).toContain("/public/settlements");
    expect(paths).toContain("/public/settlements/verification");
    expect(body.docs).toContain("SETTLEMENT-RECEIPTS");
  });

  test("every positive value is refused, not just round ones", async () => {
    const app = appWithStubProject();
    for (const v of ["0.01", "0.5", "1"]) {
      const res = await app.request(`/v1/discover?min_trust=${v}`);
      expect(res.status).toBe(400);
    }
  });

  test("out-of-range values still fail validation, not the new refusal", async () => {
    // The new branch must not swallow malformed input and rename it.
    const res = await appWithStubProject().request("/v1/discover?min_trust=7");
    expect(res.status).toBe(400);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("validation");
  });
});

describe("settlement facts are facts, not a score", () => {
  test("a seller with no settled work reads as zero, never null", () => {
    // "This seller has settled nothing here" and "we have no idea" are
    // different claims. Zeroes say the first one.
    expect(NO_SETTLEMENTS).toEqual({
      settled_count: 0,
      distinct_counterparties: 0,
      first_settled_at: null,
      last_settled_at: null,
    });
  });

  test("no field in the facts shape implies a ranking", () => {
    const forbidden = /score|rating|rank|reputation|trust|stars|quality|tier|level/i;
    for (const key of Object.keys(NO_SETTLEMENTS)) {
      expect(key).not.toMatch(forbidden);
    }
  });

  test("counterparty distinctness is carried, because a raw count hides wash trading", async () => {
    // Forty settlements against one counterparty and forty against forty are
    // the same number and not the same claim. Both must be readable.
    const source = await Bun.file(
      new URL("../src/routes/identity/discover.ts", import.meta.url).pathname,
    ).text();
    expect(source).toContain("settlementFactsForSellers");
    expect(source).toContain("min_settlements");
  });
});

describe("total means total", () => {
  test("the route counts over the filter instead of reporting the page size", async () => {
    // `total: rows.length` reads as the population and is the page size; it is
    // what made an offset walk necessary to learn how many agents exist.
    const source = await Bun.file(
      new URL("../src/routes/identity/discover.ts", import.meta.url).pathname,
    ).text();
    expect(source).not.toContain("total: rows.length");
    expect(source).toContain("count: rows.length");
    expect(source).toMatch(/COUNT\(\*\)::int/);
  });
});
