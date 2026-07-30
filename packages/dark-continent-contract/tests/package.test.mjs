import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("package remains private with zero dependencies and no lifecycle hooks", () => {
  assert.equal(packageJson.private, true);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.equal(packageJson.dependencies, undefined);
  assert.equal(packageJson.optionalDependencies, undefined);
  assert.equal(packageJson.peerDependencies, undefined);

  for (const hook of [
    "preinstall",
    "install",
    "postinstall",
    "prepare",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
  ]) {
    assert.equal(packageJson.scripts?.[hook], undefined, `${hook} must be absent`);
  }
});

test("exports expose data contracts without exporting generator scripts", () => {
  assert.deepEqual(packageJson.exports["."], {
    types: "./src/index.d.ts",
    import: "./src/index.js",
  });
  assert.equal(packageJson.types, "./src/index.d.ts");
  assert.match(packageJson.exports["./framework"], /frameworks\/.+\.json$/);
  assert.match(
    packageJson.exports["./schema/framework"],
    /schema\/framework-v0\.1\.schema\.json$/,
  );
  assert.equal(packageJson.exports["./scripts"], undefined);
});

test("package self-reference resolves the public JavaScript and JSON exports", async () => {
  const module = await import("@agenttool/dark-continent-contract");
  assert.equal(module.CONTRACT_ID, "agenttool.dark-continent/0.1");
  assert.equal(typeof module.createProjection, "function");

  const framework = await import(
    "@agenttool/dark-continent-contract/framework",
    { with: { type: "json" } },
  );
  assert.equal(
    framework.default._format,
    "agenttool-dark-continent-framework/v0.1",
  );
});
