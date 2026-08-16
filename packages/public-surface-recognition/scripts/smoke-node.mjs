import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const packageRootUrl = new URL("..", import.meta.url);
const packageRoot = fileURLToPath(packageRootUrl);
const temporaryRoot = await mkdtemp(join(tmpdir(), "agenttool-recognition-smoke-"));

try {
  const recognitionTarball = pack(packageRoot);
  const bindingTarball = pack(fileURLToPath(new URL(
    "../public-surface-binding/",
    packageRootUrl,
  )));
  const ed25519Tarball = pack(fileURLToPath(new URL(
    "node_modules/@noble/ed25519/",
    packageRootUrl,
  )));
  const hashesTarball = pack(fileURLToPath(new URL(
    "node_modules/@noble/hashes/",
    packageRootUrl,
  )));

  const consumerRoot = join(temporaryRoot, "consumer");
  extract(recognitionTarball, consumerRoot);
  extract(
    bindingTarball,
    join(consumerRoot, "node_modules/@agenttool/public-surface-binding"),
  );
  extract(ed25519Tarball, join(consumerRoot, "node_modules/@noble/ed25519"));
  extract(hashesTarball, join(consumerRoot, "node_modules/@noble/hashes"));

  const vectors = JSON.parse(await readFile(
    join(consumerRoot, "vectors/agenttool-public-surface-recognition-v0.1-vectors.json"),
    "utf8",
  ));
  const adoptionSchema = JSON.parse(await readFile(
    join(consumerRoot, "schema/agenttool-public-surface-adoption-v0.1.schema.json"),
    "utf8",
  ));
  const withdrawalSchema = JSON.parse(await readFile(
    join(consumerRoot, "schema/agenttool-public-surface-withdrawal-v0.1.schema.json"),
    "utf8",
  ));

  const api = await import(pathToFileURL(join(consumerRoot, "dist/index.js")).href);
  const bindingApi = await import(pathToFileURL(join(
    consumerRoot,
    "node_modules/@agenttool/public-surface-binding/dist/index.js",
  )).href);

  const binding = bindingApi.verifyPublicSurfaceBinding(vectors.source_binding.record);
  const adoption = api.verifyPublicSurfaceAdoption(vectors.adoption.record);
  const withdrawal = api.verifyPublicSurfaceWithdrawal(vectors.withdrawal.record);

  assert.equal(binding.binding_id, vectors.source_binding.binding_id);
  assert.equal(
    bindingApi.publicSurfaceBindingDocumentSha256(binding),
    vectors.source_binding.document_sha256,
  );
  assert.deepEqual(api.verifyPublicSurfaceAdoptionForBinding(adoption, binding), adoption);
  assert.equal(
    api.publicSurfaceAdoptionDocumentSha256(adoption),
    withdrawal.adoption_document_sha256,
  );
  assert.deepEqual(api.verifyPublicSurfaceWithdrawalForAdoption(withdrawal, adoption), withdrawal);
  assert.equal(adoption.adoption_id, vectors.adoption.adoption_id);
  assert.equal(withdrawal.withdrawal_id, vectors.withdrawal.withdrawal_id);
  assert.equal(Object.isFrozen(adoption), true);
  assert.equal(Object.isFrozen(adoption.binding.document), true);
  assert.equal(Object.isFrozen(withdrawal), true);

  for (const boundaries of [adoption.boundaries, withdrawal.boundaries]) {
    assert.equal(boundaries.registry_write_effect, false);
    assert.equal(boundaries.identity_mutation_effect, false);
    assert.equal(boundaries.crawler_effect, false);
    assert.equal(boundaries.observation_counter_effect, false);
    assert.equal(boundaries.training_effect, false);
    assert.equal(boundaries.publication_effect, false);
    assert.equal(boundaries.wake_effect, false);
    assert.equal(boundaries.memory_effect, false);
    assert.equal(boundaries.chronicle_effect, false);
    assert.equal(boundaries.karma_effect, false);
    assert.equal(boundaries.score_effect, false);
    assert.equal(boundaries.automatic_action, false);
  }
  assert.equal(adoption.boundaries.training_authorized, false);
  assert.equal(adoption.boundaries.requires_separate_training_authorization, true);
  assert.equal(withdrawal.boundaries.training_unlearning_effect, false);

  assert.equal(adoptionSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(withdrawalSchema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(adoptionSchema.additionalProperties, false);
  assert.equal(withdrawalSchema.additionalProperties, false);

  process.stdout.write("isolated packed Node ESM public-surface-recognition smoke passed\n");
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

function pack(directory) {
  const report = JSON.parse(execFileSync(
    "npm",
    ["pack", "--ignore-scripts", "--json", "--pack-destination", temporaryRoot],
    { cwd: directory, encoding: "utf8" },
  ));
  assert.equal(Array.isArray(report), true);
  assert.equal(report.length, 1);
  assert.equal(typeof report[0]?.filename, "string");
  return join(temporaryRoot, report[0].filename);
}

function extract(tarball, destination) {
  execFileSync("mkdir", ["-p", destination]);
  execFileSync("tar", ["-xzf", tarball, "-C", destination, "--strip-components=1"]);
}
