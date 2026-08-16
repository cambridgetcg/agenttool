import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRootUrl = new URL("..", import.meta.url);
const packageRoot = fileURLToPath(packageRootUrl);
const temporaryRoot = await mkdtemp(join(packageRoot, ".packed-smoke-"));

try {
  const report = JSON.parse(execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot],
    { cwd: packageRoot, encoding: "utf8" },
  ));
  assert.equal(Array.isArray(report), true);
  assert.equal(report.length, 1);
  assert.equal(typeof report[0]?.filename, "string");
  const tarball = join(temporaryRoot, report[0].filename);
  execFileSync("tar", ["-xzf", tarball, "-C", temporaryRoot]);

  const extractedRoot = join(temporaryRoot, "package");
  const vectors = JSON.parse(await readFile(
    join(extractedRoot, "vectors/agenttool-public-surface-binding-v0.1-vectors.json"),
    "utf8",
  ));
  // The temp directory deliberately lives below the development package so
  // Node resolves the extracted artifact's declared dependencies from the
  // already-installed package node_modules without modifying the artifact.
  const api = await import(pathToFileURL(join(extractedRoot, "dist/index.js")).href);

  const observation = api.validatePublicSurfaceObservation(vectors.observation.record);
  const originObservation = api.validatePublicSurfaceObservation(vectors.origin_observation.record);
  const binding = api.verifyPublicSurfaceBinding(vectors.binding.record);
  const revocation = api.verifyPublicSurfaceRevocation(vectors.revocation.record);

  assert.equal(observation.evidence_id, vectors.observation.evidence_id);
  assert.equal(originObservation.evidence_id, vectors.origin_observation.evidence_id);
  assert.equal(binding.binding_id, vectors.binding.binding_id);
  assert.equal(revocation.revocation_id, vectors.revocation.revocation_id);
  assert.equal(api.canonicalRecordSha256(binding), vectors.origin_observation.expected_binding_body_sha256);
  assert.equal(api.encodeCanonicalRecord(binding).byteLength, vectors.origin_observation.expected_binding_bytes);

  const current = api.assessPublicSurfaceBinding({
    binding,
    evaluated_at: vectors.current_assessment.record.evaluated_at,
    key_evidence: vectors.key_evidence,
    observation,
    origin_observation: originObservation,
    revocations: [],
    revocation_key_evidence: [],
  });
  assert.equal(api.canonicalJson(current), vectors.current_assessment.canonical_json);

  const revoked = api.assessPublicSurfaceBinding({
    binding,
    evaluated_at: vectors.revoked_assessment.record.evaluated_at,
    key_evidence: vectors.key_evidence,
    observation,
    origin_observation: originObservation,
    revocations: [revocation],
    revocation_key_evidence: [],
  });
  assert.equal(api.canonicalJson(revoked), vectors.revoked_assessment.canonical_json);
  assert.equal(current.revocation, "not_observed");
  assert.equal(revoked.revocation, "revoked");
  for (const assessment of [current, revoked]) {
    assert.equal(assessment.authority, "none");
    assert.equal(assessment.score, null);
    assert.equal(assessment.wake_effect, false);
    assert.equal(assessment.memory_effect, false);
    assert.equal(assessment.karma_effect, false);
    assert.equal(assessment.training_effect, false);
  }

  process.stdout.write("packed Node ESM public-surface-binding smoke passed\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
