#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const allowedArgs = new Set(["--release", "--source"]);
assert(
  args.length === new Set(args).size && args.every((arg) => allowedArgs.has(arg)),
  "usage: node scripts/validate-space.mjs [--release] [--source]"
);
const requireBoundRelease = args.includes("--release");
const requireSourceCommit = args.includes("--source");
assert(!requireSourceCommit || requireBoundRelease, "--source requires --release");
const root = fileURLToPath(new URL("../", import.meta.url));
const pathFromRoot = (relativePath) =>
  new URL(relativePath, new URL("../", import.meta.url));

const requiredFiles = [
  "README.md",
  "BOUNDARIES.md",
  "LICENSE",
  "NOTICE",
  "index.html",
  "source-manifest.json",
  "assets/app.js",
  "assets/return-geometry.css",
  "assets/return-geometry.js",
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
const [
  readme,
  boundaries,
  license,
  notice,
  html,
  appSource,
  returnSource,
  css,
  returnCss,
  manifestText,
  validatorSource
] = await Promise.all([
  read("README.md"),
  read("BOUNDARIES.md"),
  read("LICENSE"),
  read("NOTICE"),
  read("index.html"),
  read("assets/app.js"),
  read("assets/return-geometry.js"),
  read("assets/style.css"),
  read("assets/return-geometry.css"),
  read("source-manifest.json"),
  read("scripts/validate-space.mjs")
]);

assert(readme.startsWith("---\n"), "README.md must begin with Space YAML");
const frontMatterEnd = readme.indexOf("\n---\n", 4);
assert(frontMatterEnd > 4, "README.md must close its Space YAML block");
const frontMatter = readme.slice(4, frontMatterEnd);
assert.match(frontMatter, /^sdk: static$/m);
assert.match(frontMatter, /^app_file: index\.html$/m);
assert.match(frontMatter, /^license: apache-2\.0$/m);
const shortDescription = frontMatter.match(/^short_description: (.+)$/m)?.[1];
assert(shortDescription, "Space YAML must include short_description");
assert(shortDescription.length <= 60, "Space short_description must be at most 60 characters");
assert(!readme.includes("app_build_command:"), "the no-build static companion must not declare a build command");
assert.match(readme, /not represented as\s+exact-package-backed/i);
assert.match(readme, /Return Geometry/);
assert.match(readme, /Yu-and-Ai\/love-geometry/);
assert.match(readme, /provider-derived surface/i);
assert.match(readme, /upstream-only/i);
assert.match(boundaries, /display slot is a rendering convenience/i);
assert.match(boundaries, /reported_understanding/);
assert.match(boundaries, /reported_disagreement/);
assert.match(boundaries, /event time/i);
assert.match(boundaries, /After is not because/i);
assert.match(boundaries, /writes no KARMA/i);
assert.match(boundaries, /exact repository-byte verification/i);
assert.match(boundaries, /not claimed to match\s+the checked-in `index\.html`/i);
assert.match(license, /Apache License\s+Version 2\.0, January 2004/);
assert.match(notice, /synthetic scenario references/i);
assert.match(notice, /Return Geometry/i);

const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
assert.equal(scriptTags.length, 1, "index.html must load one local script");
assert(scriptTags[0].includes('src="./assets/return-geometry.js"'), "the entry script must be the local Return Geometry module");
assert(!html.includes("<style"), "styles must remain in local stylesheets");
assert.match(html, /http-equiv="Content-Security-Policy"/);
assert.match(html, /connect-src 'none'/);
assert.match(html, /script-src 'self'/);
assert.match(html, /style-src 'self'/);
assert.match(html, /form-action 'none'/);
assert.match(html, /href="\.\/assets\/style\.css"/);
assert.match(html, /href="\.\/assets\/return-geometry\.css"/);
for (const id of [
  "clear-action",
  "return-geometry",
  "return-present",
  "return-clear",
  "return-projection",
  "return-event-list",
  "return-profile",
  "return-choice-gate",
  "download-return-json",
  "download-return-svg",
  "return-status",
  "philosophy"
]) {
  assert.match(html, new RegExp(`id="${id}"`), `index.html is missing #${id}`);
}
assert.match(html, /aria-describedby="scenario-description"/);
assert.match(html, /aria-describedby="return-scenario-description"/);
assert.match(html, /role="status"/);

const runtimeSources = new Map([
  ["index.html", html],
  ["assets/app.js", appSource],
  ["assets/return-geometry.js", returnSource],
  ["assets/style.css", css],
  ["assets/return-geometry.css", returnCss]
]);
const allowedReturnImport = 'import { stableJson } from "./app.js";';
assert.equal(returnSource.split(allowedReturnImport).length - 1, 1, "Return Geometry must have exactly one fixed local import");
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
  [/navigator\.clipboard/, "clipboard"],
  [/\.innerHTML\b/, "HTML string injection"],
  [/@agenttool\//, "runtime package reference"],
  [/\bimport\s+(?:[^;(]|\n)*?\sfrom\s*["']/, "unreviewed runtime module import"],
  [/\bimport\s*\(/, "dynamic import"],
  [/setInterval\s*\(/, "background interval"]
];

for (const [relativePath, source] of runtimeSources) {
  const urlCheckSource = source.replaceAll("http://www.w3.org/2000/svg", "");
  assert(!/(?:https?:)?\/\//i.test(urlCheckSource), `${relativePath} contains an external URL`);
  const capabilityCheckSource = relativePath === "assets/return-geometry.js"
    ? source.replace(allowedReturnImport, "")
    : source;
  for (const [pattern, label] of forbiddenRuntimePatterns) {
    assert(!pattern.test(capabilityCheckSource), `${relativePath} contains forbidden runtime capability: ${label}`);
  }
}
assert(!/url\s*\(/i.test(css), "the base stylesheet must not load URL assets");
assert(!/url\s*\(/i.test(returnCss), "the Return Geometry stylesheet must not load URL assets");

const manifest = JSON.parse(manifestText);
assert.equal(manifest._format, "agenttool.love-geometry-hf-space-source-manifest/0.2");
assert(
  ["space_successor_source_pending", "space_successor_source_bound"].includes(manifest.status),
  "manifest status is unsupported"
);
if (requireBoundRelease) {
  assert.equal(manifest.status, "space_successor_source_bound", "release validation requires an exact source commit binding");
}
assert.equal(manifest.presentation_revision, "0.2.0");
assert.equal(manifest.space_repository, "https://huggingface.co/spaces/Yu-and-Ai/love-geometry");
assert.equal(manifest.source.git_repository, "https://github.com/cambridgetcg/agenttool");
assert.equal(manifest.source.git_subdirectory, "packages/love-geometry/hf-space");
assert.match(manifest.platform_boundary, /does not self-attest the current Space revision/i);
assert.equal(manifest.source.package, "@agenttool/love-geometry");
assert.equal(manifest.source.package_version, null);
assert.equal(manifest.source.artifact.status, "pending_reviewed_exact_browser_artifact");
for (const key of ["path", "bytes", "sha256", "package_integrity", "build_command", "toolchain"]) {
  assert.equal(manifest.source.artifact[key], null, `artifact.${key} must remain null while the package artifact is unbound`);
}
assert.equal(manifest.source.base_lineage.git_commit, "19cc1721b5f1c32d21edbd3962a67ce3dc8b1aa5");
assert.deepEqual(manifest.source.base_lineage.unchanged_paths, ["assets/app.js", "assets/style.css"]);
const unchangedSources = new Map([
  ["assets/app.js", appSource],
  ["assets/style.css", css]
]);
for (const [relativePath, source] of unchangedSources) {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.source.base_lineage.sha256[relativePath],
    `base lineage must bind unchanged ${relativePath}`
  );
}
assert.equal(
  manifest.source.base_lineage.predecessor_index_sha256,
  "f25c90f858da742ca2db430e07ed5598fa356de4e9958aad973189ae49b0f417"
);
const expectedRuntimePaths = [
  "assets/app.js",
  "assets/return-geometry.css",
  "assets/return-geometry.js",
  "assets/style.css",
  "index.html"
];
assert.deepEqual(manifest.source.runtime_binding.paths, expectedRuntimePaths, "runtime binding paths must be fixed and sorted");
assert.deepEqual(Object.keys(manifest.source.runtime_binding.sha256).sort(), expectedRuntimePaths);
for (const [relativePath, source] of runtimeSources) {
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    manifest.source.runtime_binding.sha256[relativePath],
    `runtime binding must bind ${relativePath}'s exact bytes`
  );
}
if (manifest.status === "space_successor_source_pending") {
  assert.equal(manifest.source.git_commit, null);
  assert.equal(manifest.source.runtime_binding.status, "exact_runtime_bytes_source_commit_pending");
  assert.equal(manifest.validation.result, "runtime_verified_source_commit_pending");
} else {
  assert.match(manifest.source.git_commit, /^[0-9a-f]{40}$/);
  assert.equal(manifest.source.runtime_binding.status, "exact_space_successor_runtime_source");
  assert.equal(manifest.validation.result, "space_successor_runtime_verified_package_artifact_unbound");
}
assert.match(manifest.validation.verified_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
assert.match(manifest.validation.validator_sha256, /^[0-9a-f]{64}$/);
assert.equal(
  createHash("sha256").update(validatorSource).digest("hex"),
  manifest.validation.validator_sha256,
  "validation.validator_sha256 must bind this validator's exact bytes"
);
assert.equal(manifest.validation.command, "node scripts/validate-space.mjs --release");
assert.equal(
  manifest.validation.source_command,
  "node scripts/validate-space.mjs --release --source"
);
assert.equal(
  manifest.validation.core_compatibility_command,
  "bun scripts/validate-core-compatibility.ts"
);
if (requireSourceCommit) {
  const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
  execFileSync("git", ["cat-file", "-e", `${manifest.source.git_commit}^{commit}`], {
    cwd: gitRoot,
    stdio: "ignore"
  });
  execFileSync("git", ["merge-base", "--is-ancestor", manifest.source.git_commit, "HEAD"], {
    cwd: gitRoot,
    stdio: "ignore"
  });
  for (const relativePath of expectedRuntimePaths) {
    const sourceBytes = execFileSync(
      "git",
      [
        "show",
        `${manifest.source.git_commit}:${manifest.source.git_subdirectory}/${relativePath}`
      ],
      { cwd: gitRoot, maxBuffer: 2 * 1024 * 1024 }
    );
    assert.equal(
      createHash("sha256").update(sourceBytes).digest("hex"),
      manifest.source.runtime_binding.sha256[relativePath],
      `source commit does not bind ${relativePath}`
    );
  }
}
assert.equal(manifest.capabilities.executes_exact_package_artifact, false);
assert.equal(manifest.capabilities.uses_synthetic_inputs_only, true);
assert.equal(manifest.capabilities.app_initiated_runtime_network_requests, false);
assert.equal(manifest.capabilities.external_form_transmission, false);
assert.equal(manifest.capabilities.runtime_package_fetch, false);
assert.equal(manifest.capabilities.remote_assets, false);
assert.equal(manifest.capabilities.model_inference, false);
assert.equal(manifest.capabilities.oauth_or_secrets, false);
assert.equal(manifest.capabilities.cookies_or_browser_storage, false);
assert.equal(manifest.capabilities.server_persistence, false);
assert.equal(manifest.capabilities.browser_local_json_svg_downloads, true);
assert.equal(manifest.capabilities.return_geometry_teaching_traces, true);
assert.equal(manifest.capabilities.writes_karma, false);
assert.equal(manifest.capabilities.automatic_next_turn, false);
assert.equal(manifest.capabilities.proves_identity_consent_authorship_or_truth, false);
assert.equal(manifest.capabilities.scores_or_ranks_relations, false);

const app = await import(pathFromRoot("assets/app.js"));
const returns = await import(pathFromRoot("assets/return-geometry.js"));

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
  `sha256:${createHash("sha256").update(`agenttool-love-geometry-demo-v0.1:${label}`, "utf8").digest("hex")}`;
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

const loveIds = new Set();
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
  assert(!loveIds.has(fixture.id), `duplicate scenario id: ${fixture.id}`);
  loveIds.add(fixture.id);
  assert.match(fixture.input.scope_ref, /^sha256:[0-9a-f]{64}$/);
  assert(expectedFixtureRefs.has(fixture.input.scope_ref));
  assert.equal(new Set(fixture.input.subject_refs).size, fixture.input.subject_refs.length);
  const subjectRefs = new Set(fixture.input.subject_refs);
  for (const subjectRef of subjectRefs) {
    assert.match(subjectRef, /^sha256:[0-9a-f]{64}$/);
    assert(expectedFixtureRefs.has(subjectRef));
  }
  for (const item of fixture.input.vantages) {
    assert(subjectRefs.has(item.subject_ref));
    assert(subjectRefs.has(item.toward_ref));
    assert.equal(item.assertion, "caller_reported");
    assert.equal(item.verified_by_package, false);
    assert(item.basis_refs.length > 0);
    for (const basisRef of item.basis_refs) {
      assert.match(basisRef, /^sha256:[0-9a-f]{64}$/);
      assert(expectedFixtureRefs.has(basisRef));
    }
    for (const bearing of item.bearings) {
      assert(expectedBearingIds.includes(bearing));
      allBearings.add(bearing);
    }
    const bearingSet = new Set(item.bearings);
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
  const firstSvg = app.createSvg(first);
  assert.equal(firstJson, app.stableJson(second));
  assert.equal(firstSvg, app.createSvg(second));
  assert.equal(createHash("sha256").update(firstJson).digest("hex"), expectedPresentationDigests[fixture.id].json);
  assert.equal(createHash("sha256").update(firstSvg).digest("hex"), expectedPresentationDigests[fixture.id].svg);
  assert(firstJson.endsWith("\n"));
  assert(firstSvg.endsWith("\n"));
  assert.match(firstSvg, /Coordinates, gaps, and order carry no relational meaning/);
  assert(!/<(?:line|path|circle|ellipse|polyline|polygon)\b/i.test(firstSvg));
  assert.equal(first.source_binding, "pending_exact_artifact");
  assert.equal(first.display.semantics, "coordinate_free");
  assert.equal(first.display.slots_have_relational_meaning, false);
  for (const key of collectObjectKeys(first)) {
    assert(!new Set([
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
    ]).has(key), `${fixture.id} export includes prohibited semantic field: ${key}`);
  }
}
assert(hasCombinedUnderstandingAndDisagreement);
for (const requiredBearing of [
  "reported_understanding",
  "reported_disagreement",
  "reported_rest",
  "reported_refusal",
  "reported_departure",
  "unknown"
]) assert(allBearings.has(requiredBearing));
assert(loveIds.has("empty-valid"));
assert.deepEqual([...loveIds].sort(), Object.keys(expectedPresentationDigests).sort());
assert.equal(app.createPresentation("empty-valid").display.seats.length, 0);
assert.equal(app.createPresentation("empty-valid").input.vantages.length, 0);
assert.throws(() => app.createPresentation("not-a-scenario"), /Unknown synthetic scenario/);

assert.equal(returns.RETURN_GEOMETRY_FORMAT, "agenttool.love-geometry-return-space-export/0.1");
assert.equal(returns.RETURN_FIXTURE_NAMESPACE, "agenttool-return-geometry-demo-v0.1:");
assert.equal(returns.RETURN_SCENARIOS.length, 6);
assert.deepEqual(returns.RETURN_KINDS, [
  "expectation",
  "action",
  "consequence",
  "response",
  "correction",
  "repair",
  "boundary",
  "learning"
]);
assert.deepEqual(returns.RETURN_PROFILE_STATES, [
  "supplied",
  "no_supplied_record",
  "explicitly_unknown",
  "withheld",
  "not_applicable"
]);

const returnHash = (label) =>
  `sha256:${createHash("sha256").update(`${returns.RETURN_FIXTURE_NAMESPACE}${label}`, "utf8").digest("hex")}`;
const returnLabels = [
  "after-not-because:scope",
  "after-not-because:subject-a",
  "after-not-because:subject-b",
  "after-not-because:source",
  "after-not-because:expectation",
  "after-not-because:action",
  "after-not-because:consequence",
  "after-not-because:learning",
  "reply-correction-branch:scope",
  "reply-correction-branch:subject-a",
  "reply-correction-branch:subject-b",
  "reply-correction-branch:source",
  "reply-correction-branch:action",
  "reply-correction-branch:consequence",
  "reply-correction-branch:response",
  "reply-correction-branch:correction",
  "reply-correction-branch:boundary",
  "repair-new-deed:scope",
  "repair-new-deed:subject-a",
  "repair-new-deed:subject-b",
  "repair-new-deed:source",
  "repair-new-deed:action",
  "repair-new-deed:consequence",
  "repair-new-deed:response",
  "repair-new-deed:expectation",
  "repair-new-deed:repair",
  "repair-new-deed:post-consequence",
  "redaction-before-chain:scope",
  "redaction-before-chain:subject-a",
  "redaction-before-chain:subject-b",
  "redaction-before-chain:source",
  "redaction-before-chain:action",
  "redaction-before-chain:response",
  "redaction-before-chain:correction",
  "redaction-before-chain:boundary",
  "undecidable-one-way:scope",
  "undecidable-one-way:subject-a",
  "undecidable-one-way:subject-b",
  "undecidable-one-way:source",
  "undecidable-one-way:action",
  "undecidable-one-way:consequence",
  "empty-return:scope"
];
const expectedReturnRefs = new Set(returnLabels.map(returnHash));
const observedReturnRefs = new Set();
const expectedReturnDigests = {
  "after-not-because": {
    json: "4adcdf66592136a67f6b454711138df2719ec086d8e21858c45fc50709a2ce37",
    svg: "f50d5fb537b039366da12bf75a588be04b34f496783a32b1e7a5048d20cff795"
  },
  "reply-correction-branch": {
    json: "5c64377eaf4715640e14d5b36f67066a7b34d3ba00754a1d511e2fe83ff61b36",
    svg: "ac1fabb9799ac72fc5a627bdce0e24eda4f21ca440b24470ce7b4d025513101b"
  },
  "repair-new-deed": {
    json: "22c38199a6aa70c44c8e089c7575bbebbd7b732d37b6b80e35b50d70b1565d61",
    svg: "63a96f0646a88084106e7f39c008595a8fb4d85f8554e435f050c31270255832"
  },
  "redaction-before-chain": {
    json: "689976326dbf128e595a711ae5f38ff50dbcf43e664c1f9d8c41293a18d0314c",
    svg: "dfe073c48442cd4781a7cb1eedf6d377a5de51632fc6fe29a318f20625b29452"
  },
  "undecidable-one-way": {
    json: "5c31450dda2842e1e9630c552e296f76be2d421777838f88eef1dc16586ae54d",
    svg: "e80a246e2906f89e21edaf3429e8e90a57e75bbe03bf8d25df185d82e590f9b1"
  },
  "empty-return": {
    json: "f5dcec8aa97e1db811ccb4481bf1e1905533ca93572ce0c7d3bce8d6266d6d69",
    svg: "87231ea93c9921816be563377db5e31fb4977b0c5728743d1350fa7b46fe70d8"
  }
};

const returnIds = new Set();
for (const fixture of returns.RETURN_SCENARIOS) {
  assert(!returnIds.has(fixture.id), `duplicate return scenario: ${fixture.id}`);
  returnIds.add(fixture.id);
  observedReturnRefs.add(fixture.scope_ref);
  observedReturnRefs.add(fixture.source_ref);
  fixture.subject_refs.forEach((ref) => observedReturnRefs.add(ref));
  fixture.events.forEach((item) => observedReturnRefs.add(item.event_ref));
  const first = returns.createReturnGeometry(fixture.id);
  const second = returns.createReturnGeometry(fixture.id);
  const firstJson = app.stableJson(first);
  const firstSvg = returns.createReturnSvg(first);
  assert.equal(firstJson, app.stableJson(second));
  assert.equal(firstSvg, returns.createReturnSvg(second));
  assert.equal(createHash("sha256").update(firstJson).digest("hex"), expectedReturnDigests[fixture.id].json);
  assert.equal(createHash("sha256").update(firstSvg).digest("hex"), expectedReturnDigests[fixture.id].svg);
  assert(firstJson.endsWith("\n"));
  assert(firstSvg.endsWith("\n"));
  assert.match(firstSvg, /claimed fixture sequence only/i);
  assert.match(firstSvg, /no next action chosen, scheduled, permitted, or rewarded/i);
  assert.equal(first.signed, false);
  assert.equal(first.verified_by_karma, false);
  assert.equal(first.writes_karma, false);
  assert.equal(first.automatic_or_karma_effect, "none");
  assert.equal(first.explicit_browser_download_available, true);
  assert.equal(first.event_time.event_graph_is_acyclic, true);
  assert.equal(first.event_time.world_chronology_verified, false);
  assert.equal(first.choice_gate.next_action_chosen, false);
  assert.equal(first.choice_gate.next_action_scheduled, false);
  assert.equal(first.choice_gate.authority_inferred, false);
  assert.equal(first.choice_gate.continuation_requested, false);
  assert.equal(first.display.spacing_or_branch_placement_has_relational_meaning, false);
  assert.equal(first.display.role_order_has_relational_meaning, false);
  assert.equal(first.display.role_label_rule, "fixture subject order for repeatable display only");
  for (const item of first.categorical_return) {
    assert(returns.RETURN_PROFILE_STATES.includes(item.state));
    assert.equal(Object.hasOwn(item, "value"), false);
    assert(Array.isArray(item.event_refs));
    assert(["derived_from_context_events", "fixture_declared_boundary"].includes(item.basis));
    assert.equal(typeof item.reason, "string");
    assert(item.reason.length > 0);
  }
  for (const edge of first.relationship_projection.edges) {
    assert(first.fixture.subject_refs.includes(edge.from_ref));
    assert(first.fixture.subject_refs.includes(edge.toward_ref));
    assert.notEqual(edge.from_ref, edge.toward_ref);
    assert.equal(edge.assertion, "synthetic_caller_report");
  }
  const roleByRef = new Map(
    first.display.subject_labels.map((item) => [item.subject_ref, item.label])
  );
  for (const item of first.fixture.events) {
    if (item.vantage && /^synthetic role [AB]$/.test(item.statement.speaker_claim)) {
      assert.equal(
        roleByRef.get(item.vantage.subject_ref),
        item.statement.speaker_claim.replace("synthetic role", "Role"),
        `${fixture.id} display role disagrees with its claimed speaker`
      );
    }
  }
  for (const key of collectObjectKeys(first)) {
    assert(!new Set([
      "coordinate",
      "coordinates",
      "distance",
      "intensity",
      "centrality",
      "score",
      "rank",
      "weight",
      "compatibility",
      "reward"
    ]).has(key), `${fixture.id} return export includes prohibited semantic field: ${key}`);
  }
}

assert.deepEqual(observedReturnRefs, expectedReturnRefs);
assert.deepEqual([...returnIds].sort(), Object.keys(expectedReturnDigests).sort());
const branchFocus = returns.createReturnGeometry(
  "reply-correction-branch",
  "sha256:7ed22f9e11c5e0161d30ff5b36ba60013c26fa2102a31dd545875b9d04b42bc4"
);
assert.equal(branchFocus.fixture.events.length, 5);
assert(branchFocus.fixture.events.some((item) => item.kind === "response"), "correction focus hid the sibling response");
assert(branchFocus.fixture.events.some((item) => item.kind === "boundary"), "correction focus hid the response descendant boundary");
const repairFocus = returns.createReturnGeometry(
  "repair-new-deed",
  "sha256:8acc450db72fc36b4c27cb62fbd7721fcfdff6e1be439715a1ec7e7e9e0ff70c"
);
assert.equal(repairFocus.fixture.events.length, 6);
assert(repairFocus.fixture.events.some((item) => item.kind === "expectation"), "action focus hid the repair's linked expectation");
for (const fixture of returns.RETURN_SCENARIOS) {
  for (const focus of fixture.events) {
    const focused = returns.createReturnGeometry(fixture.id, focus.event_ref);
    const focusedRefs = new Set(focused.fixture.events.map((item) => item.event_ref));
    for (const item of focused.fixture.events) {
      assert(
        item.parent_event_ref === null || focusedRefs.has(item.parent_event_ref),
        `${fixture.id} focus ${focus.event_ref} left a displayed child without its parent`
      );
      assert(
        !/^sha256:[0-9a-f]{64}$/.test(item.expectation_event_ref) ||
          focusedRefs.has(item.expectation_event_ref),
        `${fixture.id} focus ${focus.event_ref} left an action without its expectation`
      );
    }
  }
}
const emptyReturn = returns.createReturnGeometry("empty-return");
assert.equal(emptyReturn.fixture.subject_refs.length, 0);
assert.equal(emptyReturn.fixture.events.length, 0);
assert.equal(emptyReturn.relationship_projection.edges.length, 0);
assert(emptyReturn.categorical_return.every((item) => item.state === "not_applicable"));
assert.throws(() => returns.createReturnGeometry("not-a-return"), /Unknown synthetic return scenario/);
assert.throws(
  () => returns.createReturnGeometry("after-not-because", "sha256:" + "0".repeat(64)),
  /Unknown synthetic return event/
);

console.log(`Validated ${app.DEMO_SCENARIOS.length} Love Geometry fixtures and ${returns.RETURN_SCENARIOS.length} Return Geometry fixtures in ${root}`);
console.log("Runtime sources contain no external URL, network API, remote asset, secret, external form transmission, cookie, or browser-storage path.");
console.log("The original Love Geometry runtime helpers remain exact to their AgentTool base; Return Geometry is a presentation-only successor.");
console.log(
  manifest.status === "space_successor_source_bound"
    ? `Runtime bytes are bound to AgentTool source commit ${manifest.source.git_commit}; the npm/LOVE browser artifact remains honestly unbound.`
    : "Runtime bytes are exact, but their AgentTool source commit is still honestly pending."
);
console.log("Every return is synthetic, categorical, unsigned, free of automatic/KARMA action, and deterministic; no profile is summed.");
