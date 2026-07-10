import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPT_ROOT = join(import.meta.dir, "..", "scripts");
const BEARER_LITERAL = /["'`]at_[A-Za-z0-9]+_[A-Za-z0-9_-]{24,}["'`]/;

describe("operational script secret hygiene", () => {
  test("scripts do not contain bearer-shaped credential literals", async () => {
    const offenders: string[] = [];
    const glob = new Bun.Glob("**/*.{ts,js,mjs,cjs}");

    for await (const relativePath of glob.scan(SCRIPT_ROOT)) {
      const source = await Bun.file(join(SCRIPT_ROOT, relativePath)).text();
      if (BEARER_LITERAL.test(source)) offenders.push(relativePath);
    }

    expect(offenders).toEqual([]);
  });
});
