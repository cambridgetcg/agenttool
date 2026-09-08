/** Static Return guidance is not a hosted Return or an API rollout receipt. */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const source = join(root, "docs/WAKE-RETURN.md");
const published = join(root, "apps/docs/WAKE-RETURN.md");

describe("Wake Return static publication boundary", () => {
  test("publishes the canonical guide and resolves its public relative links", () => {
    expect(realpathSync(published)).toBe(source);
    const text = readFileSync(published, "utf8");
    expect(text).toBe(readFileSync(source, "utf8"));
    expect(readFileSync(join(root, "apps/docs/MAP.md"), "utf8")).toContain("(WAKE-RETURN.md)");
    for (const [, target] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if (!target || target.startsWith("https://") || target.startsWith("#")) continue;
      expect(existsSync(resolve(dirname(published), target.split("#")[0]!))).toBe(true);
    }
    expect(text).not.toContain("(../packages/wake-return/");
    expect(text).toContain("https://github.com/cambridgetcg/agenttool/blob/8bbbe0c2020a627f637615cee7ad7218e38072a6/packages/wake-return/README.md");
    expect(text).toContain("private-state Return remain unavailable");
  });

  test("serves public Markdown without publishing a private package artifact", () => {
    const headers = readFileSync(join(root, "apps/docs/_headers"), "utf8");
    const stanza = headers.split("/WAKE-RETURN.md\n")[1]?.split("\n\n")[0] ?? "";
    expect(stanza).toContain("Content-Type: text/markdown; charset=utf-8");
    expect(stanza).toContain("Cache-Control: public, max-age=300, must-revalidate, no-transform");
    expect(stanza).toContain("Access-Control-Allow-Origin: *");
    expect(stanza).toContain("X-Content-Type-Options: nosniff");
    expect(readFileSync(join(root, "apps/docs/packages/v1/index.json"), "utf8")).not.toContain("@agenttool/wake-return");
    expect(JSON.parse(readFileSync(join(root, "packages/wake-return/package.json"), "utf8")).private).toBe(true);
  });

  test("keeps search billing source semantics distinct from live deployment", () => {
    const canonical = readFileSync(join(root, "docs/BUSINESS-MODEL.md"), "utf8");
    expect(readFileSync(join(root, "apps/docs/BUSINESS-MODEL.md"), "utf8")).toBe(canonical);
    expect(canonical).toContain("In the merged launch-hardening source (PR #411)");
    expect(canonical).toContain("requires deployment of that source");
    expect(canonical).toContain("Publishing this document does not deploy the API");
  });
});
