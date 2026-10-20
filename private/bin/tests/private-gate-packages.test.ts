/**
 * The merge-back gate's package list: private-only packages that reach shared
 * code by a `file:` dependency or by a relative path, directly or through
 * another private-only package (re-review: collab-zerone and collab-courier
 * import shared collab source by relative path).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { privateGatePackages, relativeTargets } from "../private-gate-packages.ts";
import { ALLOWLIST, ROOT, scratchDir, write } from "./fixtures.ts";

const scratch = scratchDir("gate-packages");
afterAll(scratch.cleanup);

const ci = (dependencies: Record<string, string> = {}) => JSON.stringify({ name: "x", private: true, scripts: { ci: "bun test" }, dependencies });

describe("private-gate-packages", () => {
  test("relative paths resolve from the file that holds them; paths outside the repository are dropped", () => {
    expect(relativeTargets("packages/r/tests/a.test.ts", `import { s } from "../../alpha/src/store.js";\nconst x = '../fixtures/y.json';\nconst t = \`../\${dynamic}\`;\n`)).toEqual([
      "packages/alpha/src/store.js",
      "packages/r/fixtures/y.json",
    ]);
    expect(relativeTargets("packages/r/a.ts", `"../../../outside.ts"`)).toEqual([]);
  });

  test("selects dependents by manifest, by relative path, and through another private package; skips the rest", () => {
    const root = join(scratch.dir, "repo");
    write(root, "private/projection/allowlist.json", `${JSON.stringify(ALLOWLIST, null, 2)}\n`);
    write(root, "packages/alpha/package.json", JSON.stringify({ name: "alpha" }));
    write(root, "packages/alpha/src/store.ts", "export const store = 1;\n");
    write(root, "packages/by-file/package.json", ci({ alpha: "file:../alpha" }));
    write(root, "packages/by-path/package.json", ci());
    write(root, "packages/by-path/tests/store.test.ts", 'import { store } from "../../alpha/src/store.js";\n');
    write(root, "packages/by-root-path/package.json", ci());
    write(root, "packages/by-root-path/tests/spec.test.ts", 'const spec = "../../../docs/spec.md";\n');
    write(root, "packages/through/package.json", ci({ "by-path": "file:../by-path" }));
    write(root, "packages/unrelated/package.json", ci());
    write(root, "packages/unrelated/src/own.ts", 'import "../tests/x.ts";\n');
    write(root, "packages/in-deps-only/package.json", ci());
    write(root, "packages/in-deps-only/node_modules/y/index.js", 'require("../../../alpha/src/store.ts");\n');
    write(root, "packages/no-ci/package.json", JSON.stringify({ name: "no-ci" }));
    write(root, "packages/no-ci/bridge.mjs", 'import "../alpha/src/store.ts";\n');
    const warnings: string[] = [];
    const selected = privateGatePackages(root, { warn: (line) => warnings.push(line) });
    expect(selected).toEqual([{ name: "by-file" }, { name: "by-path" }, { name: "by-root-path" }, { name: "through" }]);
    expect(warnings).toEqual(["private-gate-packages: packages/no-ci depends on shared code but has no ci script or gate command, so the merge-back gate does not run it"]);
  });

  test("in this repository it gates the private collab packages that import shared collab source", () => {
    const warnings: string[] = [];
    const selected = privateGatePackages(ROOT, { warn: (line) => warnings.push(line) });
    const names = selected.map((entry) => entry.name);
    for (const name of ["collab-courier", "collab-zerone", "correspondence-yutabase-projector", "hf-training-garden", "skills-wake-continuity"]) expect(names).toContain(name);
    expect(selected).toContainEqual({ name: "hf-training-host", command: "bun test bridge/tests" });
    expect(warnings).toEqual([]);
  });
});
