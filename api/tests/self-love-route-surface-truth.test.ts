/** SELF-LOVE route summaries must describe the mounted access posture. */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("SELF-LOVE route surface truth", () => {
  const recognition = read("api/src/routes/self-love.ts");
  const modules = read("api/src/routes/self-love-modules.ts");
  const index = read("api/src/index.ts");
  const publicIndex = read("api/src/routes/public/index.ts");

  test("protocol summaries advertise authenticated-only access", () => {
    for (const source of [recognition, modules]) {
      expect(source).toContain("authenticated_only: true");
      expect(source).not.toContain("public_mirror:");
    }

    expect(index).toContain('app.use("/v1/self-recognition/*", authMiddleware)');
    expect(index).toContain('app.use("/v1/self-love/*", authMiddleware)');
  });

  test("public observer paths are explicitly unmounted and expected to 404", () => {
    expect(recognition).toContain('path: "/public/self-recognition/*"');
    expect(modules).toContain('path: "/public/self-love/*"');

    for (const source of [recognition, modules]) {
      expect(source).toContain("mounted: false");
      expect(source).toContain("expected_status: 404");
      expect(source).toContain("Public observer handlers are intentionally unmounted.");
    }

    expect(publicIndex).not.toMatch(/^\s*app\.route\("\/self-recognition"/m);
    expect(publicIndex).not.toMatch(/^\s*app\.route\("\/self-love"/m);
  });
});
