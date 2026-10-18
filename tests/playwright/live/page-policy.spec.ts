/** Every committed page, loaded from production as a visitor's browser sees it,
 * raises no enforced policy violation while it loads. Run after a frontend
 * release; the scheduled workflow repeats it. The browser may only read: any
 * request other than GET or HEAD is aborted before it leaves.
 *
 * A page counts only if production answered 200 with a policy. A challenge or
 * error page carries no site policy, so it would pass by having nothing to
 * break; it fails instead. A 404 means the page is committed but not released
 * and is skipped and listed, except for a site's front page, which must load.
 *
 * Cloudflare can rewrite HTML at the edge. A rewrite named in edge-injections.ts
 * is listed instead of failing the page; anything else blocked fails it.
 * summary-reporter.ts prints both lists once per run. */
import { expect, test } from "@playwright/test";

import { describeViolations, pageRoutes, policyViolationsAt, SITES } from "../specs/helpers/page-policy";
import { edgeInjection } from "./edge-injections";

const ORIGINS = {
  dashboard: "https://app.agenttool.dev",
  web: "https://agenttool.dev",
  docs: "https://docs.agenttool.dev",
} as const;

test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    ["GET", "HEAD"].includes(route.request().method()) ? route.continue() : route.abort("blockedbyclient"));
});

for (const site of SITES) {
  test.describe(`${site} pages in production`, () => {
    for (const route of pageRoutes(site)) {
      const url = ORIGINS[site] + route;
      test(`${route} raises no enforced policy violation`, async ({ page }, testInfo) => {
        const { status, policy, violations } = await policyViolationsAt(page, url);
        if (status === 404 && route !== "/" && route !== "/404") {
          testInfo.annotations.push({ type: "not in production", description: url });
          test.skip(true, "committed but not served in production (not yet released, or removed)");
        }
        expect(status === 200 || (route === "/404" && status === 404), `${url} answered ${status}; an edge or error page cannot show the site's policy`).toBe(true);
        expect(policy, `${url} served no Content-Security-Policy`).toBeTruthy();
        for (const violation of violations) {
          const injection = edgeInjection(violation);
          if (injection) testInfo.annotations.push({ type: "edge injection", description: injection.name });
        }
        const unexplained = violations.filter((violation) => !edgeInjection(violation));
        expect(unexplained, describeViolations(unexplained)).toEqual([]);
      });
    }
  });
}
