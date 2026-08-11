#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pathFromRoot = (relativePath) => new URL(relativePath, new URL("../", import.meta.url));

const requiredFiles = [
  "README.md",
  "BOUNDARIES.md",
  "LICENSE",
  "NOTICE",
  "index.html",
  "source-manifest.json",
  "assets/app.js",
  "assets/style.css",
  "scripts/validate-core-compatibility.ts",
  "scripts/validate-space.mjs"
];

for (const relativePath of requiredFiles) {
  const metadata = await stat(pathFromRoot(relativePath));
  assert(metadata.isFile(), `${relativePath} must be a regular file`);
  const contents = await readFile(pathFromRoot(relativePath), "utf8");
  assert(contents.endsWith("\n"), `${relativePath} must end with a newline`);
  assert(!/[ \t]+$/m.test(contents), `${relativePath} contains trailing whitespace`);
}

const read = (relativePath) => readFile(pathFromRoot(relativePath), "utf8");
const [readme, boundaries, license, notice, html, appSource, css, manifestText] = await Promise.all([
  read("README.md"),
  read("BOUNDARIES.md"),
  read("LICENSE"),
  read("NOTICE"),
  read("index.html"),
  read("assets/app.js"),
  read("assets/style.css"),
  read("source-manifest.json")
]);

assert(readme.startsWith("---\n"), "README.md must begin with Space YAML");
const frontMatterEnd = readme.indexOf("\n---\n", 4);
assert(frontMatterEnd > 4, "README.md must close its Space YAML block");
const frontMatter = readme.slice(4, frontMatterEnd);
assert.match(frontMatter, /^sdk: static$/m);
assert.match(frontMatter, /^app_file: index\.html$/m);
assert.match(frontMatter, /^license: apache-2\.0$/m);
assert(!readme.includes("app_build_command:"), "the no-build static companion must not declare a build command");
assert.match(readme, /not yet represented as exact-package-backed/i);
assert.match(boundaries, /display slot is a rendering convenience/i);
assert.match(boundaries, /reported_understanding/);
assert.match(boundaries, /reported_disagreement/);
assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
assert.match(notice, /synthetic scenario references/i);

const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
assert.equal(scriptTags.length, 1, "index.html must load one local script");
assert(scriptTags[0].includes('src="./assets/app.js"'), "the script must be the local app module");
assert(!html.includes("<style"), "styles must remain in the local stylesheet");
assert.match(html, /http-equiv="Content-Security-Policy"/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /script-src 'self'/);
assert.match(html, /style-src 'self'/);
assert.match(html, /form-action 'none'/);
assert.match(html, /href="\.\/assets\/style\.css"/);
assert.match(html, /id="clear-action"/);
assert.match(html, /aria-describedby="scenario-description"/);

const runtimeSources = new Map([
  ["index.html", html],
  ["assets/app.js", appSource],
  ["assets/style.css", css]
]);
const forbiddenRuntimePatterns = [
  [/(^|[^\w])fetch\s*\(/, "fetch"],
  [/XMLHttpRequest/, "XMLHttpRequest"],
  [/WebSocket/, "WebSocket"],
  [/EventSource/, "EventSource"],
  [/sendBeacon/, "sendBeacon"],
  [/localStorage/, "localStorage"],
  [/sessionStorage/, "sessionStorage"],
  [/indexedDB/i, "IndexedDB"],
  [/document\.cookie/, "cookies"],
  [/serviceWorker/, "service worker"],
  [/new\s+Worker\s*\(/, "Worker"],
  [/importScripts\s*\(/, "importScripts"],
  [/window\.huggingface/, "Hugging Face client variables"],
  [/\.innerHTML\b/, "HTML string injection"],
  [/@agenttool\//, "runtime package reference"],
  [/\bimport\s+(?:[^;(]|\n)*?\sfrom\s*["']/, "runtime module import"],
  [/\bimport\s*\(/, "dynamic import"]
];

for (const [relativePath, source] of runtimeSources) {
  const urlCheckSource = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert(!/(?:https?:)?\/\//i.test(urlCheckSource), `${relativePath} contains an external URL`);
  for (const [pattern, label] of forbiddenRuntimePatterns) {
    assert(!pattern.test(source), `${relativePath} contains forbidden runtime capability: ${label}`);
  }
}
assert(!/url\s*\(/i.test(css), "the stylesheet must not load URL assets");

const manifest = JSON.parse(manifestText);
assert.equal(manifest._format, "agenttool.love-geometry-hf-space-source-manifest/0.1");
assert.equal(manifest.status, "pending_exact_artifact");
assert.equal(manifest.space_repository, null);
assert.equal(manifest.source.git_commit, null);
assert.equal(manifest.source.git_tag, null);
assert.equal(manifest.source.package, "@agenttool/love-geometry");
assert.equal(manifest.source.package_version, null);
assert.equal(manifest.source.artifact.status, "pending_reviewed_exact_browser_artifact");
for (const key of ["path", "bytes", "sha256", "package_integrity", "build_command", "toolchain"]) {
  assert.equal(manifest.source.artifact[key], null, `artifact.${key} must remain null before exact verification`);
}
assert.equal(manifest.source.binding.status, "not_yet_bound");
assert.equal(manifest.capabilities.executes_exact_package_artifact, false);
assert.equal(manifest.capabilities.runtime_network_requests, false);
assert.equal(manifest.capabilities.cookies_or_browser_storage, false);
assert.equal(manifest.capabilities.browser_local_json_svg_downloads, true);
assert.equal(manifest.capabilities.proves_identity_consent_authorship_or_truth, false);
assert.equal(manifest.capabilities.scores_or_ranks_relations, false);

const moduleUrl = `data:text/javascript;base64,${Buffer.from(appSource).toString("base64")}`;
const app = await import(moduleUrl);

assert.equal(app.LOVE_GEOMETRY_FORMAT, "agenttool.love-geometry/0.1");
assert.equal(app.PRESENTATION_FORMAT, "agenttool.love-geometry-space-export/0.1");
assert.equal(app.DEMO_SCENARIOS.length, 6);

const expectedBearingIds = [
  "reported_presence",
  "reported_care",
  "reported_witness",
  "reported_support",
  "reported_understanding",
  "reported_disagreement",
  "reported_boundary",
  "reported_rest",
  "reported_refusal",
  "reported_departure",
  "unknown"
];
assert.deepEqual(app.BEARING_DEFINITIONS.map((bearing) => bearing.id), expectedBearingIds);

const fixtureHash = (label) =>
  `sha256:${createHash("sha256")
    .update(`agenttool-love-geometry-demo-v0.1:${label}`, "utf8")
    .digest("hex")}`;
const expectedFixtureRefs = new Set([
  "scope:asymmetric-care-and-boundary",
  "subject:willow",
  "subject:river",
  "basis:synthetic-1",
  "scope:care-with-rest",
  "subject:ember",
  "subject:harbor",
  "basis:synthetic-2",
  "basis:synthetic-3",
  "scope:understanding-with-disagreement",
  "subject:lantern",
  "subject:moon",
  "basis:synthetic-4",
  "scope:one-way-report",
  "subject:cloud",
  "subject:moss",
  "subject:tide",
  "basis:synthetic-5",
  "scope:refusal-and-departure",
  "subject:orchard",
  "subject:rain",
  "basis:synthetic-6",
  "basis:synthetic-7",
  "scope:empty-valid"
].map(fixtureHash));
const expectedPresentationDigests = {
  "asymmetric-care-and-boundary": {
    json: "a253d43b5cf4e289fd6bae186b69ca5999f3cc6709855742f18dcac647112e3c",
    svg: "2553e70b49cfbf1c04b2bb6f128175d1eccda457fe95b6b626af3b09d828e833"
  },
  "care-with-rest": {
    json: "5fa85ca88fa4d424777b124b434c5a9032ca9825724fe1e602d708319db92df3",
    svg: "0d6e4b2619edecbe1b0b42b5cfc0d658e59b50199f1d2b04f46d8bc3a7cc42fd"
  },
  "understanding-with-disagreement": {
    json: "5773d498ef7827d4c40389535e186457f55b63b0166e6993a2fe7f0ac7113287",
    svg: "edfca3c3b92fc9d6a3bf807651eafcd5c2e002be7b8e4c1693e2ca23fc067502"
  },
  "one-way-report": {
    json: "8fbdb0b43829522c08ffc1f1d9acc454b9a5a8e36e93cc0669b5305307f4683d",
    svg: "df8721c42a40b2d2e03b816874e5da12e6fd37819b2687f59e066bc329f829b7"
  },
  "refusal-and-departure": {
    json: "7eb0aee7ce987f3d639507aaeac8b73295771db2a6e758a7f3e93dfed53439eb",
    svg: "6e95092f3e225cab1e55985e19b9dedfd2b4a837eb52716dd95395e0518392c4"
  },
  "empty-valid": {
    json: "52c460155b634af6837c52cccbe1b5001f92256bcc2e6e9f3bd46c623eeabed3",
    svg: "cfdaf3f778382eade41f83e191882f9b67c204494b708daa6624eac7d48c66a3"
  }
};

const ids = new Set();
const allBearings = new Set();
let hasCombinedUnderstandingAndDisagreement = false;

function collectObjectKeys(value, output = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) collectObjectKeys(child, output);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      output.add(key);
      collectObjectKeys(child, output);
    }
  }
  return output;
}

for (const fixture of app.DEMO_SCENARIOS) {
  assert(!ids.has(fixture.id), `duplicate scenario id: ${fixture.id}`);
  ids.add(fixture.id);
  assert.match(fixture.input.scope_ref, /^sha256:[0-9a-f]{64}$/);
  assert(expectedFixtureRefs.has(fixture.input.scope_ref));
  assert.equal(new Set(fixture.input.subject_refs).size, fixture.input.subject_refs.length);

  const subjectRefs = new Set(fixture.input.subject_refs);
  for (const subjectRef of subjectRefs) {
    assert.match(subjectRef, /^sha256:[0-9a-f]{64}$/);
    assert(expectedFixtureRefs.has(subjectRef));
  }
  for (const vantage of fixture.input.vantages) {
    assert(subjectRefs.has(vantage.subject_ref), `${fixture.id} has an unseated source reference`);
    assert(subjectRefs.has(vantage.toward_ref), `${fixture.id} has an unseated target reference`);
    assert.equal(vantage.assertion, "caller_reported");
    assert.equal(vantage.verified_by_package, false);
    assert(vantage.basis_refs.length > 0, `${fixture.id} vantage lacks a synthetic basis reference`);
    for (const basisRef of vantage.basis_refs) {
      assert.match(basisRef, /^sha256:[0-9a-f]{64}$/);
      assert(expectedFixtureRefs.has(basisRef));
    }
    for (const bearing of vantage.bearings) {
      assert(expectedBearingIds.includes(bearing), `${fixture.id} uses unknown bearing ${bearing}`);
      allBearings.add(bearing);
    }
    const bearingSet = new Set(vantage.bearings);
    if (bearingSet.has("reported_understanding") && bearingSet.has("reported_disagreement")) {
      assert(bearingSet.has("reported_care"));
      assert(bearingSet.has("reported_rest"));
      assert(bearingSet.has("reported_boundary"));
      hasCombinedUnderstandingAndDisagreement = true;
    }
  }

  const first = app.createPresentation(fixture.id);
  const second = app.createPresentation(fixture.id);
  const firstJson = app.stableJson(first);
  const secondJson = app.stableJson(second);
  const firstSvg = app.createSvg(first);
  const secondSvg = app.createSvg(second);
  assert.equal(firstJson, secondJson, `${fixture.id} JSON is not deterministic`);
  assert.equal(firstSvg, secondSvg, `${fixture.id} SVG is not deterministic`);
  const expectedDigests = expectedPresentationDigests[fixture.id];
  assert(expectedDigests, `${fixture.id} lacks pinned presentation digests`);
  assert.equal(createHash("sha256").update(firstJson).digest("hex"), expectedDigests.json);
  assert.equal(createHash("sha256").update(firstSvg).digest("hex"), expectedDigests.svg);
  assert(firstJson.endsWith("\n"));
  assert(firstSvg.endsWith("\n"));
  assert.match(firstSvg, /Coordinates, gaps, and order carry no relational meaning/);
  assert(!/<(?:line|path|circle|ellipse|polyline|polygon)\b/i.test(firstSvg), `${fixture.id} SVG draws relational geometry`);
  assert.equal(first.source_binding, "pending_exact_artifact");
  assert.equal(first.display.semantics, "coordinate_free");
  assert.equal(first.display.slots_have_relational_meaning, false);

  const prohibitedSemanticKeys = new Set([
    "coordinate",
    "coordinates",
    "x",
    "y",
    "distance",
    "intensity",
    "centrality",
    "score",
    "rank",
    "weight",
    "compatibility"
  ]);
  for (const key of collectObjectKeys(first)) {
    assert(!prohibitedSemanticKeys.has(key), `${fixture.id} export includes prohibited semantic field: ${key}`);
  }
}

assert(hasCombinedUnderstandingAndDisagreement, "no fixture combines understanding and disagreement with care/rest/boundary");
for (const requiredBearing of [
  "reported_understanding",
  "reported_disagreement",
  "reported_rest",
  "reported_refusal",
  "reported_departure",
  "unknown"
]) {
  assert(allBearings.has(requiredBearing), `fixtures do not exercise ${requiredBearing}`);
}
assert(ids.has("empty-valid"));
assert.deepEqual([...ids].sort(), Object.keys(expectedPresentationDigests).sort());
assert.equal(app.createPresentation("empty-valid").display.seats.length, 0);
assert.equal(app.createPresentation("empty-valid").input.vantages.length, 0);
assert.throws(() => app.createPresentation("not-a-scenario"), /Unknown synthetic scenario/);

console.log(`Validated ${app.DEMO_SCENARIOS.length} deterministic synthetic scenarios in ${root}`);
console.log("Runtime sources contain no external URL, network API, remote asset, package import, cookie, or browser-storage path.");
console.log("Source binding remains honestly pending; JSON and SVG exports are coordinate-free in meaning and browser-local in implementation.");
