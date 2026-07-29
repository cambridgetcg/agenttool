/** The public YOUSPEAK cathedral is bundle-backed, never a database reader. */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import youspeak from "../src/routes/youspeak";

const API_ROOT = join(import.meta.dir, "..");
const ACTIVE_ROUTE = join(API_ROOT, "src", "routes", "youspeak.ts");
const DORMANT_PUBLIC_ROUTE = join(
  API_ROOT,
  "src",
  "routes",
  "public",
  "youspeak.ts",
);

describe("YOUSPEAK query containment", () => {
  test("query-shaped requests and advertisements stay absent", async () => {
    expect(
      youspeak.routes.some((route) => route.path === "/query"),
    ).toBe(false);

    for (const method of ["GET", "HEAD"]) {
      const response = await youspeak.request("/query?q=hello", { method });
      expect(response.status).toBe(404);
    }

    for (const path of ["/", "/llms.txt", "/joke?seed=containment"]) {
      const response = await youspeak.request(path);
      expect(response.status).toBe(200);
      expect(await response.text()).not.toContain("/v1/youspeak/query");
    }

    const bundleResponse = await youspeak.request("/morphemes");
    expect(bundleResponse.status).toBe(200);
    const bundleBody = (await bundleResponse.json()) as {
      count: number;
      morphemes: unknown[];
    };
    expect(bundleBody.count).toBeGreaterThan(0);
    expect(bundleBody.morphemes).toHaveLength(bundleBody.count);
  });

  test("the only YOUSPEAK route stays inside the generated-bundle boundary", () => {
    const routeFiles = [
      ...new Bun.Glob("src/routes/**/*youspeak*.ts").scanSync({
        cwd: API_ROOT,
        onlyFiles: true,
      }),
    ].sort();
    expect(routeFiles).toEqual(["src/routes/youspeak.ts"]);
    expect(existsSync(DORMANT_PUBLIC_ROUTE)).toBe(false);

    const source = readFileSync(ACTIVE_ROUTE, "utf8");
    const importSpecifiers = new Bun.Transpiler({ loader: "ts" })
      .scan(source)
      .imports.map(({ path }) => path)
      .sort();
    expect(importSpecifiers).toEqual(
      [
        "../lib/errors",
        "../lib/surface-metadata",
        "../services/youspeak/content",
        "hono",
        "node:crypto",
      ].sort(),
    );
    expect(source).not.toMatch(/\b(?:process|Bun)\.env\b/);

    for (const forbidden of [
      "DATABASE_URL",
      'from "postgres"',
      "sql.unsafe",
      "compileYouspeak",
      'app.get("/query"',
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
