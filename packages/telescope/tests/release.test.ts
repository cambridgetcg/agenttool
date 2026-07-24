import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { TOOL_NAME, TOOL_VERSION } from "../src/constants.js";

describe("release metadata", () => {
  test("keeps package, runtime, and public schema identities aligned", async () => {
    const packageJson = JSON.parse(
      await readFile(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      dependencies?: Record<string, string>;
      publishConfig?: { access?: string };
      exports?: Record<string, { default?: string }>;
    };

    expect(TOOL_VERSION).toBe("0.2.1");
    expect(packageJson.name).toBe(TOOL_NAME);
    expect(packageJson.version).toBe(TOOL_VERSION);
    expect(packageJson.private).toBeUndefined();
    expect(packageJson.dependencies).toBeUndefined();
    expect(packageJson.publishConfig).toEqual({ access: "public" });
    expect(packageJson.exports?.["./report.schema.json"]?.default).toBe(
      "./schema/agenttool-telescope-report-v0.2.schema.json",
    );
  });
});
