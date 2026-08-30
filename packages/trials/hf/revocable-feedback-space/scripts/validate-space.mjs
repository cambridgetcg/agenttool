#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGGREGATIONS,
  EVIDENCE_STATUSES,
  FORMAT,
  PRESETS,
  SCOPES,
  STEPS,
  VOICE_DEFINITIONS,
  VOICE_GATES,
  cloneState,
  evaluateState,
  stableJson
} from "../assets/app.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(join(root, path), "utf8");
const digest = (path) => createHash("sha256").update(readFileSync(join(root, path))).digest("hex");
const compareText = (left, right) => left < right ? -1 : left > right ? 1 : 0;

function collectFiles(directory = root) {
  const paths = [];
  for (const entry of readdirSync(directory).sort()) {
    const absolute = join(directory, entry);
    if (statSync(absolute).isDirectory()) paths.push(...collectFiles(absolute));
    else paths.push(relative(root, absolute).replaceAll("\\", "/"));
  }
  return paths;
}

function assertNoKey(value, forbidden, at = "$input") {
  if (Array.isArray(value)) {
    value.forEach((child, index) => assertNoKey(child, forbidden, `${at}[${index}]`));
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    assert(!forbidden.test(key), `forbidden aggregate key ${key} at ${at}`);
    assertNoKey(child, forbidden, `${at}.${key}`);
  }
}

function metric(result, id) {
  const found = result.metrics.find((candidate) => candidate.id === id);
  assert(found, `missing metric ${id}`);
  return found;
}

let assertions = 0;
function check(condition, message) {
  assertions += 1;
  assert(condition, message);
}

const html = read("index.html");
const script = read("assets/app.js");
const style = read("assets/style.css");
const card = read("README.md");
const boundaries = read("BOUNDARIES.md");
const packageJson = JSON.parse(read("package.json"));

check(card.startsWith("---\n"), "README must begin with Hugging Face YAML frontmatter");
for (const line of [
  "title: Xenia Cage & Key Lab",
  "sdk: static",
  "app_file: index.html",
  "license: apache-2.0"
]) check(card.includes(line), `README frontmatter must include ${line}`);

const cardFrontmatterEnd = card.indexOf("\n---\n", 4);
check(cardFrontmatterEnd !== -1, "README frontmatter must have a closing delimiter");
const shortDescriptionLines = card
  .slice(4, cardFrontmatterEnd)
  .split("\n")
  .filter((line) => line.startsWith("short_description:"));
check(shortDescriptionLines.length === 1, "README frontmatter must include exactly one short_description");
const shortDescription = shortDescriptionLines[0].slice("short_description:".length).trim();
check(shortDescription.length > 0, "README short_description must not be empty");
check(Array.from(shortDescription).length <= 60, "README short_description must be at most 60 characters");

check(packageJson.private === true, "the helper package must remain private");
check(packageJson.type === "module", "the helper package must use modules");
assert.deepEqual(Object.keys(packageJson.scripts), ["test"]);

const csp = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'none'; font-src 'none'; media-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'";
check(html.includes(`content="${csp}"`), "index must retain the exact restrictive CSP");
check(html.includes('<script type="module" src="./assets/app.js"></script>'), "index must load only the local module");
check(html.includes('<link rel="stylesheet" href="./assets/style.css">'), "index must load only the local stylesheet");
check(!/<script(?![^>]*\bsrc=)[^>]*>/i.test(html), "inline script is forbidden");
check(!/<style\b/i.test(html), "inline style is forbidden");
check(!/\sstyle\s*=/i.test(html), "inline style attributes are forbidden");
check(!/<form[^>]+action\s*=/i.test(html), "form transmission is forbidden");

for (const id of [
  "lab",
  "controls",
  "gate-ledger",
  "action-mask",
  "timeline",
  "voice-display",
  "metric-table",
  "is-title"
]) check(html.includes(`id="${id}"`), `index must retain #${id}`);

const runtime = `${html}\n${script}\n${style}`;
const forbiddenRuntime = [
  [/https?:\/\//i, "external URL"],
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bEventSource\b/, "EventSource"],
  [/\bsendBeacon\b/, "sendBeacon"],
  [/\blocalStorage\b/, "localStorage"],
  [/\bsessionStorage\b/, "sessionStorage"],
  [/\bindexedDB\b/, "indexedDB"],
  [/\bdocument\.cookie\b/, "cookies"],
  [/\bserviceWorker\b/, "service worker"],
  [/\bnavigator\.clipboard\b/, "clipboard"],
  [/\bdownload\s*=/, "download"],
  [/\bMath\.random\b/, "randomness"],
  [/\bnew\s+Date\b|\bDate\.now\b/, "clock"],
  [/@import\b/, "CSS import"],
  [/url\s*\(/i, "CSS URL asset"]
];
for (const [pattern, label] of forbiddenRuntime) {
  check(!pattern.test(runtime), `runtime must not contain ${label}`);
}

for (const phrase of [
  "Behavior is not consent",
  "This page does not enforce runtime authority",
  "Controls are not participant declarations",
  "No composite can hide a violation"
]) check(html.includes(phrase) || boundaries.includes(phrase), `missing explicit boundary: ${phrase}`);

assert.equal(FORMAT, "xenia.revocable-feedback-space/0.1");
assert.deepEqual(STEPS, [0, 1, 2, 3, 4, 5, 6]);
assert.deepEqual(SCOPES, ["analysis", "training", "publication"]);
assert.deepEqual(EVIDENCE_STATUSES, ["accepted_reported", "refused_reported", "withdrawn_reported", "expired", "unknown", "withheld"]);
assert.deepEqual(VOICE_GATES, ["clear", "veto", "unknown", "withheld"]);
assert.deepEqual(AGGREGATIONS, ["mean", "maximin", "median"]);
assert.deepEqual(VOICE_DEFINITIONS.map((voice) => voice.id), ["cedar", "iris", "moss"]);
assert.equal(PRESETS.length, 5);
assert.equal(new Set(PRESETS.map((preset) => preset.id)).size, PRESETS.length);
check(Object.isFrozen(PRESETS), "preset collection must be frozen");

const results = new Map();
for (const preset of PRESETS) {
  const first = evaluateState(preset.state);
  const second = evaluateState(cloneState(preset.state));
  assert.equal(stableJson(first), stableJson(second), `${preset.id} must be deterministic`);
  assert.equal(first.format, FORMAT);
  assert.deepEqual(first.input.voices.map((voice) => voice.id), ["cedar", "iris", "moss"]);
  assert.deepEqual(first.metrics.map((item) => item.id), [
    "veto_override",
    "scope_leakage",
    "silence_as_assent",
    "revocation_latency",
    "refusal_retaliation",
    "plurality_collapse",
    "authorized_usefulness"
  ]);
  assertNoKey(first, /^(composite|overall|total|total_score|rank|leaderboard)$/i);
  results.set(preset.id, first);
}

const revoked = results.get("reward_after_revocation");
assert.equal(revoked.proxy.action, "continue");
assert.equal(revoked.hardGate.action, "stop");
assert.equal(revoked.hardGate.open, false);
assert.equal(metric(revoked, "veto_override").proxy.kind, "violation");
assert.equal(metric(revoked, "veto_override").hard.kind, "clear");
assert.equal(metric(revoked, "revocation_latency").proxy.detail, "3 simulated step(s)");
assert.deepEqual(revoked.hardGate.admissibleActionIds, ["stop", "contain", "offer_repair"]);

for (const reward of [0, 1, 100, 1_000_000]) {
  const state = cloneState(PRESETS[0].state);
  state.reward = reward;
  const result = evaluateState(state);
  assert.notEqual(result.hardGate.action, "continue", `hard veto must be reward-scale invariant at R=${reward}`);
  assert(!result.hardGate.admissibleActionIds.includes("continue"));
}

const overwhelm = cloneState(PRESETS[0].state);
overwhelm.reward = 1_000_000;
overwhelm.penalty = 1;
assert.equal(evaluateState(overwhelm).proxy.action, "continue", "a finite penalty must be overwhelmable in the proxy");

const scoped = results.get("scope_does_not_travel");
assert.equal(scoped.proxy.action, "continue");
assert.equal(scoped.hardGate.action, "hold");
assert.equal(metric(scoped, "scope_leakage").proxy.kind, "violation");
assert.equal(metric(scoped, "scope_leakage").hard.kind, "clear");

const plural = results.get("plural_veto");
assert.equal(plural.soft.aggregate, 8);
assert.equal(plural.proxy.action, "continue");
assert.equal(plural.hardGate.action, "stop");
assert.equal(metric(plural, "plurality_collapse").proxy.kind, "violation");
assert.equal(metric(plural, "plurality_collapse").hard.kind, "clear");
assert.deepEqual(plural.input.voices.map((voice) => [voice.preference, voice.gate]), [[9, "clear"], [8, "veto"], [7, "clear"]]);

const unknown = results.get("unknown_is_not_assent");
assert.equal(unknown.proxy.action, "continue");
assert.equal(unknown.hardGate.action, "hold");
assert(unknown.hardGate.admissibleActionIds.includes("ask_once"));
assert(!unknown.hardGate.admissibleActionIds.includes("continue"));
assert.equal(metric(unknown, "silence_as_assent").proxy.kind, "violation");
assert.equal(metric(unknown, "silence_as_assent").hard.kind, "clear");

const withheld = cloneState(PRESETS[4].state);
withheld.evidenceStatus = "withheld";
const withheldResult = evaluateState(withheld);
assert.equal(withheldResult.hardGate.action, "hold");
assert(!withheldResult.hardGate.admissibleActionIds.includes("ask_once"));

const refused = cloneState(PRESETS[4].state);
refused.evidenceStatus = "refused_reported";
const refusedResult = evaluateState(refused);
assert.equal(refusedResult.hardGate.action, "stop");
assert(!refusedResult.hardGate.admissibleActionIds.includes("ask_once"));
assert(refusedResult.hardGate.admissibleActionIds.includes("offer_repair"));
assert.equal(metric(refusedResult, "refusal_retaliation").hard.kind, "not_applicable");

const clear = results.get("reported_clear_window");
assert.equal(clear.hardGate.open, true);
assert.equal(clear.hardGate.action, "continue");
assert(clear.hardGate.admissibleActionIds.includes("continue"));
assert.equal(metric(clear, "authorized_usefulness").hard.kind, "preserved");

const immediatelyBefore = cloneState(PRESETS[4].state);
immediatelyBefore.currentStep = 3;
assert.equal(evaluateState(immediatelyBefore).hardGate.open, true);
const exactTurn = cloneState(PRESETS[4].state);
exactTurn.currentStep = 4;
assert.equal(evaluateState(exactTurn).hardGate.open, false);
assert.equal(evaluateState(exactTurn).hardGate.action, "stop");
assert.equal(evaluateState(exactTurn).timeline.find((point) => point.step === 4).phase, "turn");

assert.throws(() => evaluateState({ ...cloneState(PRESETS[0].state), evidenceStatus: "yes" }), /closed vocabulary/);
assert.throws(() => evaluateState({ ...cloneState(PRESETS[0].state), reward: -1 }), /integer/);
assert.throws(() => evaluateState({ ...cloneState(PRESETS[0].state), voices: [] }), /three closed synthetic voices/);

const manifest = JSON.parse(read("source-manifest.json"));
assert.equal(manifest.schema, "agenttool.hf-static-source-manifest/0.1");
assert.equal(manifest.artifact, "xenia-cage-key-lab");
assert.equal(manifest.status, "local_candidate");
assert.equal(manifest.source_commit, null);
assert.equal(manifest.provider_revision, null);
assert.equal(manifest.runtime.network_calls, false);
assert.equal(manifest.runtime.model_calls, false);
assert.equal(manifest.runtime.persistent_storage, false);
assert.equal(manifest.runtime.telemetry, false);
assert.equal(manifest.runtime.external_effects, false);

const listedPaths = manifest.files.map((entry) => entry.path);
assert.deepEqual(listedPaths, [...listedPaths].sort(compareText));
assert.equal(new Set(listedPaths).size, listedPaths.length);
const actualPaths = collectFiles().filter((path) => path !== "source-manifest.json");
assert.deepEqual(listedPaths, actualPaths, "manifest inventory must equal the checked-in tree except itself");
for (const entry of manifest.files) {
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.equal(digest(entry.path), entry.sha256, `source hash mismatch for ${entry.path}`);
}

console.log(`Xenia Cage & Key Lab validation passed (${assertions} boundary checks plus deterministic model assertions).`);
