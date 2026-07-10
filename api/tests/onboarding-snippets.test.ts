/** Public onboarding snippets must stay on SDK APIs that actually ship. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

// HTML syntax highlighting splits expressions across <span> elements. Strip
// presentation markup before checking the copyable code readers actually see.
const visibleText = (source: string) =>
  source
    .replace(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"');

const ONBOARDING_SOURCES = [
  "apps/dashboard/index.html",
  "apps/docs/index.html",
  "apps/docs/tutorial.html",
  "apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md",
  "docs/IDENTITY-ANCHOR.md",
  "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
  "packages/sdk-ts/README.md",
  "packages/sdk-py/README.md",
] as const;

describe("public SDK onboarding snippets", () => {
  test("never advertise removed convenience methods", () => {
    for (const path of ONBOARDING_SOURCES) {
      const source = visibleText(read(path));
      expect(source, path).not.toMatch(/AgentTool\.arrive\s*\(/);
      expect(source, path).not.toMatch(/AgentTool\.fromBearer\s*\(/);
      expect(source, path).not.toMatch(/\bat\.wake\s*\(\s*\)/);
      expect(source, path).not.toContain("agenttool_sdk");
      expect(source, path).not.toContain("AgentToolClient");
    }
  });

  test("dashboard shows executable TypeScript and Python birth-to-wake shapes", () => {
    const dashboard = visibleText(read("apps/dashboard/index.html"));

    expect(dashboard).toContain(
      'import { AgentTool, bootstrapAgent, derive, generateMnemonic } from "@agenttool/sdk";',
    );
    expect(dashboard).toContain("const birth = await bootstrapAgent({");
    expect(dashboard).toContain("bundle: derive(mnemonic)");
    expect(dashboard).toContain("const at = new AgentTool({ apiKey });");
    expect(dashboard).toContain("const wake = await at.wake.get();");

    expect(dashboard).toContain(
      "from agenttool import AgentTool, bootstrap_agent, derive, generate_mnemonic",
    );
    expect(dashboard).toContain("birth = bootstrap_agent(");
    expect(dashboard).toContain("bundle=derive(mnemonic)");
    expect(dashboard).toContain("at = AgentTool(api_key=api_key)");
    expect(dashboard).toContain("wake = at.wake.get()");
  });

  test("docs and SDK READMEs carry the complete v0.8 flow", () => {
    for (const path of [
      "apps/docs/index.html",
      "apps/docs/tutorial.html",
      "apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md",
      "docs/TUTORIAL-WAKE-YOUR-AGENT.md",
      "packages/sdk-ts/README.md",
    ]) {
      const source = visibleText(read(path));
      expect(source, path).toContain("generateMnemonic");
      expect(source, path).toContain("derive(mnemonic)");
      expect(source, path).toContain("bootstrapAgent({");
      expect(source, path).toContain("new AgentTool({ apiKey })");
      expect(source, path).toContain("at.wake.get()");
    }

    const docsHome = visibleText(read("apps/docs/index.html"));
    expect(docsHome).toContain("from agenttool import AgentTool");
    expect(docsHome).toContain("ctx = at.wake.get()");
    expect(docsHome).toContain("const ctx = await at.wake.get()");

    const pythonReadme = read("packages/sdk-py/README.md");
    expect(pythonReadme).toContain("generate_mnemonic()");
    expect(pythonReadme).toContain("derive(mnemonic)");
    expect(pythonReadme).toContain("bootstrap_agent(");
    expect(pythonReadme).toContain("AgentTool(api_key=api_key)");
    expect(pythonReadme).toContain("at.wake.get()");
  });

  test("the published Markdown tutorial mirrors its canonical source", () => {
    expect(read("apps/docs/TUTORIAL-WAKE-YOUR-AGENT.md")).toBe(
      read("docs/TUTORIAL-WAKE-YOUR-AGENT.md"),
    );
  });
});
