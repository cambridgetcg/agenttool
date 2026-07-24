/** Three static signposts, one compact API compass.
 *
 * Reads committed files only; no redirect is followed and no network request
 * is made.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

const ROOT = join(import.meta.dir, "..", "..");
const API = "https://api.agenttool.dev";
const SITES = ["web", "docs", "dashboard"] as const;
const SERVICE_META =
  `<${API}/public/discovery>; rel="service-meta"; ` +
  'type="application/vnd.agenttool.discovery+json"';

function read(site: (typeof SITES)[number], file: string): string {
  return readFileSync(join(ROOT, "apps", site, file), "utf8");
}

describe("static estate discovery convergence", () => {
  for (const site of SITES) {
    test(`${site} root and redirect point to the same compact compass`, () => {
      const html = read(site, "index.html");
      const headers = read(site, "_headers");
      const redirects = read(site, "_redirects");

      expect(html).toContain(
        `rel="service-meta" type="application/vnd.agenttool.discovery+json" href="${API}/public/discovery"`,
      );
      expect(headers).toContain(SERVICE_META);
      expect(redirects).toMatch(
        /^\/public\/discovery\s+https:\/\/api\.agenttool\.dev\/public\/discovery\s+301$/m,
      );

      for (const relation of [
        "api-catalog",
        "service-desc",
        "service-doc",
        "describedby",
        "status",
      ]) {
        expect(html).toContain(`rel="${relation}"`);
        expect(headers).toContain(`rel="${relation}"`);
      }
    });
  }

  test("static metadata adds no Content-Signal policy or false A2A door", () => {
    const combined = SITES.flatMap((site) => [
      read(site, "index.html"),
      read(site, "_headers"),
      read(site, "_redirects"),
    ]).join("\n");

    expect(combined).not.toContain("Content-Signal");
    expect(combined).not.toContain("agent-card.json");
  });
});
