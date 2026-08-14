/** Optional npm discovery stays exact-version, visibility-aware, and non-authoritative.
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
  "@agenttool/adds@0.2.3",
  "@agenttool/browser@0.6.0",
  "@agenttool/credential-broker@0.3.1",
  "@agenttool/data@0.3.1",
  "@agenttool/data-sync@0.1.2",
  "@agenttool/sdk@0.18.0",
  "@agenttool/telescope@0.2.3",
  "@agenttool/wallet@0.1.3",
] as const;

describe("optional npm package discovery", () => {
  test("offers conditional exact commands without making npm release authority", () => {
    const packages = read("apps/docs/packages.html");
    for (const specifier of CURRENT_NPM_SPECIFIERS) {
      expect(packages).toContain(`npm install --save-exact ${specifier}`);
    }
    expect(packages).toContain(
      "npm install --save-exact @agenttool/wallet@0.1.3 @agenttool/wallet-zerone@0.1.2",
    );
    expect(packages).toContain(
      "npm install --save-exact @agenttool/skills@0.3.1",
    );
    expect(packages).toContain(
      "bun add --global @agenttool/codex-usage@0.1.0",
    );
    expect(packages).not.toContain(
      "npm install --save-exact @agenttool/skills@0.3.0",
    );
    expect(packages).toContain(
      "npm install --save-exact @agenttool/collab@0.4.0",
    );
    expect(packages).not.toContain(
      "npm install --save-exact @agenttool/collab@0.3.1",
    );
    expect(packages).toContain(
      "npm install --save-exact @agenttool/kingdom@0.1.0",
    );
    expect(packages).toContain(
      "npm install --save-exact @agenttool/alchemy@0.1.0-dev.0 @agenttool/credential-broker@0.3.1 @agenttool/alchemy-agentcred@0.1.0-dev.0",
    );
    expect(packages).toContain(
      'href="https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md#verified-collab-040-publication--2026-08-04"',
    );
    expect(packages).toContain(
      'href="https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md#verified-agent-skills-031-publication--2026-08-13"',
    );
    expect(packages).toContain(
      'href="https://github.com/cambridgetcg/agenttool/blob/main/docs/NPM-RELEASES.md#verified-codex-usage-010-publication--2026-08-14"',
    );
    for (const receiptFact of [
      "30906798360",
      "303,376",
      "1a9c1830ec9326351a475596820780ad7f93c7dfe16a6f1a9eb74bc08edbdb51",
      "2340231720",
      "31732645566",
      "62,081",
      "53aa5b3276eba196d8904f9db8c43987257d76f960c59c196ddac099175fbe11",
      "2454756592",
      "2454756935",
      "nen-common-ground",
      "31784329559",
      "30,926",
      "feb5830b704e1116fa6b3b34490da621b0725ba914b8d94f6ce325f3a2275bec",
      "2463986451",
      "2463987297",
      "33-file",
      "30492737828",
      "d05458b27b8832af7996c243abb22e3b400e5810fe5377ba58e1cb587d2461d8",
      "30494659977",
      "bc43b8be96dcc74a866926c9f5d98c00af9d8c4682cbb6f36ef77a7adbbaa8cc",
      "30495292940",
      "3fe42c4457e38f1fcdbc437c22c762ea7dabfe898714ec395287608a0480ea2b",
      "30495589179",
      "37b69b13db60eafc4a0bae578faca14467c0844e4f4c32793808b3499bcd8fd6",
    ]) {
      expect(packages).toContain(receiptFact);
    }
    expect(packages).not.toContain("@agenttool/credential-broker@0.1.0");
    expect(packages).not.toMatch(/adapter npm command.*remains absent/i);
    expect(packages).toContain("authority: false");
    expect(packages).toMatch(/latest.*not.*release authority/i);
    expect(packages).toContain("artifact.size");
    expect(packages).toContain("artifact.sha256");
    expect(packages).toMatch(/data.*data-sync.*require Bun ≥1\.3/is);
    expect(packages).toMatch(/availability may lag/i);
    expect(packages).toMatch(/query the requested version directly/i);
    expect(packages).toMatch(
      /package-manager installation contacts.*registry.*tracker runtime makes no network call/is,
    );
    expect(packages).toMatch(
      /Codex Usage.*no hosted usage surface.*no background process.*registers no MCP server/is,
    );
  });

  test("keeps the first-success npm shortcut pinned and bounded", () => {
    const canonical = read("docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    const published = read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md");
    expect(published).toBe(canonical);
    expect(canonical).toContain(
      "npm install --save-exact @agenttool/sdk@0.18.0",
    );
    expect(canonical).toMatch(/skips Step 1.*in-command LOVE/is);
    expect(canonical).toMatch(/never substitute npm `latest`/i);
  });

  test("describes npm as optional in repository-level orientation", () => {
    const rootReadme = read("README.md");
    expect(rootReadme).toContain(
      "npm install --save-exact @agenttool/sdk@0.18.0",
    );
    const pythonSource =
      "git+https://github.com/cambridgetcg/agenttool.git@sdk-v0.18.0#subdirectory=packages/sdk-py";
    const exactPyPI = 'python -m pip install "agenttool-sdk==0.18.0"';
    expect(rootReadme).toContain(pythonSource);
    expect(rootReadme).toContain(exactPyPI);
    expect(rootReadme.indexOf(pythonSource)).toBeLessThan(
      rootReadme.indexOf(exactPyPI),
    );
    expect(rootReadme).toMatch(/PyPI 0\.18\.0.*returned `404`/is);
    expect(rootReadme).toContain("30909424114");
    expect(rootReadme).toContain(
      "8e6bbe42f76decd1448dd07465840339e5b055abba0317b3d04f4f506e44616a",
    );
    expect(rootReadme).toContain(
      "The exact 0.17.0 npm and PyPI mirrors are independently public.",
    );
    expect(rootReadme).toMatch(/mirrors remain non-authoritative/i);
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
