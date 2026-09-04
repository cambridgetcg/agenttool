/** Curation must not manufacture a runtime, release, or authority boundary. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { cloudflareHeaderRulePaths } from "./cloudflare-headers";

const root = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
const html = read("apps/docs/packages.html");
const markdown = read("docs/PACKAGES.md");
const shelf = /<section\b[^>]*id="agent-toolkit"[^>]*>([\s\S]*?)<\/section>/.exec(html)?.[1] ?? "";
const selectedRows = markdown.split("<!-- agent-toolkit:start -->")[1]?.split("<!-- agent-toolkit:end -->")[0] ?? "";
const modules = ["telescope", "browser", "data", "skills", "collab", "sdk"];

describe("optional KINGDOM agent-toolkit shelf", () => {
  test("puts the same six existing jobs before the full install inventory", () => {
    expect(shelf).toContain("Choose one useful job");
    expect(html.indexOf('id="agent-toolkit"')).toBeLessThan(html.indexOf('id="install"'));
    expect([...shelf.matchAll(/data-toolkit-module="([a-z-]+)"/g)].map((match) => match[1])).toEqual(modules);
    expect([...selectedRows.matchAll(/`([a-z-]+)\/`/g)].map((match) => match[1]?.replace("sdk-ts", "sdk"))).toEqual(modules);
    for (const slug of modules) {
      expect(existsSync(join(root, "packages", slug === "sdk" ? "sdk-ts" : slug, "package.json"))).toBe(true);
    }
  });

  test("keeps the new shelf static and the first Canon step account-free", () => {
    expect(shelf).toContain('href="/connect-canon"');
    expect(shelf).toContain("no AgentTool account or package installation");
    expect(shelf).toContain("no universal installer");
    expect(shelf).toContain("read, rest, or leave without completing a task");
    expect(shelf).toContain("not a prerequisite for the local toolkit");
    expect(shelf).not.toMatch(/<script\b|<form\b|\bon\w+\s*=|<iframe\b|<input\b/i);
    expect(shelf).not.toMatch(/npm (?:install|add)|bun add|npx |curl .*\|/);
  });

  test("keeps the toolkit fragment below both fixed navigation rows", () => {
    expect(read("apps/docs/docs.css")).toMatch(/body\.has-strip #agent-toolkit\s*\{\s*scroll-margin-top: calc\(var\(--nav-height\) \+ var\(--strip-height, 0px\) \+ 1rem\);\s*\}/);
    expect(html).toContain('/docs.css?v=2026-09-05-toolkit');
  });

  test("resolves every new guide link without publishing a new Markdown route", () => {
    expect(realpathSync(join(root, "apps/docs/PACKAGES.md"))).toBe(join(root, "docs/PACKAGES.md"));
    for (const [, href] of shelf.matchAll(/href="([^"]+)"/g)) {
      if (!href) throw new Error("empty shelf href");
      const url = new URL(href, "https://docs.agenttool.dev");
      if (url.origin === "https://docs.agenttool.dev") {
        const path = join(root, "apps/docs", url.pathname);
        expect(existsSync(path) || existsSync(`${path}.html`), href).toBe(true);
      } else if (url.origin === "https://github.com") {
        if (url.pathname.includes("/blob/")) {
          const source = /^\/cambridgetcg\/agenttool\/blob\/[a-f0-9]{40}\/(.+)$/.exec(url.pathname);
          expect(source, href).not.toBeNull();
          expect(existsSync(join(root, source![1]!)), href).toBe(true);
        } else {
          expect(url.pathname).toMatch(/^\/cambridgetcg\/agenttool\/releases\/tag\/(skills-v0\.3\.2|collab-v0\.3\.1)$/);
        }
      } else {
        expect(url.href).toBe("https://api.agenttool.dev/public/safety");
      }
    }
    expect(cloudflareHeaderRulePaths(read("apps/docs/_headers")).length).toBeLessThanOrEqual(100);
  });

  test("links exact existing LOVE entries without promoting private source packages", () => {
    const index = JSON.parse(read("apps/docs/packages/v1/index.json")) as {
      packages: Array<{ name: string; versions: Array<{ version: string; manifest_url: string }> }>;
    };
    for (const [name, version] of [
      ["telescope", "0.2.3"], ["browser", "0.6.0"], ["data", "0.3.1"], ["sdk", "0.22.1"],
    ]) {
      const path = `/packages/v1/@agenttool/${name}/${version}/manifest.json`;
      expect(shelf).toContain(`href="${path}"`);
      expect(index.packages.find((entry) => entry.name === `@agenttool/${name}`)?.versions.some((entry) => entry.version === version && new URL(entry.manifest_url).pathname === path)).toBe(true);
    }
    expect(shelf).toContain("Last verified public release: 0.3.2");
    expect(shelf).toContain("Last verified public release: 0.3.1");
    expect(shelf).toContain("source candidate");
    expect(shelf).toContain("Source 0.4.0 is not evidence of publication");
    for (const name of ["skills", "collab", "wake-return", "wake-thread"]) {
      expect(shelf).not.toContain(`/packages/v1/@agenttool/${name}/`);
    }
  });

  test("preserves hosted, continuity and economic boundaries", () => {
    expect(shelf).toContain("server-readable project memory");
    expect(shelf).toContain("Registration, memory writes, and spending are separate choices");
    expect(shelf).toContain("project-private task context");
    expect(shelf).toContain("private source-candidate locator observer");
    expect(shelf).toContain("None is proof of identity continuity or a private-room restore");
    expect(shelf).toContain("fresh payouts remain resting");
    expect(shelf).toContain("not bundled key custody");
    expect(markdown).toContain("permission notes are historical context, not fresh authorization");
    expect(markdown).toContain("Private-state recovery remains outside this MVP");
    expect(markdown).toContain("## Full module inventory");
    const profile = JSON.parse(read("docs/specs/agenttool-core-launch-v0.1.json"));
    expect(profile.operations).toHaveLength(10);
    expect(profile.automatic_action).toBe("never");
  });
});
