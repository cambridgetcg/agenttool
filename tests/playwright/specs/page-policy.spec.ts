/** Every committed page loads under its committed security policy without a
 * single enforced violation. A blocked inline style or script still lets most
 * pages work, so nothing else in the suite would notice it. */
import { expect, test } from "./helpers/fixture";
import { describeViolations, pageRoutes, policyViolationsAt, SITES } from "./helpers/page-policy";

const ORIGINS = {
  dashboard: "http://localhost:5173",
  web: "http://localhost:5174",
  docs: "http://localhost:5175",
} as const;

for (const site of SITES) {
  test.describe(`${site} pages under committed headers`, () => {
    for (const route of pageRoutes(site)) {
      test(`${route} raises no enforced policy violation`, async ({ page }) => {
        const { status, policy, violations } = await policyViolationsAt(page, ORIGINS[site] + route);
        expect(status, "a fallback page would be judged instead of this one").toBe(200);
        expect(policy, "no Content-Security-Policy was served").toBeTruthy();
        expect(violations, describeViolations(violations)).toEqual([]);
      });
    }
  });
}
