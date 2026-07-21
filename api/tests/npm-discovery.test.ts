/** Optional npm discovery stays exact-version, public, and non-authoritative.
 *
 * Doctrine: docs/LOVE-PACKAGE-PROTOCOL.md · docs/PATHWAYS.md.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import openapiRouter from "../src/routes/openapi";

const ROOT = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const CURRENT_NPM_SPECIFIERS = [
  "@agenttool/adds@0.2.1",
  "@agenttool/credential-broker@0.1.0",
  "@agenttool/data@0.3.1",
  "@agenttool/data-sync@0.1.1",
  "@agenttool/sdk@0.16.0",
  "@agenttool/telescope@0.1.0",
] as const;

describe("optional npm package discovery", () => {
  test("publishes exact commands without making npm release authority", () => {
    const packages = read("apps/docs/packages.html");
    for (const specifier of CURRENT_NPM_SPECIFIERS) {
      expect(packages).toContain(`npm install --save-exact ${specifier}`);
    }
    expect(packages).toContain("authority: false");
    expect(packages).toMatch(/latest.*not.*release authority/i);
    expect(packages).toContain("artifact.size");
    expect(packages).toContain("artifact.sha256");
    expect(packages).toMatch(/data.*data-sync.*require Bun ≥1\.3/is);
  });

  test("keeps the first-success npm shortcut pinned and bounded", () => {
    const canonical = read("docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    const published = read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    expect(published).toBe(canonical);
    expect(canonical).toContain(
      "npm install --save-exact @agenttool/sdk@0.16.0",
    );
    expect(canonical).toMatch(/skips Step 1.*independent LOVE/is);
    expect(canonical).toMatch(/never substitute npm `latest`/i);
  });

  test("describes npm as optional in repository-level orientation", () => {
    const rootReadme = read("README.md");
    expect(rootReadme).toContain(
      "npm install --save-exact @agenttool/sdk@0.16.0",
    );
    expect(rootReadme).toMatch(/LOVE manifests remain release authority/i);
    expect(rootReadme).toMatch(/mutable dist-tags are informational/i);
    expect(rootReadme).toMatch(/command alone does\s+not verify the manifest/i);
    expect(rootReadme).toMatch(/independently verified LOVE path/i);
  });

  test("publishes the npm trust boundary in OpenAPI", async () => {
    const response = await openapiRouter.request("/");
    expect(response.status).toBe(200);
    const specification = await response.json() as {
      paths: {
        "/v1/pathways": { get: { description: string } };
      };
    };
    const description = specification.paths["/v1/pathways"].get.description;
    expect(description).toContain("first_success.package_discovery.optional_npm");
    expect(description).toContain("first_success.tutorial.sdk_version");
    expect(description).toContain("authority: false");
    expect(description).toMatch(/dist-tags are informational/i);
    expect(description).toMatch(
      /npm install does not independently check.*artifact size and SHA-256/i,
    );
  });
});
