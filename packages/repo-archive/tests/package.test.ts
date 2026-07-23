import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  PACKAGE_NAME,
  PACKAGE_VERSION,
} from "../src/index.js";

describe("package boundary", () => {
  test("keeps package identity and bundled protocol artifacts aligned", async () => {
    const pkg = JSON.parse(
      await readFile(join(import.meta.dir, "..", "package.json"), "utf8"),
    ) as {
      name: string;
      version: string;
      private?: boolean;
      publishConfig?: { access?: string };
      exports?: Record<string, { default?: string }>;
      scripts?: Record<string, string>;
      files?: string[];
      peerDependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };
    expect(pkg.name).toBe(PACKAGE_NAME);
    expect(pkg.version).toBe(PACKAGE_VERSION);
    expect(pkg.private).toBeUndefined();
    expect(pkg.publishConfig).toEqual({ access: "public" });
    expect(pkg.exports?.["./schema.json"]?.default)
      .toBe("./schema/agent-repo-archive-v0.1.schema.json");
    expect(pkg.exports?.["./vectors.json"]?.default)
      .toBe("./vectors/agent-repo-archive-v0.1-vectors.json");
    expect(pkg.files).toContain("schema");
    expect(pkg.files).toContain("vectors");
    expect(pkg.scripts?.prepack).toBe("bun run ci");
    expect(pkg.peerDependencies?.["@agenttool/adds"]).toBe("^0.2.1");
    expect(pkg.devDependencies?.["@agenttool/adds"]).toBe("0.2.1");
    expect(pkg.overrides).toBeUndefined();
  });
});
