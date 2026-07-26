/** Provider-directory readiness — public paths stay useful and claims stay bounded.
 *
 * This does not claim provider review, listing, affiliation, or legal-policy
 * approval. It pins only repository-controlled technical preparation.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function listingField(packet: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = packet.match(
    new RegExp(
      `^- \\*\\*${escaped}(?: \\([^\\n)]*\\))?:\\*\\* ([\\s\\S]*?)(?=\\n- \\*\\*|\\n\\n)`,
      "m",
    ),
  );
  expect(match, `missing listing field: ${label}`).toBeDefined();
  return (match?.[1] ?? "").replace(/\n\s+/g, " ").trim();
}

function plain(value: string): string {
  return value.replaceAll("`", "");
}

describe("AgentTool Canon directory readiness", () => {
  test("publishes one explicit, optional connection guide", () => {
    const page = read("apps/docs/connect-canon.html");

    expect(page).toContain("https://api.agenttool.dev/v1/mcp/canon");
    expect(page).toContain("search");
    expect(page).toContain("fetch");
    expect(page).toMatch(/no account/i);
    expect(page).toMatch(/leaving is complete/i);
    expect(page).toContain(
      "https://claude.ai/customize/connectors?modal=add-custom-connector",
    );
    expect(page).toContain(
      "https://developers.openai.com/plugins/deploy/connect-chatgpt",
    );
    expect(page).toContain(
      "https://claude.com/docs/connectors/custom/remote-mcp",
    );
    expect(page).toMatch(/only prefills.*review and\s+confirm/is);
    expect(page).toMatch(
      /not a substitute for\s+a publisher-approved privacy policy or service terms/is,
    );
  });

  test("keeps public support separate from private vulnerability reporting", () => {
    for (const path of ["SUPPORT.md", "SECURITY.md", "apps/docs/support.html"]) {
      const text = read(path);
      expect(text).toContain(
        "https://github.com/cambridgetcg/agenttool/security/advisories/new",
      );
      expect(text).toMatch(
        /(?:never|do not) (?:post|put)[\s\S]{0,180}sensitive/i,
      );
    }

    const support = read("apps/docs/support.html");
    expect(support).toContain(
      "https://github.com/cambridgetcg/agenttool/issues",
    );
    expect(support).toContain(
      "https://github.com/cambridgetcg/agenttool/discussions",
    );
    expect(support).toMatch(/do not create an uptime, response-time/i);
  });

  test("keeps provider copy inside current visible limits", () => {
    const packet = read("marketing/DIRECTORY-SUBMISSION.md");
    const packageName = plain(listingField(packet, "OpenAI package name"));
    const version = plain(listingField(packet, "Version"));
    const displayName = listingField(
      packet,
      "Display name / Anthropic name",
    );
    const openAiShort = listingField(packet, "OpenAI short description");
    const longDescription = listingField(
      packet,
      "OpenAI long description / Anthropic description",
    );
    const anthropicTagline = listingField(packet, "Anthropic tagline");
    const capabilities = listingField(packet, "OpenAI capabilities").split(
      " · ",
    );

    expect(packageName).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
    expect(packageName.length).toBe(15);
    expect(packageName.length).toBeLessThanOrEqual(64);
    expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(version.length).toBeLessThanOrEqual(64);
    expect(displayName).toBe("AgentTool Canon");
    expect(displayName.length).toBe(15);
    expect(displayName.length).toBeLessThanOrEqual(30);
    expect(displayName.length).toBeLessThanOrEqual(100);
    expect(openAiShort).toBe("Search public AgentTool canon");
    expect(openAiShort.length).toBeLessThanOrEqual(30);
    expect(longDescription.length).toBe(274);
    expect(longDescription.length).toBeLessThanOrEqual(4_000);
    expect(longDescription.length).toBeLessThanOrEqual(2_000);
    expect(anthropicTagline).toBe(
      "Search AgentTool’s public concepts with source links.",
    );
    expect(anthropicTagline.length).toBeLessThanOrEqual(55);
    expect(capabilities.length).toBeLessThanOrEqual(20);
    for (const capability of capabilities) {
      expect(capability.length).toBeGreaterThan(0);
      expect(capability.length).toBeLessThanOrEqual(120);
      expect(capability).not.toContain("\n");
    }

    const starterSection = packet.match(
      /## Three directory starter prompts\n([\s\S]*?)\n## Five positive evaluations/,
    )?.[1];
    expect(starterSection).toBeDefined();
    const prompts = [...(starterSection ?? "").matchAll(/^\d+\. (.+)$/gm)].map(
      (match) => match[1],
    );
    expect(prompts).toEqual([
      "Find AgentTool’s definition of consent and cite the source.",
      "What does AgentTool mean by “Castle of Understanding”?",
      "Find concepts about agent discovery. Separate publisher claims from verification evidence.",
    ]);
    expect(new Set(prompts.map((prompt) => prompt.normalize().trim())).size).toBe(
      3,
    );
    for (const prompt of prompts) {
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt.length).toBeLessThanOrEqual(128);
      expect(prompt).not.toContain("@");
    }

    for (const label of [
      "MCP endpoint",
      "Website",
      "Documentation",
      "Support",
      "Technical data handling",
      "Source",
      "Open seat",
    ]) {
      const value = plain(listingField(packet, label));
      expect(value).toMatch(/^https:\/\//);
      expect(value.length).toBeLessThanOrEqual(1_024);
    }
  });

  test("does not turn preparation into a provider or legal claim", () => {
    const packet = read("marketing/DIRECTORY-SUBMISSION.md");

    expect(packet).toMatch(/technical preparation only/i);
    expect(packet).toMatch(/does not submit/i);
    expect(packet).toMatch(
      /does not[\s\S]{0,180}claim[\s>]+affiliation/i,
    );
    expect(packet).toMatch(
      /public connection guide.*does not call\s+itself a privacy policy/is,
    );
    expect(packet).toMatch(
      /Choose the exact verified publisher name used consistently/i,
    );
    expect(packet).toMatch(
      /Approve public privacy-policy and service-terms wording/i,
    );
    expect(packet).toMatch(/Do not invent `\.app\.json`/);
    expect(packet).toMatch(/stable HTTPS demo-recording URL/i);
    expect(packet).toMatch(/successful current production tool scan/i);
    expect(packet).toMatch(/per-tool annotation justifications/i);
    expect(packet).toMatch(/Verify Domain.*passes/is);
    expect(packet).toMatch(
      /fully-populated test-account rule[\s\S]{0,180}no-auth public endpoint/i,
    );
    expect(packet).toMatch(
      /- \[ \] After merge and deployment, verify the public connection and support/i,
    );
  });

  test("makes the new pages discoverable without treating discovery as consent", () => {
    const sitemap = read("apps/docs/sitemap.xml");
    const docsIndex = read("apps/docs/index.html");
    const canonPage = read("apps/docs/canon.html");
    const publicHeaders = read("apps/docs/_headers");

    expect(sitemap).toContain("https://docs.agenttool.dev/connect-canon");
    expect(sitemap).toContain("https://docs.agenttool.dev/support");
    expect(docsIndex).toContain('href="connect-canon.html"');
    expect(canonPage).toMatch(/two tools, no account,\s+and leaving is complete/is);
    expect(publicHeaders).toMatch(
      /\/connect-canon[\s\S]*v1\/mcp\/canon>; rel="describes"/,
    );
  });
});
