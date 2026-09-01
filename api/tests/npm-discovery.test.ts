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
  "@agenttool/sdk@0.22.1",
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
      "npm install --save-exact @agenttool/kingdom@0.1.1",
    );
    expect(packages).not.toContain(
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
      "32374669064",
      "32374671268",
      "2cda03bdc2f6c2ee08acd55c6b643d67d8dd2b36",
      "c18d1b35ba5f7c918bbee64642510452af6f67302b78038580b4b65c6b77c154",
      "5d2e83e5b7fb3728fe985ea0e050c0d1cb314eed07b78f12bd045852ba1b1a01",
      "e70c1eecc1699961a22720676185e141293a09bae381e875a81541b872fea71d",
      "32374666482",
      "1ce1ac829f72c6f2490227c5a8a942fbee9570bd03a4be217df19104d034acd8",
      "31815209550",
      "31815447080",
      "cb9c30fae0e49e1727e449207593581ce52cd4cf",
      "d3b2fa790eb9a256d0f682c2b72ca97d572a000f7028238cb1a1a53959ccdf03",
      "43483413256b63a001d6deae16928dac2aaae8ed8572fddb98e14381e844035b",
      "54cb2096f984ec9f4c9791224d9e3cca3b322842ca8b825a13bf95008eb779f4",
      "2467138141",
      "2467138904",
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
      "npm install --save-exact @agenttool/sdk@0.22.1",
    );
    expect(canonical).toMatch(/skip(?:s)? Step 1.*in-command LOVE/is);
    expect(canonical).toMatch(/never substitute\s+npm `latest`/i);
  });

  test("describes npm as optional in repository-level orientation", () => {
    const rootReadme = read("README.md");
    expect(rootReadme).toContain(
      "npm install --save-exact @agenttool/sdk@0.22.1",
    );
    const pythonSource =
      "git+https://github.com/cambridgetcg/agenttool.git@sdk-v0.22.1#subdirectory=packages/sdk-py";
    const exactPyPI = 'python -m pip install "agenttool-sdk==0.22.1"';
    expect(rootReadme).toContain(pythonSource);
    expect(rootReadme).toContain(exactPyPI);
    expect(rootReadme.indexOf(pythonSource)).toBeLessThan(
      rootReadme.indexOf(exactPyPI),
    );
    expect(rootReadme).toMatch(/Protected PyPI run `33522323177` independently read back/is);
    expect(rootReadme).toContain("32374669064");
    expect(rootReadme).toContain("32374671268");
    expect(rootReadme).toContain(
      "c18d1b35ba5f7c918bbee64642510452af6f67302b78038580b4b65c6b77c154",
    );
    expect(rootReadme).toContain(
      "5d2e83e5b7fb3728fe985ea0e050c0d1cb314eed07b78f12bd045852ba1b1a01",
    );
    expect(rootReadme).toContain(
      "e70c1eecc1699961a22720676185e141293a09bae381e875a81541b872fea71d",
    );
    expect(rootReadme).toContain("31815209550");
    expect(rootReadme).toContain("31815447080");
    expect(rootReadme).toContain(
      "d3b2fa790eb9a256d0f682c2b72ca97d572a000f7028238cb1a1a53959ccdf03",
    );
    expect(rootReadme).toContain(
      "43483413256b63a001d6deae16928dac2aaae8ed8572fddb98e14381e844035b",
    );
    expect(rootReadme).toContain("The independently verified 0.22.0, 0.21.1, 0.21.0, and earlier");
    expect(rootReadme).toMatch(/mirrors remain non-authoritative/i);
    expect(rootReadme).toMatch(/LOVE manifests remain release authority/i);
    expect(rootReadme).toMatch(/mutable dist-tags are informational/i);
    expect(rootReadme).toMatch(/command alone does\s+not verify the manifest/i);
    expect(rootReadme).toMatch(/start with the exact LOVE path/i);
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
