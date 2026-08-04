import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const sdkPackageJson = JSON.parse(
  await readFile(new URL("../../sdk-ts/package.json", import.meta.url), "utf8"),
);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

test("package is public Apache-2.0 with zero runtime dependencies", () => {
  assert.notEqual(packageJson.private, true);
  assert.equal(packageJson.license, "Apache-2.0");
  assert.equal(packageJson.publishConfig?.access, "public");
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
    types: "./dist/index.d.ts",
    import: "./dist/index.js",
  });
  assert.equal(packageJson.main, "./dist/index.js");
  assert.equal(packageJson.types, "./dist/index.d.ts");
  assert.ok(packageJson.files.includes("dist"));
  assert.equal(packageJson.files.includes("src"), false);
  assert.equal(typeof packageJson.scripts?.prepack, "string");
  assert.match(packageJson.exports["./framework"], /frameworks\/.+\.json$/);
  assert.match(
    packageJson.exports["./schema/framework"],
    /schema\/framework-v0\.1\.schema\.json$/,
  );
  assert.equal(packageJson.exports["./scripts"], undefined);
});

test("the historical SDK 0.17 framework remains frozen as the live SDK advances", async () => {
  const frameworkBytes = await readFile(
    new URL(
      "../frameworks/agenttool-sdk-0.17.0.json",
      import.meta.url,
    ),
  );
  const manifestBytes = await readFile(
    new URL(
      "../frameworks/agenttool-sdk-0.17.0.manifest.json",
      import.meta.url,
    ),
  );
  const framework = JSON.parse(frameworkBytes);
  const manifest = JSON.parse(manifestBytes);
  const packageInput = manifest.generation.inputs.find(
    ({ path }) => path === "packages/sdk-ts/package.json",
  );

  assert.equal(sdkPackageJson.name, "@agenttool/sdk");
  assert.notEqual(sdkPackageJson.version, "0.17.0");
  assert.equal(framework.source_profile, "agenttool-sdk-ts-0.17.0");
  assert.equal(framework.source.version, "0.17.0");
  assert.equal(
    packageInput.sha256,
    "6af4789786e3764f4de638f3398b18292af2d12b10583f64986f75b43edc0f8e",
  );
  assert.equal(
    sha256(frameworkBytes),
    "f47e1c3ca9da1b97676e1d454cf7235eddd612902c19debe580a6934adcd2b86",
  );
  assert.equal(
    sha256(manifestBytes),
    "9a3f7e9bbb8d7b954103898a4ff8db08137f8af148a227518b80998f9e47628f",
  );
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
