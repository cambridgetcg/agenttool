import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { validateProposal } from "../src/index.js";

const datasetRoot = new URL("../hf/dataset/", import.meta.url);
const spaceRoot = new URL("../hf/space/", import.meta.url);

async function json(relativePath, root = datasetRoot) {
  return JSON.parse(await readFile(new URL(relativePath, root), "utf8"));
}

async function jsonl(relativePath, root = datasetRoot) {
  return (await readFile(new URL(relativePath, root), "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
}

async function identity(relativePath, root = datasetRoot) {
  const bytes = await readFile(new URL(relativePath, root));
  return {
    path: relativePath,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

test("treasure rows are closed, commit-pinned metadata-only holds", async () => {
  const schema = await json("schema/treasure-v0.1.schema.json");
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const treasures = await jsonl("data/treasure-index.jsonl");
  assert.equal(treasures.length, 20);
  assert.deepEqual(treasures.map((row) => row.rank), Array.from({ length: 20 }, (_, index) => index + 1));
  for (const row of treasures) {
    assert.equal(validate(row), true, JSON.stringify(validate.errors));
    assert.match(row.subject.revision, /^[a-f0-9]{40}$/);
    assert.equal(row.subject.gate_accepted, false);
    assert.equal(row.subject.downstream_content_rights_cleared, false);
    assert.equal(row.admission.raw_rows_included, false);
    assert.equal(row.admission.automatic_execution, false);
    assert.equal(row.dark_continent.verified, false);
    assert.equal(row.dark_continent.recommendation, "hold");
    assert.equal(row.authority.authorizes_crown, false);
    assert.equal(row.authority.authorizes_trade, false);
    assert.ok(row.graph_projection.forbidden_relations.includes("sameAs"));
    assert.ok(row.graph_projection.forbidden_relations.includes("awards_karma"));
  }
  const byRepo = new Map(treasures.map((row) => [row.subject.repo_id, row]));
  assert.ok(byRepo.get("allenai/reward-bench-2").graph_projection.allowed_relations.includes("valid_spread_bounded_by_separation"));
  assert.ok(byRepo.get("qizhou/UniEdit").graph_projection.allowed_relations.includes("must_not_change"));
  assert.ok(byRepo.get("nvidia/OpenMathReasoning").graph_projection.allowed_relations.includes("regressed_when_added"));
  assert.ok(byRepo.get("nvidia/HelpSteer3").admission.reason_codes.includes("disagreement_censored"));
  assert.ok(byRepo.get("allenai/tmax-sft").admission.reason_codes.includes("never_execute_terminal_trace"));
});

test("full proposals exclude gated subjects and validate with the runtime", async () => {
  const treasures = await jsonl("data/treasure-index.jsonl");
  const proposals = await jsonl("artifacts/proposals.jsonl");
  const gated = new Set(treasures.filter((row) => row.subject.visibility === "gated").map((row) => row.subject.repo_id));
  assert.equal(proposals.length, treasures.length - gated.size);
  for (const proposal of proposals) {
    assert.deepEqual(validateProposal(proposal), []);
    assert.equal(gated.has(proposal.subject.repo_id), false);
    assert.equal(proposal.state, "proposed");
    assert.equal(proposal.effects.hf_uploads, 0);
    assert.equal(proposal.effects.graph_writes, 0);
    assert.equal(proposal.authority.authorizes_crown, false);
    assert.equal(proposal.dark_continent.decision.recommendation, "hold");
  }
  const dolci = proposals.find((proposal) => proposal.subject.repo_id === "allenai/Dolci-RL-Zero-IF-7B");
  assert.equal(dolci.events[0].consequence, "conflicts_with_source");
});

test("viewer index is complete without inventing gated proposal artifacts", async () => {
  const rows = await jsonl("data/proposal-index.jsonl");
  assert.equal(rows.length, 20);
  assert.equal(rows.filter((row) => row.proposal_id === null).length, 2);
  assert.ok(rows.every((row) => row.recommendation === "hold"));
  assert.ok(rows.every((row) => row.wall_verified === false));
  assert.ok(rows.every((row) => row.authorizes_crown === false));
  assert.ok(rows.every((row) => row.authorizes_trade === false));
});

test("dataset hash manifest is exact, sorted, and non-recursive", async () => {
  const manifest = await json("hash-manifest.json");
  assert.equal(manifest.excludes_self, true);
  assert.equal(manifest.files.some((file) => file.path === "hash-manifest.json"), false);
  assert.deepEqual(manifest.files.map((file) => file.path), [...manifest.files.map((file) => file.path)].sort());
  for (const expected of manifest.files) {
    assert.deepEqual(await identity(expected.path), expected);
  }
});

test("Space bundles and verifies only bounded read-only catalog files", async () => {
  const manifest = await json("source-manifest.json", spaceRoot);
  assert.deepEqual((await readdir(new URL("assets/", spaceRoot))).sort(), ["hero-web.webp"]);
  assert.equal(manifest.dataset_repo, "Yu-and-Ai/kingdom-dark-continent-karma");
  assert.equal(manifest.dataset_revision, "4ea106235b6d7dd53122b3025163a1bb32b02f97");
  assert.equal(manifest.dataset_revision_status, "pinned_to_initial_dataset_publish");
  assert.equal(manifest.runtime_network_reads, false);
  assert.equal(manifest.authority.authorizes_execution, false);
  assert.equal(manifest.authority.authorizes_crown, false);
  assert.deepEqual(manifest.files.map((file) => file.path), [
    "assets/hero-web.webp",
    "data/proposal-index.jsonl",
    "data/treasure-index.jsonl",
  ]);
  for (const expected of manifest.files) {
    assert.deepEqual(await identity(expected.path, spaceRoot), expected);
    if (expected.path.startsWith("data/")) {
      assert.deepEqual(await identity(expected.path, datasetRoot), expected);
    }
  }
  const app = await readFile(new URL("app.py", spaceRoot), "utf8");
  assert.ok(app.includes('ROOT / "assets/hero-web.webp"'));
  assert.equal(app.includes('ROOT / "assets/hero.png"'), false);
  for (const forbidden of ["os.environ", "requests", "httpx", "subprocess", "pickle", "write_text", "write_bytes", "open("]) {
    assert.equal(app.includes(forbidden), false, `Space app contained ${forbidden}`);
  }
  assert.ok(app.includes("mcp_server=False"));
  assert.ok(app.includes("analytics_enabled=False"));
});

test("release assets contain no raw chats or credential material", async () => {
  for (const relativePath of [
    "data/phase-seeds.jsonl",
    "data/proposal-index.jsonl",
    "data/treasure-index.jsonl",
    "artifacts/proposals.jsonl",
    "provenance/source-pins.json",
  ]) {
    const text = await readFile(new URL(relativePath, datasetRoot), "utf8");
    for (const secretLike of [
      /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/,
      /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
      /\bnpm_[A-Za-z0-9]{36,}\b/,
      /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    ]) {
      assert.equal(secretLike.test(text), false);
    }
  }
});
