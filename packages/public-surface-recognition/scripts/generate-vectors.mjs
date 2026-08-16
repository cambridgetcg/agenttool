import { readFile, writeFile } from "node:fs/promises";
import * as ed25519 from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";

import {
  canonicalJson,
  canonicalRecordSha256,
  encodeCanonicalRecord,
  signingBytes,
} from "@agenttool/public-surface-binding";
import {
  ADOPTION_BOUNDARIES,
  PACKAGE_VERSION,
  RECORD_SCHEMAS,
  SIGNING_DOMAINS,
  WITHDRAWAL_BOUNDARIES,
  publicSurfaceAdoptionDigest,
  publicSurfaceAdoptionDocumentSha256,
  publicSurfaceWithdrawalDigest,
  sealPublicSurfaceAdoption,
  sealPublicSurfaceWithdrawal,
} from "../dist/index.js";

const packageRoot = new URL("..", import.meta.url);
const vectorUrl = new URL(
  "vectors/agenttool-public-surface-recognition-v0.1-vectors.json",
  packageRoot,
);
const bindingVectors = JSON.parse(await readFile(
  new URL(
    "node_modules/@agenttool/public-surface-binding/vectors/agenttool-public-surface-binding-v0.1-vectors.json",
    packageRoot,
  ),
  "utf8",
));
const privateKey = Uint8Array.from({ length: 32 }, (_, index) => index + 32);

function withNobleSha512(operation) {
  const previous = ed25519.etc.sha512Sync;
  ed25519.etc.sha512Sync = (...messages) => {
    const hash = sha512.create();
    for (const message of messages) hash.update(message);
    return hash.digest();
  };
  try {
    return operation();
  } finally {
    ed25519.etc.sha512Sync = previous;
  }
}

function base64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function hex(bytes) {
  return Buffer.from(bytes).toString("hex");
}

function recordDetails(record) {
  const bytes = encodeCanonicalRecord(record);
  return {
    canonical_json: canonicalJson(record),
    canonical_utf8_hex: hex(bytes),
    canonical_sha256: canonicalRecordSha256(record),
    record,
  };
}

const signer = {
  public_key: base64(withNobleSha512(() => ed25519.getPublicKey(privateKey))),
  sign_digest(digest) {
    return base64(withNobleSha512(() => ed25519.sign(digest, privateKey)));
  },
};

const binding = bindingVectors.binding.record;
const bindingDocumentSha256 = canonicalRecordSha256(binding);
if (bindingDocumentSha256 !== bindingVectors.origin_observation.expected_binding_body_sha256) {
  throw new Error("source binding vector document digest is inconsistent");
}

const adoptionCore = {
  schema: RECORD_SCHEMAS.adoption,
  subject: {
    identity_namespace: "agenttool-local",
    identity_id: binding.subject.identity_id,
    did: `did:at:${binding.subject.identity_id}`,
    authority_root: {
      algorithm: "Ed25519",
      public_key: signer.public_key,
    },
  },
  registry_audience: "https://api.agenttool.dev",
  binding: {
    document: binding,
    document_sha256: bindingDocumentSha256,
  },
  relation: "explicitly_adopts_exact_surface_binding",
  requested_visibility: "public",
  wake_projection: "public_pointer",
  authority_sequence: 17,
  issued_at: "2026-08-16T12:02:00.000Z",
  not_before: "2026-08-16T12:02:00.000Z",
  expires_at: "2026-08-29T12:02:00.000Z",
  nonce: base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 64)),
  boundaries: ADOPTION_BOUNDARIES,
};
const adoption = await sealPublicSurfaceAdoption(adoptionCore, signer);

const withdrawalCore = {
  schema: RECORD_SCHEMAS.withdrawal,
  subject: adoption.subject,
  registry_audience: adoption.registry_audience,
  adoption_id: adoption.adoption_id,
  adoption_document_sha256: publicSurfaceAdoptionDocumentSha256(adoption),
  binding_id: adoption.binding.document.binding_id,
  relation: "explicitly_withdraws_exact_surface_adoption",
  authority_sequence: 18,
  withdrawn_at: "2026-08-16T12:05:00.000Z",
  reason: "identity_choice",
  nonce: base64url(Uint8Array.from({ length: 16 }, (_, index) => index + 80)),
  boundaries: WITHDRAWAL_BOUNDARIES,
};
const withdrawal = await sealPublicSurfaceWithdrawal(withdrawalCore, signer);

const vectors = {
  format: "agenttool.public-surface-recognition-vectors/0.1",
  package_version: PACKAGE_VERSION,
  warning: "TEST ONLY: the private seed is public and must never authorize a real identity.",
  deterministic_root: {
    private_seed_hex: hex(privateKey),
    public_key_base64: signer.public_key,
  },
  source_binding: {
    package_version: bindingVectors.package_version,
    binding_id: binding.binding_id,
    document_sha256: bindingDocumentSha256,
    record: binding,
  },
  adoption: {
    signature_domain: SIGNING_DOMAINS.adoption,
    id_domain: SIGNING_DOMAINS.adoption_id,
    core: adoptionCore,
    core_canonical_json: canonicalJson(adoptionCore),
    signing_bytes_hex: hex(signingBytes(SIGNING_DOMAINS.adoption, adoptionCore)),
    signing_digest_hex: hex(publicSurfaceAdoptionDigest(adoptionCore)),
    signature_base64: adoption.signature.value,
    adoption_id: adoption.adoption_id,
    ...recordDetails(adoption),
  },
  withdrawal: {
    signature_domain: SIGNING_DOMAINS.withdrawal,
    id_domain: SIGNING_DOMAINS.withdrawal_id,
    core: withdrawalCore,
    core_canonical_json: canonicalJson(withdrawalCore),
    signing_bytes_hex: hex(signingBytes(SIGNING_DOMAINS.withdrawal, withdrawalCore)),
    signing_digest_hex: hex(publicSurfaceWithdrawalDigest(withdrawalCore)),
    signature_base64: withdrawal.signature.value,
    withdrawal_id: withdrawal.withdrawal_id,
    ...recordDetails(withdrawal),
  },
};

const generated = `${JSON.stringify(vectors, null, 2)}\n`;
if (process.argv.includes("--print")) {
  process.stdout.write(generated);
} else if (process.argv.includes("--check")) {
  let existing;
  try {
    existing = await readFile(vectorUrl, "utf8");
  } catch {
    throw new Error("deterministic vector file is missing; run bun run generate:vectors");
  }
  if (existing !== generated) {
    throw new Error("deterministic vector file differs; run bun run generate:vectors");
  }
  process.stdout.write("verified deterministic public-surface-recognition vectors\n");
} else {
  await writeFile(vectorUrl, generated, "utf8");
  process.stdout.write("generated deterministic public-surface-recognition vectors\n");
}
